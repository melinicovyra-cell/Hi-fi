// server.js - Безопасный сервер для Global Chat (без логов)
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// ============ ЗАЩИТА ОТ WEBHOOKS И БОТОВ ============

// Блокировка подозрительных User-Agent
const BLOCKED_USER_AGENTS = [
    'discord', 'slack', 'telegram', 'webhook', 'bot', 'crawler', 
    'spider', 'curl', 'wget', 'python', 'httpie', 'postman',
    'insomnia', 'paw', 'httpbot', 'fetcher', 'scraper'
];

// Блокировка подозрительных заголовков
const SUSPICIOUS_HEADERS = [
    'x-webhook', 'x-discord', 'x-slack', 'x-telegram',
    'x-forwarded-for-webhook', 'x-hook'
];

// Middleware для блокировки веб-хуков и ботов
const antiWebhookMiddleware = (req, res, next) => {
    // Проверка User-Agent
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    
    if (!userAgent || userAgent.length < 10) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    for (const blocked of BLOCKED_USER_AGENTS) {
        if (userAgent.includes(blocked)) {
            return res.status(403).json({ error: 'Access denied' });
        }
    }
    
    // Проверка подозрительных заголовков
    for (const header of SUSPICIOUS_HEADERS) {
        if (req.headers[header]) {
            return res.status(403).json({ error: 'Access denied' });
        }
    }
    
    // Блокировка если нет Accept заголовка (типично для webhooks)
    if (!req.headers['accept']) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    // Проверка Content-Type для POST запросов
    if (req.method === 'POST') {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('application/json')) {
            return res.status(400).json({ error: 'Invalid content type' });
        }
    }
    
    // Блокировка запросов с webhook в URL или body
    const url = req.originalUrl.toLowerCase();
    if (url.includes('webhook') || url.includes('hook') || url.includes('callback')) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    next();
};

// Проверка тела запроса на webhook паттерны
const antiWebhookBodyCheck = (req, res, next) => {
    if (req.body) {
        const bodyStr = JSON.stringify(req.body).toLowerCase();
        const webhookPatterns = [
            'webhook', 'discord.com/api/webhooks', 'hooks.slack.com',
            'api.telegram.org', 'callback_url', 'hook_url', 'notify_url'
        ];
        
        for (const pattern of webhookPatterns) {
            if (bodyStr.includes(pattern)) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }
    }
    next();
};

// ============ MIDDLEWARE ============

// Helmet с усиленными настройками
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "same-origin" },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: { maxAge: 31536000, includeSubDomains: true },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
    referrerPolicy: { policy: "no-referrer" },
    xssFilter: true,
}));

// CORS с ограничениями
app.use(cors({
    origin: function (origin, callback) {
        // Разрешаем запросы без origin (мобильные приложения, игры)
        // Но блокируем известные webhook сервисы
        if (origin) {
            const blockedOrigins = [
                'discord.com', 'slack.com', 'telegram.org',
                'zapier.com', 'ifttt.com', 'integromat.com', 'make.com'
            ];
            for (const blocked of blockedOrigins) {
                if (origin.includes(blocked)) {
                    return callback(new Error('Not allowed'), false);
                }
            }
        }
        callback(null, true);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Game-Token'],
    maxAge: 86400
}));

// Парсинг JSON с ограничением
app.use(express.json({ limit: '5kb' }));

// Применяем анти-webhook защиту
app.use(antiWebhookMiddleware);
app.use(antiWebhookBodyCheck);

// Rate limiting
const limiter = rateLimit({
    windowMs: 1000,
    max: 5,
    message: { error: 'Too many requests' },
    standardHeaders: false,
    legacyHeaders: false,
    // Без логов
    skip: () => false,
});

const messageLimiter = rateLimit({
    windowMs: 2000,
    max: 1,
    message: { error: 'Wait before sending' },
    keyGenerator: (req) => {
        // Комбинируем IP + игрока для более точного лимита
        const player = req.body?.player || '';
        const ip = req.ip || req.connection?.remoteAddress || '';
        return crypto.createHash('md5').update(ip + player).digest('hex');
    },
    standardHeaders: false,
    legacyHeaders: false,
});

// IP-based rate limit для защиты от DDoS
const ipLimiter = rateLimit({
    windowMs: 60000, // 1 минута
    max: 60, // 60 запросов в минуту с одного IP
    message: { error: 'Too many requests from this IP' },
    standardHeaders: false,
    legacyHeaders: false,
});

app.use(ipLimiter);
app.use('/chat', limiter);

// ============ ХРАНИЛИЩЕ ДАННЫХ ============

let messages = [];
let whispers = [];
let bannedUsers = new Set();
let mutedUsers = new Map();
let bannedIPs = new Set();
let requestLog = new Map(); // Для обнаружения подозрительной активности

const MAX_MESSAGES = 100;
const MESSAGE_LIFETIME = 5 * 60 * 1000;

// Роли пользователей
const USER_ROLES = {
    'hihpik0': { level: 5, prefix: '👑 СОЗДАТЕЛЬ', color: 'RAINBOW', badge: '👑' },
    'BAAAAHHRR': { level: 4, prefix: '⚡ АДМИН', color: 'GOLD', badge: '⚡' },
};

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'super-secret-admin-key-12345';

// Расширенный список запрещённых слов
const BANNED_WORDS = [
    'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'cunt', 'whore', 'faggot', 'kys', 'rape',
    'хуй', 'пизда', 'ебать', 'бля', 'шлюха', 'пидор', 'гандон', 'мразь', 'сука', 'еблан',
    'хер', 'даун', 'дебил', 'идиот', 'урод',
    // Защита от URL-инъекций
    'webhook', 'discord.com', 'slack.com', 'telegram'
];

// ============ УТИЛИТЫ ============

function generateMessageId() {
    return crypto.randomBytes(8).toString('hex');
}

function generateToken() {
    return crypto.randomBytes(16).toString('hex');
}

function cleanOldMessages() {
    const now = Date.now();
    messages = messages.filter(m => now - m.timestamp < MESSAGE_LIFETIME);
    whispers = whispers.filter(w => now - w.timestamp < MESSAGE_LIFETIME);
    
    if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(-MAX_MESSAGES);
    }
    
    // Очистка старых записей в requestLog
    for (const [ip, data] of requestLog.entries()) {
        if (now - data.lastRequest > 300000) { // 5 минут
            requestLog.delete(ip);
        }
    }
}

