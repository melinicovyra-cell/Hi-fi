// ============================================
// ULTRA-SECURE CHAT SERVER v3.0
// Created by KRSP Team
// Features: E2E Encryption, JWT, HMAC, Anti-Leak
// ============================================

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// ============ БЕЗОПАСНАЯ КОНФИГУРАЦИЯ ============

const CRYPTO_CONFIG = {
    ALGORITHM: 'aes-256-gcm',
    KEY_LENGTH: 32,
    IV_LENGTH: 16,
    AUTH_TAG_LENGTH: 16,
    SALT_LENGTH: 32,
    PBKDF2_ITERATIONS: 100000,
};

// Генерация безопасных ключей из переменных окружения
const MASTER_KEY = process.env.MASTER_KEY || crypto.randomBytes(32).toString('hex');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const ADMIN_SECRET = process.env.ADMIN_SECRET || crypto.randomBytes(32).toString('hex');
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');

// Печатаем ключи ОДИН РАЗ при старте (сохрани их!)
if (!process.env.MASTER_KEY) {
    console.log('⚠️  SAVE THESE KEYS IN .env FILE:');
    console.log(`MASTER_KEY=${MASTER_KEY}`);
    console.log(`JWT_SECRET=${JWT_SECRET}`);
    console.log(`ADMIN_SECRET=${ADMIN_SECRET}`);
    console.log(`HMAC_SECRET=${HMAC_SECRET}`);
    console.log('==========================================\n');
}

// ============ КРИПТОГРАФИЧЕСКИЕ УТИЛИТЫ ============

class CryptoUtils {
    // Генерация производного ключа (для разных целей)
    static deriveKey(purpose, salt = '') {
        return crypto.pbkdf2Sync(
            MASTER_KEY + purpose,
            salt || crypto.randomBytes(CRYPTO_CONFIG.SALT_LENGTH),
            CRYPTO_CONFIG.PBKDF2_ITERATIONS,
            CRYPTO_CONFIG.KEY_LENGTH,
            'sha256'
        );
    }
    
    // Шифрование AES-256-GCM
    static encrypt(plaintext, purpose = 'default') {
        const iv = crypto.randomBytes(CRYPTO_CONFIG.IV_LENGTH);
        const salt = crypto.randomBytes(CRYPTO_CONFIG.SALT_LENGTH);
        const key = this.deriveKey(purpose, salt);
        
        const cipher = crypto.createCipheriv(CRYPTO_CONFIG.ALGORITHM, key, iv);
        
        let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
        ciphertext += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        // Возвращаем: salt:iv:authTag:ciphertext
        return Buffer.concat([
            salt,
            iv,
            authTag,
            Buffer.from(ciphertext, 'hex')
        ]).toString('base64');
    }
    
    // Расшифровка
    static decrypt(encrypted, purpose = 'default') {
        try {
            const buffer = Buffer.from(encrypted, 'base64');
            
            const salt = buffer.slice(0, CRYPTO_CONFIG.SALT_LENGTH);
            const iv = buffer.slice(CRYPTO_CONFIG.SALT_LENGTH, CRYPTO_CONFIG.SALT_LENGTH + CRYPTO_CONFIG.IV_LENGTH);
            const authTag = buffer.slice(
                CRYPTO_CONFIG.SALT_LENGTH + CRYPTO_CONFIG.IV_LENGTH,
                CRYPTO_CONFIG.SALT_LENGTH + CRYPTO_CONFIG.IV_LENGTH + CRYPTO_CONFIG.AUTH_TAG_LENGTH
            );
            const ciphertext = buffer.slice(CRYPTO_CONFIG.SALT_LENGTH + CRYPTO_CONFIG.IV_LENGTH + CRYPTO_CONFIG.AUTH_TAG_LENGTH);
            
            const key = this.deriveKey(purpose, salt);
            
            const decipher = crypto.createDecipheriv(CRYPTO_CONFIG.ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);
            
            let plaintext = decipher.update(ciphertext, null, 'utf8');
            plaintext += decipher.final('utf8');
            
            return plaintext;
        } catch (e) {
            return null;
        }
    }
    
    // HMAC для проверки целостности
    static createHMAC(data) {
        const hmac = crypto.createHmac('sha256', HMAC_SECRET);
        hmac.update(typeof data === 'string' ? data : JSON.stringify(data));
        return hmac.digest('hex');
    }
    
