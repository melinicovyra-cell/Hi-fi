// ============================================
// ULTRA-SECURE CHAT SERVER v4.0
// Features: SQL persistence (PostgreSQL), E2E-style at-rest encryption,
//           JWT, HMAC, rate limiting, ban/mute enforcement.
// Designed for deployment on Render.
// ============================================

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;

// Render (and most hosts) put the app behind a reverse proxy.
// Trust exactly one hop so req.ip / X-Forwarded-For work for rate limiting.
app.set('trust proxy', 1);

// ============ SECURE CONFIGURATION ============

const CRYPTO_CONFIG = {
    ALGORITHM: 'aes-256-gcm',
    KEY_LENGTH: 32,
    IV_LENGTH: 16,
    AUTH_TAG_LENGTH: 16,
    SALT_LENGTH: 32,
    PBKDF2_ITERATIONS: 100000,
};

// Secrets come from environment variables. On Render set these once
// (render.yaml generates and persists them). The random fallback is for
// local dev ONLY — if MASTER_KEY changes, previously stored encrypted
// messages can no longer be decrypted.
const MASTER_KEY = process.env.MASTER_KEY || crypto.randomBytes(32).toString('hex');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const ADMIN_SECRET = process.env.ADMIN_SECRET || crypto.randomBytes(32).toString('hex');
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.MASTER_KEY) {
    console.log('⚠️  No persistent secrets found. SAVE THESE in your env (Render dashboard):');
    console.log(`MASTER_KEY=${MASTER_KEY}`);
    console.log(`JWT_SECRET=${JWT_SECRET}`);
    console.log(`ADMIN_SECRET=${ADMIN_SECRET}`);
    console.log(`HMAC_SECRET=${HMAC_SECRET}`);
    console.log('==========================================\n');
}

// ============ CRYPTO UTILITIES ============

class CryptoUtils {
    static deriveKey(purpose, salt) {
        return crypto.pbkdf2Sync(
            MASTER_KEY + purpose,
            salt,
            CRYPTO_CONFIG.PBKDF2_ITERATIONS,
            CRYPTO_CONFIG.KEY_LENGTH,
            'sha256'
        );
    }

    static encrypt(plaintext, purpose = 'default') {
        const iv = crypto.randomBytes(CRYPTO_CONFIG.IV_LENGTH);
        const salt = crypto.randomBytes(CRYPTO_CONFIG.SALT_LENGTH);
        const key = this.deriveKey(purpose, salt);

        const cipher = crypto.createCipheriv(CRYPTO_CONFIG.ALGORITHM, key, iv);
        let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
        ciphertext += cipher.final('hex');
        const authTag = cipher.getAuthTag();

        return Buffer.concat([
            salt,
            iv,
            authTag,
            Buffer.from(ciphertext, 'hex'),
        ]).toString('base64');
    }

    static decrypt(encrypted, purpose = 'default') {
        try {
            const buffer = Buffer.from(encrypted, 'base64');

            const salt = buffer.slice(0, CRYPTO_CONFIG.SALT_LENGTH);
            const iv = buffer.slice(
                CRYPTO_CONFIG.SALT_LENGTH,
                CRYPTO_CONFIG.SALT_LENGTH + CRYPTO_CONFIG.IV_LENGTH
            );
            const authTag = buffer.slice(
                CRYPTO_CONFIG.SALT_LENGTH + CRYPTO_CONFIG.IV_LENGTH,
                CRYPTO_CONFIG.SALT_LENGTH +
                    CRYPTO_CONFIG.IV_LENGTH +
                    CRYPTO_CONFIG.AUTH_TAG_LENGTH
            );
            const ciphertext = buffer.slice(
                CRYPTO_CONFIG.SALT_LENGTH +
                    CRYPTO_CONFIG.IV_LENGTH +
                    CRYPTO_CONFIG.AUTH_TAG_LENGTH
            );

            const key = this.deriveKey(purpose, salt);

            const decipher = crypto.createDecipheriv(
                CRYPTO_CONFIG.ALGORITHM,
                key,
                iv
            );
            decipher.setAuthTag(authTag);

            let plaintext = decipher.update(ciphertext, null, 'utf8');
            plaintext += decipher.final('utf8');

            return plaintext;
        } catch (e) {
            return null;
        }
    }