function filterMessage(text) {
    if (!text || typeof text !== 'string') {
        return { valid: false, reason: 'Empty message' };
    }
    
    text = text.trim();
    
    if (text.length === 0) {
        return { valid: false, reason: 'Empty message' };
    }
    
    if (text.length > 250) {
        return { valid: false, reason: 'Message too long' };
    }
    
    // Блокировка URL
    const urlPattern = /(https?:\/\/|www\.|\.com|\.org|\.net|\.io|\.gg|\.ru|\.ua|\.xyz)/i;
    if (urlPattern.test(text)) {
        return { valid: false, reason: 'URLs not allowed' };
    }
    
    // Проверка на Caps Lock
    const upperCount = (text.match(/[A-ZА-ЯЁ]/g) || []).length;
    const letterCount = (text.match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length;
    if (letterCount > 10 && (upperCount / letterCount) > 0.7) {
        return { valid: false, reason: 'Too many caps' };
    }
    
    // Проверка на запрещённые слова
    const lowerText = text.toLowerCase();
    for (const word of BANNED_WORDS) {
        if (lowerText.includes(word.toLowerCase())) {
            return { valid: false, reason: 'Forbidden word detected' };
        }
    }
    
    // Проверка на спам символов
    if (/(.)\1{5,}/.test(text)) {
        return { valid: false, reason: 'Spam detected' };
    }
    
    // Проверка на невидимые символы и zero-width
    if (/[\u200B-\u200D\uFEFF\u2060]/.test(text)) {
        return { valid: false, reason: 'Invalid characters' };
    }
    
    return { valid: true, filtered: text };
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

function getUserRole(username) {
    return USER_ROLES[username] || null;
}

function isAdmin(username) {
    const role = getUserRole(username);
    return role && role.level >= 4;
}

function getClientIP(req) {
    return req.ip || 
           req.headers['x-forwarded-for']?.split(',')[0] || 
           req.connection?.remoteAddress || 
           'unknown';
}

// Обнаружение подозрительной активности
function trackRequest(req) {
    const ip = getClientIP(req);
    const now = Date.now();
    
    if (!requestLog.has(ip)) {
        requestLog.set(ip, {
            count: 0,
            lastRequest: now,
            suspicious: 0
        });
    }
    
    const data = requestLog.get(ip);
    data.count++;
    data.lastRequest = now;
    
    // Если слишком много запросов - помечаем как подозрительный
    if (data.count > 100) {
        data.suspicious++;
        if (data.suspicious > 5) {
            bannedIPs.add(ip);
        }
    }
}

// Middleware для проверки забаненных IP
const checkBannedIP = (req, res, next) => {
    const ip = getClientIP(req);
    if (bannedIPs.has(ip)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    trackRequest(req);
    next();
};

app.use(checkBannedIP);

// ============ API ENDPOINTS ============

// Главная страница (минимальная информация)
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        version: '24.0'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Получение сообщений
app.get('/chat', (req, res) => {
    try {
        cleanOldMessages();
        const publicMessages = messages.filter(m => !m.isWhisper);
        res.json(publicMessages);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Отправка сообщения
app.post('/chat', messageLimiter, (req, res) => {
    try {
        const { player, message } = req.body;
        
        if (!player || typeof player !== 'string') {
            return res.status(400).json({ error: 'Invalid player' });
        }
        
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Invalid message' });
        }
        
        const username = player.trim().substring(0, 50);
        
        // Валидация имени пользователя
        if (!/^[a-zA-Z0-9_\-а-яА-ЯёЁ]+$/.test(username)) {
            return res.status(400).json({ error: 'Invalid username' });
        }
        
        if (bannedUsers.has(username.toLowerCase())) {
            return res.status(403).json({ error: 'Banned' });
        }
        
        if (isUserMuted(username)) {
            const remaining = Math.ceil((mutedUsers.get(username) - Date.now()) / 1000);
            return res.status(403).json({ error: `Muted: ${remaining}s` });
        }
        
        const filterResult = filterMessage(message);
        if (!filterResult.valid) {
            return res.status(400).json({ error: filterResult.reason });
        }
        
        const role = getUserRole(username);
        
        const newMessage = {
            id: generateMessageId(),
            player: username,
            msg: filterResult.filtered,
            timestamp: Date.now(),
            role: role
        };
        
        messages.push(newMessage);
        cleanOldMessages();
        
        res.json({ 
            success: true, 
            id: newMessage.id,
            message: newMessage
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Whisper (личные сообщения)
app.post('/whisper', messageLimiter, (req, res) => {
    try {
        const { sender, target, message } = req.body;
        
        if (!sender || !target || !message) {
            return res.status(400).json({ error: 'Invalid data' });
        }
        
        if (sender.toLowerCase() === target.toLowerCase()) {
            return res.status(400).json({ error: 'Cannot message yourself' });
        }
        
        if (bannedUsers.has(sender.toLowerCase())) {
            return res.status(403).json({ error: 'Banned' });
        }
        
        const filterResult = filterMessage(message);
        if (!filterResult.valid) {
            return res.status(400).json({ error: filterResult.reason });
        }
        
        const whisperMessage = {
            id: generateMessageId(),
            sender: sender.trim(),
            target: target.trim(),
            msg: filterResult.filtered,
            timestamp: Date.now(),
            isWhisper: true
        };
        
        whispers.push(whisperMessage);
        
        res.json({ success: true, id: whisperMessage.id });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Получение whispers
app.get('/whispers/:username', (req, res) => {
    try {
        const username = req.params.username.toLowerCase();
        
        // Валидация
        if (!/^[a-zA-Z0-9_\-а-яА-ЯёЁ]+$/.test(username)) {
            return res.status(400).json({ error: 'Invalid username' });
        }
        
        cleanOldMessages();
        
        const userWhispers = whispers.filter(w => 
            w.sender.toLowerCase() === username || 
            w.target.toLowerCase() === username
        );
        
        res.json(userWhispers);
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Проверка роли
app.get('/check-role', (req, res) => {
    try {
        const player = req.query.player;
        
        if (!player) {
            return res.status(400).json({ error: 'No player specified' });
        }
        
        const role = getUserRole(player);
        
        if (role) {
            res.json({
                role: role.level >= 4 ? 'ADMIN' : 'VIP',
                level: role.level,
                prefix: role.prefix,
                color: role.color,
                badge: role.badge
            });
        } else {
            res.json({ role: 'USER', level: 0 });
        }
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ АДМИНСКИЕ КОМАНДЫ ============

// Общая проверка для админских запросов
function adminCheck(req, res) {
    const { admin, secret } = req.body;
    
    if (secret !== ADMIN_SECRET) {
        return { valid: false, status: 403, error: 'Invalid key' };
    }
    
    if (!isAdmin(admin)) {
        return { valid: false, status: 403, error: 'No permission' };
    }
    
    return { valid: true };
}

// Объявление
app.post('/admin/announce', (req, res) => {
    try {
        const check = adminCheck(req, res);
        if (!check.valid) {
            return res.status(check.status).json({ error: check.error });
        }
        
        const { admin, message } = req.body;
        
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Invalid message' });
        }
        
        const announcement = {
            id: generateMessageId(),
            player: '📢 ANNOUNCEMENT',
            msg: message.substring(0, 500),
            timestamp: Date.now(),
            type: 'announcement'
        };
        
        messages.push(announcement);
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Бан
app.post('/admin/ban', (req, res) => {
    try {
        const check = adminCheck(req, res);
        if (!check.valid) {
            return res.status(check.status).json({ error: check.error });
        }
        
        const { target } = req.body;
        
        if (!target) {
            return res.status(400).json({ error: 'No target' });
        }
        
        if (isAdmin(target)) {
            return res.status(400).json({ error: 'Cannot ban admin' });
        }
        
        bannedUsers.add(target.toLowerCase());
        
        messages.push({
            id: generateMessageId(),
            player: '🔨 SYSTEM',
            msg: `${target} was banned`,
            timestamp: Date.now(),
            type: 'system'
        });
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Разбан
app.post('/admin/unban', (req, res) => {
    try {
        const check = adminCheck(req, res);
        if (!check.valid) {
            return res.status(check.status).json({ error: check.error });
        }
        
        const { target } = req.body;
        
        if (!target) {
            return res.status(400).json({ error: 'No target' });
        }
        
        bannedUsers.delete(target.toLowerCase());
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Мут
app.post('/admin/mute', (req, res) => {
    try {
        const check = adminCheck(req, res);
        if (!check.valid) {
            return res.status(check.status).json({ error: check.error });
        }
        
        const { target, duration } = req.body;
        
        if (!target) {
            return res.status(400).json({ error: 'No target' });
        }
        
        if (isAdmin(target)) {
            return res.status(400).json({ error: 'Cannot mute admin' });
        }
        
        const muteDuration = Math.min(Math.max(duration || 60, 1), 3600);
        const unmuteTime = Date.now() + (muteDuration * 1000);
        
        mutedUsers.set(target, unmuteTime);
        
        messages.push({
            id: generateMessageId(),
            player: '🔇 SYSTEM',
            msg: `${target} muted for ${muteDuration}s`,
            timestamp: Date.now(),
            type: 'system'
        });
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Размут
app.post('/admin/unmute', (req, res) => {
    try {
        const check = adminCheck(req, res);
        if (!check.valid) {
            return res.status(check.status).json({ error: check.error });
        }
        
        const { target } = req.body;
        
        if (!target) {
            return res.status(400).json({ error: 'No target' });
        }
        
        mutedUsers.delete(target);
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Очистка чата
app.post('/admin/clear', (req, res) => {
    try {
        const check = adminCheck(req, res);
        if (!check.valid) {
            return res.status(check.status).json({ error: check.error });
        }
        
        messages = [];
        
        messages.push({
            id: generateMessageId(),
            player: '🧹 SYSTEM',
            msg: 'Chat cleared',
            timestamp: Date.now(),
            type: 'system'
        });
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Список забаненных
app.get('/admin/banned', (req, res) => {
    try {
        const { secret } = req.query;
        
        if (secret !== ADMIN_SECRET) {
            return res.status(403).json({ error: 'Invalid key' });
        }
        
        res.json({
            banned: Array.from(bannedUsers),
            muted: Object.fromEntries(mutedUsers),
            bannedIPs: bannedIPs.size
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Бан IP (только для создателя)
app.post('/admin/ban-ip', (req, res) => {
    try {
        const { admin, secret, ip } = req.body;
        
        if (secret !== ADMIN_SECRET) {
            return res.status(403).json({ error: 'Invalid key' });
        }
        
        const role = getUserRole(admin);
        if (!role || role.level < 5) {
            return res.status(403).json({ error: 'No permission' });
        }
        
        if (ip) {
            bannedIPs.add(ip);
        }
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Статистика (только для админов)
app.get('/stats', (req, res) => {
    const { secret } = req.query;
    
    if (secret !== ADMIN_SECRET) {
        return res.json({ status: 'online' });
    }
    
    res.json({
        messages_count: messages.length,
        whispers_count: whispers.length,
        banned_count: bannedUsers.size,
        muted_count: mutedUsers.size,
        banned_ips: bannedIPs.size,
        tracked_ips: requestLog.size,
        uptime_seconds: Math.floor(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

// 404 для неизвестных маршрутов
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Глобальный обработчик ошибок (без логов)
app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Server error' });
});

// Запуск сервера (без логов)
app.listen(PORT, () => {
    // Ничего не логируем
});

// Периодическая очистка (без логов)
setInterval(cleanOldMessages, 60000);

// Обработка необработанных исключений (без логов)
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});