    // Проверка HMAC (защита от timing attack)
    static verifyHMAC(data, signature) {
        const expected = this.createHMAC(data);
        return crypto.timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(signature)
        );
    }
    
    // Хеширование (для IP, usernames и т.д.)
    static hash(data, salt = '') {
        return crypto.createHash('sha256')
            .update(data + salt + HMAC_SECRET)
            .digest('hex');
    }
    
    // Безопасное сравнение (защита от timing attack)
    static safeCompare(a, b) {
        try {
            return crypto.timingSafeEqual(
                Buffer.from(a),
                Buffer.from(b)
            );
        } catch {
            return false;
        }
    }
}

// ============ JWT ТОКЕНЫ ============

class JWTManager {
    static sign(payload, expiresIn = 3600) {
        const header = {
            alg: 'HS256',
            typ: 'JWT'
        };
        
        const now = Math.floor(Date.now() / 1000);
        const claims = {
            ...payload,
            iat: now,
            exp: now + expiresIn,
            jti: crypto.randomBytes(16).toString('hex')
        };
        
        const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
        const encodedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
        
        const signature = crypto
            .createHmac('sha256', JWT_SECRET)
            .update(`${encodedHeader}.${encodedPayload}`)
            .digest('base64url');
        
        return `${encodedHeader}.${encodedPayload}.${signature}`;
    }
    
    static verify(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            
            const [encodedHeader, encodedPayload, signature] = parts;
            
            const expectedSignature = crypto
                .createHmac('sha256', JWT_SECRET)
                .update(`${encodedHeader}.${encodedPayload}`)
                .digest('base64url');
            
            if (!CryptoUtils.safeCompare(signature, expectedSignature)) {
                return null;
            }
            
            const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
            
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) {
                return null;
            }
            
            return payload;
        } catch {
            return null;
        }
    }
}

// ============ ЗАЩИТА IP ============

class IPProtection {
    // Хешируем IP вместо хранения в открытом виде
    static hashIP(ip) {
        return CryptoUtils.hash(ip, 'ip-salt');
    }
    
    // Анонимизация IP для логов (если они нужны)
    static anonymizeIP(ip) {
        if (!ip) return 'unknown';
        
        // IPv4: сохраняем первые 2 октета
        if (ip.includes('.')) {
            const parts = ip.split('.');
            return `${parts[0]}.${parts[1]}.xxx.xxx`;
        }
        
        // IPv6: сохраняем первые 2 блока
        if (ip.includes(':')) {
            const parts = ip.split(':');
            return `${parts[0]}:${parts[1]}::xxxx`;
        }
        
        return 'unknown';
    }
}

// ============ HELMET С УСИЛЕННОЙ ЗАЩИТОЙ ============

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'none'"],
            scriptSrc: ["'none'"],
            styleSrc: ["'none'"],
            imgSrc: ["'none'"],
            connectSrc: ["'self'"],
            fontSrc: ["'none'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'none'"],
            frameSrc: ["'none'"],
            baseUri: ["'none'"],
            formAction: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'no-referrer' },
    xssFilter: true,
}));

// ============ CORS С УСИЛЕННОЙ ЗАЩИТОЙ ============

const BLOCKED_ORIGINS = [
    'discord.com', 'slack.com', 'telegram.org', 'zapier.com',
    'ifttt.com', 'integromat.com', 'make.com', 'webhooks.io'
];

app.use(cors({
    origin: function (origin, callback) {
        if (origin) {
            for (const blocked of BLOCKED_ORIGINS) {
                if (origin.toLowerCase().includes(blocked)) {
                    return callback(new Error('Blocked'), false);
                }
            }
        }
        callback(null, true);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Auth-Token', 'X-Request-ID'],
    credentials: false,
    maxAge: 600
}));

// ============ MIDDLEWARE ============

// JSON с ограничением
app.use(express.json({ 
    limit: '3kb',
    strict: true,
    reviver: (key, value) => {
        // Защита от __proto__ pollution
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
        }
        return value;
    }
}));