    static hash(data, salt = '') {
        return crypto
            .createHash('sha256')
            .update(data + salt + HMAC_SECRET)
            .digest('hex');
    }

    static safeCompare(a, b) {
        try {
            const bufA = Buffer.from(String(a));
            const bufB = Buffer.from(String(b));
            if (bufA.length !== bufB.length) return false;
            return crypto.timingSafeEqual(bufA, bufB);
        } catch {
            return false;
        }
    }
}

// ============ JWT ============

class JWTManager {
    static sign(payload, expiresIn = 3600) {
        const header = { alg: 'HS256', typ: 'JWT' };
        const now = Math.floor(Date.now() / 1000);
        const claims = {
            ...payload,
            iat: now,
            exp: now + expiresIn,
            jti: crypto.randomBytes(16).toString('hex'),
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

            const payload = JSON.parse(
                Buffer.from(encodedPayload, 'base64url').toString()
            );

            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) return null;

            return payload;
        } catch {
            return null;
        }
    }
}

// ============ IP PROTECTION ============

class IPProtection {
    static hashIP(ip) {
        return CryptoUtils.hash(ip, 'ip-salt');
    }
}

// ============ HELMET ============

app.use(
    helmet({
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
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        ieNoOpen: true,
        noSniff: true,
        originAgentCluster: true,
        permittedCrossDomainPolicies: { permittedPolicies: 'none' },
        referrerPolicy: { policy: 'no-referrer' },
        xssFilter: true,
    })
);

// ============ CORS ============

const BLOCKED_ORIGINS = [
    'discord.com', 'slack.com', 'telegram.org', 'zapier.com',
    'ifttt.com', 'integromat.com', 'make.com', 'webhooks.io',
];

app.use(
    cors({
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
        maxAge: 600,
    })
);

// ============ BODY PARSING ============

app.use(
    express.json({
        limit: '3kb',
        strict: true,
        reviver: (key, value) => {
            // Prototype pollution protection
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                return undefined;
            }
            return value;
        },
    })
);

// ============ ANTI-WEBHOOK / BOT FILTER ============

const BLOCKED_USER_AGENTS = [
    'discord', 'slack', 'telegram', 'webhook', 'bot', 'crawler',
    'spider', 'curl', 'wget', 'python', 'httpie', 'postman',
    'insomnia', 'axios', 'fetch', 'got',
];