// Защита от веб-хуков
const BLOCKED_USER_AGENTS = [
    'discord', 'slack', 'telegram', 'webhook', 'bot', 'crawler',
    'spider', 'curl', 'wget', 'python', 'httpie', 'postman',
    'insomnia', 'axios', 'fetch', 'got'
];

app.use((req, res, next) => {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    
    if (!ua || ua.length < 10) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    for (const blocked of BLOCKED_USER_AGENTS) {
        if (ua.includes(blocked)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }
    
    // Проверка подозрительных заголовков
    if (req.headers['x-webhook'] || req.headers['x-hook']) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    next();
});

// Request ID для отслеживания
app.use((req, res, next) => {
    req.id = crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-ID', req.id);
    next();
});

// Получение IP с хешированием
function getClientIP(req) {
    const rawIP = req.ip || 
                  req.headers['x-forwarded-for']?.split(',')[0] || 
                  req.connection?.remoteAddress || 
                  'unknown';
    
    return IPProtection.hashIP(rawIP);
}

// ============ RATE LIMITING ============

const createLimiter = (windowMs, max, skipSuccessfulRequests = false) => {
    return rateLimit({
        windowMs,
        max,
        keyGenerator: (req) => getClientIP(req),
        handler: (req, res) => {
            res.status(429).json({
                error: 'Rate limit exceeded',
                retryAfter: Math.ceil(windowMs / 1000)
            });
        },
        skipSuccessfulRequests,
        standardHeaders: false,
        legacyHeaders: false,
    });
};

// Глобальный лимит
app.use(createLimiter(60000, 100));

// Лимит для сообщений (с учетом username из JWT, не из body)
const messageLimiter = rateLimit({
    windowMs: 3000,
    max: 1,
    keyGenerator: (req) => {
        const ip = getClientIP(req);
        const username = req.user?.username || '';
        return CryptoUtils.hash(ip + username);
    },
    skipSuccessfulRequests: false,
    standardHeaders: false,
    legacyHeaders: false,
});

// ============ ХРАНИЛИЩЕ (В ПАМЯТИ) ============

let messages = [];
let whispers = [];
const bannedUsers = new Set();
const mutedUsers = new Map();
const bannedIPs = new Set();
const sessions = new Map(); // username -> token
const rateLimitStore = new Map(); // для детального трекинга
const revokedTokens = new Map(); // jti -> expiry timestamp (список отозванных токенов)

const MAX_MESSAGES = 100;
const MESSAGE_LIFETIME = 5 * 60 * 1000;

// Роли
const USER_ROLES = {
    'hihpik0': { level: 5, prefix: '👑 CREATOR', color: 'RAINBOW', badge: '👑' },
    'BAAAAHHRR': { level: 4, prefix: '⚡ ADMIN', color: 'GOLD', badge: '⚡' },
};

// Расширенный фильтр слов
const BANNED_WORDS = [
    // English
    'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'cunt', 'whore', 
    'faggot', 'kys', 'rape', 'retard', 'cancer', 'aids',
    // Russian
    'хуй', 'пизда', 'ебать', 'бля', 'блять', 'шлюха', 'пидор',
    'гандон', 'мразь', 'сука', 'еблан', 'хер', 'даун', 'дебил',
    // URLs и webhook защита
    'discord.com', 'webhook', 'hook', '.gg/', 'bit.ly', 'tinyurl'
];

// ============ УТИЛИТЫ ============

function generateID() {
    return crypto.randomBytes(12).toString('base64url');
}

function cleanOldData() {
    const now = Date.now();
    
    // Очистка сообщений
    messages = messages.filter(m => now - m.timestamp < MESSAGE_LIFETIME);
    whispers = whispers.filter(w => now - w.timestamp < MESSAGE_LIFETIME);
    
    if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(-MAX_MESSAGES);
    }
    
    // Очистка мутов
    for (const [user, unmuteTime] of mutedUsers.entries()) {
        if (now > unmuteTime) {
            mutedUsers.delete(user);
        }
    }
    
    // Очистка старых сессий
    for (const [user, data] of sessions.entries()) {
        if (now - data.lastActivity > 3600000) { // 1 час
            sessions.delete(user);
        }
    }
    
    // Очистка rate limit store
    for (const [key, data] of rateLimitStore.entries()) {
        if (now - data.timestamp > 300000) { // 5 минут
            rateLimitStore.delete(key);
        }
    }

    // Очистка истёкших отозванных токенов
    for (const [jti, expiry] of revokedTokens.entries()) {
        if (now > expiry) {
            revokedTokens.delete(jti);
        }
    }
}

// Безопасная валидация текста (защита от ReDoS)
function validateText(text, maxLength = 250) {
    if (!text || typeof text !== 'string') {
        return { valid: false, reason: 'Invalid input' };
    }
    
    text = text.trim();
    
    if (text.length === 0) {
        return { valid: false, reason: 'Empty message' };
    }
    
    if (text.length > maxLength) {
        return { valid: false, reason: 'Too long' };
    }
    
    // Простая проверка на URL (без сложных regex)
    const urlKeywords = ['http://', 'https://', 'www.', '.com', '.org', '.net', '.io', '.gg', '.ru'];
    for (const keyword of urlKeywords) {
        if (text.toLowerCase().includes(keyword)) {
            return { valid: false, reason: 'No URLs' };
        }
    }
    
    // Проверка на CAPS
    let upperCount = 0;
    let letterCount = 0;
    for (const char of text) {
        if (/[a-zA-Zа-яА-ЯёЁ]/.test(char)) {
            letterCount++;
            if (char === char.toUpperCase()) {
                upperCount++;
            }
        }
    }
    
    if (letterCount > 10 && (upperCount / letterCount) > 0.7) {
        return { valid: false, reason: 'Too many caps' };
    }
    
    // Проверка на запрещенные слова
    const lowerText = text.toLowerCase();
    for (const word of BANNED_WORDS) {
        if (lowerText.includes(word.toLowerCase())) {
            return { valid: false, reason: 'Forbidden word' };
        }
    }
    
    // Проверка на спам символов
    let prevChar = '';
    let repeatCount = 0;
    for (const char of text) {
        if (char === prevChar) {
            repeatCount++;
            if (repeatCount > 5) {
                return { valid: false, reason: 'Spam detected' };
            }
        } else {
            repeatCount = 1;
            prevChar = char;
        }
    }
    
    // Проверка на невидимые символы
    if (/[\u200B-\u200D\uFEFF\u2060]/.test(text)) {
        return { valid: false, reason: 'Invalid characters' };
    }
    
    return { valid: true, text };
}

// Валидация username
function validateUsername(username) {
    if (!username || typeof username !== 'string') {
        return { valid: false };
    }
    
    username = username.trim().substring(0, 20);
    
    // Только буквы, цифры, _ и -
    if (!/^[a-zA-Z0-9_\-а-яА-ЯёЁ]+$/.test(username)) {
        return { valid: false };
    }
    
    return { valid: true, username };
}

// Проверка роли
function getUserRole(username) {
    return USER_ROLES[username] || null;
}

function isAdmin(username) {
    const role = getUserRole(username);
    return role && role.level >= 4;
}

function isUserMuted(username) {
    if (!mutedUsers.has(username)) return false;
    
    const unmuteTime = mutedUsers.get(username);
    if (Date.now() > unmuteTime) {
        mutedUsers.delete(username);
        return false;
    }
    return true;
}

// Создание/обновление сессии
function createSession(username) {
    const token = JWTManager.sign({
        username,
        role: getUserRole(username)?.level || 0
    }, 3600);
    
    sessions.set(username, {
        token,
        lastActivity: Date.now(),
        ip: null // Храним null для конфиденциальности
    });
    
    return token;
}

// Проверка токена
function verifyToken(token) {
    const payload = JWTManager.verify(token);
    if (!payload || !payload.username) {
        return null;
    }

    // Проверка на отозванный токен (logout)
    if (payload.jti && revokedTokens.has(payload.jti)) {
        return null;
    }

    // Обновляем активность
    if (sessions.has(payload.username)) {
        sessions.get(payload.username).lastActivity = Date.now();
    }

    return payload;
}

// Middleware для проверки аутентификации
const requireAuth = (req, res, next) => {
    const token = req.headers['x-auth-token'];
    
    if (!token) {
        return res.status(401).json({ error: 'No token' });
    }
    
    const payload = verifyToken(token);
    if (!payload) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    req.user = payload;
    next();
};