app.use((req, res, next) => {
    // Allow the health check through unconditionally (Render pings it).
    if (req.path === '/health') return next();

    const ua = (req.headers['user-agent'] || '').toLowerCase();

    if (!ua || ua.length < 10) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    for (const blocked of BLOCKED_USER_AGENTS) {
        if (ua.includes(blocked)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }
    if (req.headers['x-webhook'] || req.headers['x-hook']) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
});

// Request ID
app.use((req, res, next) => {
    req.id = crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-ID', req.id);
    next();
});

function getClientIP(req) {
    const rawIP =
        req.ip ||
        req.headers['x-forwarded-for']?.split(',')[0] ||
        req.connection?.remoteAddress ||
        'unknown';
    return IPProtection.hashIP(rawIP);
}

// ============ RATE LIMITING ============

const createLimiter = (windowMs, max) =>
    rateLimit({
        windowMs,
        max,
        keyGenerator: (req) => getClientIP(req),
        handler: (req, res) => {
            res.status(429).json({
                error: 'Rate limit exceeded',
                retryAfter: Math.ceil(windowMs / 1000),
            });
        },
        standardHeaders: false,
        legacyHeaders: false,
    });

// Global limit
app.use(createLimiter(60000, 100));

// Per-user message limiter (keyed by IP + authenticated username)
// Owner/admins (privileged) bypass the per-message cooldown entirely.
const messageLimiter = rateLimit({
    windowMs: 3000,
    max: 1,
    keyGenerator: (req) => {
        const ip = getClientIP(req);
        const username = req.user?.username || '';
        return CryptoUtils.hash(ip + username);
    },
    skip: (req) => !!(req.user && isAdmin(req.user.username)),
    handler: (req, res) => {
        res.status(429).json({ error: 'Rate limit exceeded', retryAfter: 3 });
    },
    standardHeaders: false,
    legacyHeaders: false,
});

// ============ IN-MEMORY SESSION TRACKING (non-persistent) ============
// JWT is stateless; this only tracks activity for stats. Bans/mutes are
// enforced via the database on every message, so they survive restarts.

const sessions = new Map();
const MAX_SERVED_MESSAGES = 100;

// ============ ROLES ============

const USER_ROLES = {
    hihpik0: { level: 5, prefix: '👑 CREATOR', color: 'RAINBOW', badge: '👑' },
    BAAAAHHRR: { level: 4, prefix: '⚡ ADMIN', color: 'GOLD', badge: '⚡' },
};

const ADMIN_LEVEL = 4;

// ============ CONTENT FILTER ============

const BANNED_WORDS = [
    'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'cunt', 'whore',
    'faggot', 'kys', 'rape', 'retard', 'cancer', 'aids',
    'хуй', 'пизда', 'ебать', 'бля', 'блять', 'шлюха', 'пидор',
    'гандон', 'мразь', 'сука', 'еблан', 'хер', 'даун', 'дебил',
    'discord.com', 'webhook', 'hook', '.gg/', 'bit.ly', 'tinyurl',
];

// ============ UTILITIES ============

function generateID() {
    return crypto.randomBytes(12).toString('base64url');
}

function getUserRole(username) {
    return USER_ROLES[username] || null;
}

function isAdmin(username) {
    const role = getUserRole(username);
    return role && role.level >= ADMIN_LEVEL;
}

function validateText(text, maxLength = 250) {
    if (!text || typeof text !== 'string') {
        return { valid: false, reason: 'Invalid input' };
    }

    text = text.trim();

    if (text.length === 0) return { valid: false, reason: 'Empty message' };
    if (text.length > maxLength) return { valid: false, reason: 'Too long' };

    const urlKeywords = ['http://', 'https://', 'www.', '.com', '.org', '.net', '.io', '.gg', '.ru'];
    for (const keyword of urlKeywords) {
        if (text.toLowerCase().includes(keyword)) {
            return { valid: false, reason: 'No URLs' };
        }
    }

    let upperCount = 0;
    let letterCount = 0;
    for (const char of text) {
        if (/[a-zA-Zа-яА-ЯёЁ]/.test(char)) {
            letterCount++;
            if (char === char.toUpperCase()) upperCount++;
        }
    }
    if (letterCount > 10 && upperCount / letterCount > 0.7) {
        return { valid: false, reason: 'Too many caps' };
    }

    const lowerText = text.toLowerCase();
    for (const word of BANNED_WORDS) {
        if (lowerText.includes(word.toLowerCase())) {
            return { valid: false, reason: 'Forbidden word' };
        }
    }

    let prevChar = '';
    let repeatCount = 0;
    for (const char of text) {
        if (char === prevChar) {
            repeatCount++;
            if (repeatCount > 5) return { valid: false, reason: 'Spam detected' };
        } else {
            repeatCount = 1;
            prevChar = char;
        }
    }

    if (/[​-‍﻿⁠]/.test(text)) {
        return { valid: false, reason: 'Invalid characters' };
    }

    return { valid: true, text };
}

function validateUsername(username) {
    if (!username || typeof username !== 'string') return { valid: false };
    username = username.trim().substring(0, 20);
    if (!/^[a-zA-Z0-9_\-а-яА-ЯёЁ]+$/.test(username)) return { valid: false };
    return { valid: true, username };
}

function createSession(username) {
    const token = JWTManager.sign(
        { username, role: getUserRole(username)?.level || 0 },
        3600
    );
    sessions.set(username, { lastActivity: Date.now() });
    return token;
}

function verifyToken(token) {
    const payload = JWTManager.verify(token);
    if (!payload || !payload.username) return null;
    if (sessions.has(payload.username)) {
        sessions.get(payload.username).lastActivity = Date.now();
    }
    return payload;
}

function verifyAdminSecret(secret) {
    return CryptoUtils.safeCompare(secret || '', ADMIN_SECRET);
}

// ============ MIDDLEWARE ============

const requireAuth = (req, res, next) => {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: 'No token' });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Invalid token' });

    req.user = payload;
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.user || !isAdmin(req.user.username)) {
        return res.status(403).json({ error: 'No permission' });
    }
    next();
};