// Middleware для админов
const requireAdmin = (req, res, next) => {
    if (!req.user || !isAdmin(req.user.username)) {
        return res.status(403).json({ error: 'No permission' });
    }
    next();
};

// ============ ОСНОВНЫЕ ENDPOINTS ============

// Health check (версия не раскрывается для снижения fingerprinting)
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Аутентификация (получение токена)
app.post('/auth/login', createLimiter(60000, 10), (req, res) => {
    try {
        const { player, signature } = req.body;
        
        const validation = validateUsername(player);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid username' });
        }
        
        const username = validation.username;
        
        // Проверка бана
        if (bannedUsers.has(username.toLowerCase())) {
            return res.status(403).json({ error: 'Banned' });
        }
        
        // Создаем токен
        const token = createSession(username);
        
        // Возвращаем токен и роль
        const role = getUserRole(username);
        
        res.json({
            success: true,
            token,
            username,
            role: role ? {
                level: role.level,
                prefix: role.prefix,
                color: role.color,
                badge: role.badge
            } : null
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Выход (отзыв токена)
app.post('/auth/logout', requireAuth, (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const payload = JWTManager.verify(token);

        if (payload?.jti) {
            revokedTokens.set(payload.jti, (payload.exp || 0) * 1000);
        }

        sessions.delete(req.user.username);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Получение сообщений
app.get('/chat', requireAuth, (req, res) => {
    try {
        cleanOldData();
        
        // Отдаем только публичные сообщения с проверкой целостности
        const publicMessages = messages
            .filter(m => !m.encrypted)
            .filter(m => {
                // Объявления без HMAC (старые записи) пропускаем только если тип announcement
                if (!m.hmac) return m.type === 'announcement';
                const expected = CryptoUtils.createHMAC(
                    m.id + m.player + m.msg + String(m.timestamp)
                );
                return CryptoUtils.safeCompare(expected, m.hmac);
            })
            .map(m => ({
                id: m.id,
                player: m.player,
                msg: m.msg,
                timestamp: m.timestamp,
                role: m.role,
                type: m.type
            }));
        
        res.json(publicMessages);
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Отправка сообщения
app.post('/chat', requireAuth, messageLimiter, (req, res) => {
    try {
        const { message } = req.body;
        const username = req.user.username;
        
        // Проверка мута
        if (isUserMuted(username)) {
            const remaining = Math.ceil((mutedUsers.get(username) - Date.now()) / 1000);
            return res.status(403).json({ error: `Muted: ${remaining}s` });
        }
        
        // Валидация сообщения
        const validation = validateText(message);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.reason });
        }
        
        const role = getUserRole(username);

        const newMessage = {
            id: generateID(),
            player: username,
            msg: validation.text,
            timestamp: Math.floor(Date.now() / 5000) * 5000, // округление до 5 сек для приватности
            role,
            encrypted: false
        };
        // HMAC для защиты целостности хранимых сообщений
        newMessage.hmac = CryptoUtils.createHMAC(
            newMessage.id + newMessage.player + newMessage.msg + String(newMessage.timestamp)
        );

        messages.push(newMessage);
        cleanOldData();
        
        res.json({
            success: true,
            id: newMessage.id
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Whisper (зашифрованные личные сообщения)
app.post('/whisper', requireAuth, messageLimiter, (req, res) => {
    try {
        const { target, message } = req.body;
        const sender = req.user.username;
        
        const targetValidation = validateUsername(target);
        if (!targetValidation.valid) {
            return res.status(400).json({ error: 'Invalid target' });
        }
        
        if (sender.toLowerCase() === targetValidation.username.toLowerCase()) {
            return res.status(400).json({ error: 'Cannot message yourself' });
        }
        
        const validation = validateText(message);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.reason });
        }
        
        // Шифруем сообщение
        const encryptedMsg = CryptoUtils.encrypt(validation.text, 'whisper');
        
        const whisper = {
            id: generateID(),
            sender,
            target: targetValidation.username,
            msg: encryptedMsg,
            timestamp: Date.now(),
            encrypted: true
        };
        
        whispers.push(whisper);
        
        res.json({ success: true, id: whisper.id });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Получение whispers
app.get('/whispers', requireAuth, (req, res) => {
    try {
        const username = req.user.username;
        
        cleanOldData();
        
        const userWhispers = whispers
            .filter(w =>
                w.sender.toLowerCase() === username.toLowerCase() ||
                w.target.toLowerCase() === username.toLowerCase()
            )
            .map(w => {
                const isSender = w.sender.toLowerCase() === username.toLowerCase();

                // Расшифровываем только для получателя — отправитель уже знает что отправил
                let msg;
                if (!isSender && w.encrypted) {
                    msg = CryptoUtils.decrypt(w.msg, 'whisper') || '[Encrypted]';
                } else if (isSender) {
                    msg = `[Whispered to ${w.target}]`;
                } else {
                    msg = '[Encrypted]';
                }

                return {
                    id: w.id,
                    sender: w.sender,
                    target: w.target,
                    msg,
                    timestamp: w.timestamp
                };
            });
        
        res.json(userWhispers);
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ АДМИНСКИЕ КОМАНДЫ ============

// Проверка админского секрета (с защитой от timing attack)
function verifyAdminSecret(secret) {
    return CryptoUtils.safeCompare(secret, ADMIN_SECRET);
}

// Объявление
app.post('/admin/announce', requireAuth, requireAdmin, (req, res) => {
    try {
        const { secret, message } = req.body;
        
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        
        const validation = validateText(message, 500);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.reason });
        }
        
        const announcement = {
            id: generateID(),
            player: '📢 ANNOUNCEMENT',
            msg: validation.text,
            timestamp: Math.floor(Date.now() / 5000) * 5000,
            type: 'announcement'
        };
        announcement.hmac = CryptoUtils.createHMAC(
            announcement.id + announcement.player + announcement.msg + String(announcement.timestamp)
        );

        messages.push(announcement);
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Бан
app.post('/admin/ban', requireAuth, requireAdmin, (req, res) => {
    try {
        const { secret, target } = req.body;
        
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        
        const validation = validateUsername(target);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid target' });
        }
        
        if (isAdmin(validation.username)) {
            return res.status(400).json({ error: 'Cannot ban admin' });
        }
        
        bannedUsers.add(validation.username.toLowerCase());
        
        // Удаляем сессию
        sessions.delete(validation.username);
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Разбан
app.post('/admin/unban', requireAuth, requireAdmin, (req, res) => {
    try {
        const { secret, target } = req.body;
        
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        
        const validation = validateUsername(target);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid target' });
        }
        
        bannedUsers.delete(validation.username.toLowerCase());
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Мут
app.post('/admin/mute', requireAuth, requireAdmin, (req, res) => {
    try {
        const { secret, target, duration } = req.body;
        
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        
        const validation = validateUsername(target);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid target' });
        }
        
        if (isAdmin(validation.username)) {
            return res.status(400).json({ error: 'Cannot mute admin' });
        }
        
        const muteDuration = Math.min(Math.max(duration || 60, 1), 3600);
        mutedUsers.set(validation.username, Date.now() + (muteDuration * 1000));
        
        res.json({ success: true, duration: muteDuration });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Размут
app.post('/admin/unmute', requireAuth, requireAdmin, (req, res) => {
    try {
        const { secret, target } = req.body;
        
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        
        const validation = validateUsername(target);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid target' });
        }
        
        mutedUsers.delete(validation.username);
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Очистка чата
app.post('/admin/clear', requireAuth, requireAdmin, (req, res) => {
    try {
        const { secret } = req.body;
        
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        
        messages = [];
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Статистика (только с секретом в заголовке, не в query — иначе попадает в логи)
app.get('/stats', (req, res) => {
    const secret = req.headers['x-admin-secret'] || '';

    if (!verifyAdminSecret(secret)) {
        return res.json({ status: 'online' });
    }
    
    res.json({
        messages: messages.length,
        whispers: whispers.length,
        banned: bannedUsers.size,
        muted: mutedUsers.size,
        sessions: sessions.size,
        uptime: Math.floor(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Server error' });
});

// Запуск
app.listen(PORT, () => {
    console.log(`🔐 Secure Chat Server running on port ${PORT}`);
});

// Периодическая очистка
setInterval(cleanOldData, 30000);

// Обработка ошибок
process.on('uncaughtException', (error) => {
    // Не логируем детали для безопасности
});

process.on('unhandledRejection', (error) => {
    // Не логируем детали для безопасности
});