// Enforce bans on every write — works even with an otherwise-valid token,
// because the ban list lives in the database (survives restarts).
const requireNotBanned = async (req, res, next) => {
    try {
        if (await db.isBanned(req.user.username)) {
            return res.status(403).json({ error: 'Banned' });
        }
        next();
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
};

// ============ ENDPOINTS ============

app.get('/health', async (req, res) => {
    res.json({ status: 'ok', version: '4.0', storage: db.kind });
});

// Login. Regular users authenticate by username (the game vouches for it).
// Privileged accounts (admins) MUST present the correct ADMIN_SECRET so they
// cannot be impersonated.
app.post('/auth/login', createLimiter(60000, 10), async (req, res) => {
    try {
        const { player, adminSecret } = req.body;

        const validation = validateUsername(player);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid username' });
        }
        const username = validation.username;

        if (await db.isBanned(username)) {
            return res.status(403).json({ error: 'Banned' });
        }

        const role = getUserRole(username);

        // Anti-impersonation: privileged usernames require the admin secret.
        if (role && role.level >= ADMIN_LEVEL) {
            if (!verifyAdminSecret(adminSecret)) {
                return res.status(403).json({ error: 'Admin verification failed' });
            }
        }

        const token = createSession(username);

        res.json({
            success: true,
            token,
            username,
            role: role
                ? {
                      level: role.level,
                      prefix: role.prefix,
                      color: role.color,
                      badge: role.badge,
                  }
                : null,
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get public chat messages
app.get('/chat', requireAuth, async (req, res) => {
    try {
        const stored = await db.getRecentMessages(MAX_SERVED_MESSAGES);
        const publicMessages = stored.map((m) => ({
            id: m.id,
            player: m.player,
            msg: m.encrypted
                ? CryptoUtils.decrypt(m.msg, 'message') ?? '[unavailable]'
                : m.msg,
            timestamp: m.timestamp,
            role: m.role,
            type: m.type,
        }));
        res.json(publicMessages);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Send a public chat message
app.post('/chat', requireAuth, requireNotBanned, messageLimiter, async (req, res) => {
    try {
        const { message } = req.body;
        const username = req.user.username;

        // Owner/admin bypass: privileged accounts skip the mute and the content
        // filter (rate limit is already skipped in messageLimiter). Privilege is
        // proven by ADMIN_SECRET at login, so it can't be impersonated.
        const privileged = isAdmin(username);

        if (!privileged) {
            const muteUntil = await db.getMuteUntil(username);
            if (muteUntil) {
                const remaining = Math.ceil((muteUntil - Date.now()) / 1000);
                return res.status(403).json({ error: `Muted: ${remaining}s` });
            }
        }

        let text;
        if (privileged) {
            if (!message || typeof message !== 'string') {
                return res.status(400).json({ error: 'Invalid input' });
            }
            text = message.trim().slice(0, 500);
            if (text.length === 0) {
                return res.status(400).json({ error: 'Empty message' });
            }
        } else {
            const validation = validateText(message);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.reason });
            }
            text = validation.text;
        }

        const role = getUserRole(username);
        const newMessage = {
            id: generateID(),
            player: username,
            // Encrypted at rest — a leaked DB does not expose chat content.
            msg: CryptoUtils.encrypt(text, 'message'),
            timestamp: Date.now(),
            role,
            type: 'message',
            encrypted: true,
        };

        await db.saveMessage(newMessage);
        res.json({ success: true, id: newMessage.id });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Send an encrypted private whisper
app.post('/whisper', requireAuth, requireNotBanned, messageLimiter, async (req, res) => {
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

        const privileged = isAdmin(sender);

        let text;
        if (privileged) {
            if (!message || typeof message !== 'string') {
                return res.status(400).json({ error: 'Invalid input' });
            }
            text = message.trim().slice(0, 500);
            if (text.length === 0) {
                return res.status(400).json({ error: 'Empty message' });
            }
        } else {
            const validation = validateText(message);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.reason });
            }
            text = validation.text;

            const muteUntil = await db.getMuteUntil(sender);
            if (muteUntil) {
                const remaining = Math.ceil((muteUntil - Date.now()) / 1000);
                return res.status(403).json({ error: `Muted: ${remaining}s` });
            }
        }

        const whisper = {
            id: generateID(),
            sender,
            target: targetValidation.username,
            msg: CryptoUtils.encrypt(text, 'whisper'),
            timestamp: Date.now(),
            encrypted: true,
        };

        await db.saveWhisper(whisper);
        res.json({ success: true, id: whisper.id });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get whispers for the authenticated user
app.get('/whispers', requireAuth, async (req, res) => {
    try {
        const username = req.user.username;
        const stored = await db.getWhispersFor(username);
        const userWhispers = stored.map((w) => ({
            id: w.id,
            sender: w.sender,
            target: w.target,
            msg: w.encrypted
                ? CryptoUtils.decrypt(w.msg, 'whisper') ?? '[Encrypted]'
                : w.msg,
            timestamp: w.timestamp,
        }));
        res.json(userWhispers);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ ADMIN COMMANDS ============

app.post('/admin/announce', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { secret, message } = req.body;
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        const validation = validateText(message, 500);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.reason });
        }
        await db.saveMessage({
            id: generateID(),
            player: '📢 ANNOUNCEMENT',
            msg: CryptoUtils.encrypt(validation.text, 'message'),
            timestamp: Date.now(),
            type: 'announcement',
            encrypted: true,
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/admin/ban', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { secret, target, reason } = req.body;
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
        await db.addBan(validation.username, reason, req.user.username);
        sessions.delete(validation.username);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/admin/unban', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { secret, target } = req.body;
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        const validation = validateUsername(target);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid target' });
        }
        await db.removeBan(validation.username);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/admin/bans', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { secret } = req.query;
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        res.json(await db.listBans());
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/admin/mute', requireAuth, requireAdmin, async (req, res) => {
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
        const muteDuration = Math.min(Math.max(parseInt(duration, 10) || 60, 1), 3600);
        await db.addMute(
            validation.username,
            Date.now() + muteDuration * 1000,
            req.user.username
        );
        res.json({ success: true, duration: muteDuration });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/admin/unmute', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { secret, target } = req.body;
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        const validation = validateUsername(target);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid target' });
        }
        await db.removeMute(validation.username);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/admin/clear', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { secret } = req.body;
        if (!verifyAdminSecret(secret)) {
            return res.status(403).json({ error: 'Invalid secret' });
        }
        await db.clearMessages();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Stats (basic when no secret, detailed with the admin secret)
app.get('/stats', async (req, res) => {
    try {
        const { secret } = req.query;
        if (!verifyAdminSecret(secret)) {
            return res.json({ status: 'online' });
        }
        const counts = await db.stats();
        res.json({
            ...counts,
            sessions: sessions.size,
            storage: db.kind,
            uptime: Math.floor(process.uptime()),
            memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Server error' });
});

// ============ STARTUP ============

async function start() {
    try {
        await db.init();
        console.log(`💾 Storage backend: ${db.kind}`);
    } catch (e) {
        console.error('❌ Failed to initialize database:', e.message);
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log(`🔐 Secure Chat Server v4.0 running on port ${PORT}`);
    });

    // Periodic cleanup of expired rows.
    setInterval(() => {
        db.cleanupExpired().catch(() => {});
    }, 60000);
}

start();

// Don't leak error details; keep the process alive.
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
