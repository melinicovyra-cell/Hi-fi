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
// Shared client key: if set, every request must carry the matching X-Client-Key
// header. Blocks direct API calls from anyone who doesn't have the client.
const CLIENT_KEY = process.env.CLIENT_KEY || '';

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
    static _keyCache = {};
    static _keySalt = crypto
        .createHash('sha256')
        .update('rc-keysalt-v2|' + HMAC_SECRET)
        .digest();

    // Derive ONE key per purpose, once, and cache it. (Previously every
    // encrypt/decrypt ran a 100k-iteration PBKDF2 with a per-message salt —
    // a GET /chat decrypting 100 messages meant 100 PBKDF2 runs on the event
    // loop, a self-inflicted DoS. Security now comes from a unique random IV
    // per message under AES-256-GCM, which is the correct design.)
    static deriveKey(purpose) {
        if (!CryptoUtils._keyCache[purpose]) {
            CryptoUtils._keyCache[purpose] = crypto.pbkdf2Sync(
                MASTER_KEY + ':' + purpose,
                CryptoUtils._keySalt,
                CRYPTO_CONFIG.PBKDF2_ITERATIONS,
                CRYPTO_CONFIG.KEY_LENGTH,
                'sha256'
            );
        }
        return CryptoUtils._keyCache[purpose];
    }

    static encrypt(plaintext, purpose = 'default') {
        const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
        const key = this.deriveKey(purpose);
        const cipher = crypto.createCipheriv(CRYPTO_CONFIG.ALGORITHM, key, iv);
        const ciphertext = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();
        return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
    }

    static decrypt(encrypted, purpose = 'default') {
        try {
            const buffer = Buffer.from(encrypted, 'base64');
            const iv = buffer.subarray(0, 12);
            const authTag = buffer.subarray(12, 28);
            const ciphertext = buffer.subarray(28);
            const key = this.deriveKey(purpose);
            const decipher = crypto.createDecipheriv(
                CRYPTO_CONFIG.ALGORITHM,
                key,
                iv
            );
            decipher.setAuthTag(authTag);
            return Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]).toString('utf8');
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

// Request ID + no-store (don't let proxies/browsers cache API responses)
app.use((req, res, next) => {
    req.id = crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-ID', req.id);
    res.setHeader('Cache-Control', 'no-store');
    next();
});

function getClientIP(req) {
    // Trust ONLY req.ip (resolved by Express via the configured `trust proxy`).
    // Never fall back to the raw X-Forwarded-For header — its leftmost value is
    // attacker-controlled and would let someone spoof their IP to dodge bans /
    // rate limits.
    const rawIP = req.ip || req.socket?.remoteAddress || 'unknown';
    return IPProtection.hashIP(rawIP);
}

// ============ API CLIENT KEY ============
// If CLIENT_KEY is configured, every request (except health) must present it.
// Stops direct API calls from anyone who doesn't ship the client.
app.use((req, res, next) => {
    if (!CLIENT_KEY || req.path === '/health') return next();
    const provided = req.headers['x-client-key'] || '';
    if (!CryptoUtils.safeCompare(provided, CLIENT_KEY)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
});

// ============ IP BAN ENFORCEMENT ============
// In-memory cache of banned IP hashes (loaded from DB at startup). Checked
// synchronously on every request so banned IPs are blocked everywhere.
const bannedIpCache = new Set();
const bannedUserCache = new Set(); // lowercased banned usernames (loaded at startup)
const lastSeenIp = new Map(); // username(lower) -> ip hash (best-effort, in-memory)

app.use((req, res, next) => {
    if (req.path === '/health') return next();
    if (bannedIpCache.has(getClientIP(req))) {
        return res.status(403).json({ error: 'Banned' });
    }
    next();
});

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

// Anti-flood: hard cap on messages per IP regardless of username (stops one IP
// spamming through many different usernames). Privileged users are exempt.
const chatFloodLimiter = rateLimit({
    windowMs: 60000,
    max: 20,
    keyGenerator: (req) => getClientIP(req),
    skip: (req) => !!(req.user && isAdmin(req.user.username)),
    handler: (req, res) => {
        res.status(429).json({ error: 'Too many messages', retryAfter: 60 });
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
// Single owner/admin. This account gets the chat bypass (no cooldown, no mute,
// no content filter). Logging in as the owner REQUIRES the correct ADMIN_SECRET,
// so it can't be impersonated.
// 👉 Change the Roblox username key below if the owner's nick is different.

const USER_ROLES = {
    hihpik0: { level: 5, prefix: '👑 OWNER', color: 'RAINBOW', badge: '👑' }, // единственный админ — bypass_chat
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

function createSession(username, ipHash) {
    // Bind the token to the IP it was issued from. A stolen/leaked token is
    // then useless from any other IP.
    const token = JWTManager.sign(
        { username, role: getUserRole(username)?.level || 0, ip: ipHash || null },
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

    // Token is bound to the IP it was issued from. If the IP changed (or the
    // token was stolen and replayed elsewhere) → force re-login. The client
    // already handles 401 by logging in again, so this is seamless.
    if (payload.ip && payload.ip !== getClientIP(req)) {
        return res.status(401).json({ error: 'Token IP mismatch' });
    }

    req.user = payload;
    // Remember which IP this user is on, so a ban can also block their IP.
    lastSeenIp.set(payload.username.toLowerCase(), getClientIP(req));
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.user || !isAdmin(req.user.username)) {
        return res.status(403).json({ error: 'No permission' });
    }
    next();
};

// Enforce bans on every request — works even with an otherwise-valid token.
// Uses the in-memory ban cache (synced with the DB), so it's a synchronous
// O(1) check with no per-request database query.
const requireNotBanned = (req, res, next) => {
    if (req.user && bannedUserCache.has(req.user.username.toLowerCase())) {
        return res.status(403).json({ error: 'Banned' });
    }
    next();
};

// ============ ENDPOINTS ============

app.get('/health', async (req, res) => {
    res.json({ status: 'ok', version: '4.0', storage: db.kind });
});

// Login by username. Privileged accounts (owner/admin) MUST present the correct
// ADMIN_SECRET, otherwise the nickname can be impersonated to gain the bypass.
app.post('/auth/login', createLimiter(60000, 5), async (req, res) => {
    try {
        const { player, adminSecret } = req.body;

        const validation = validateUsername(player);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid username' });
        }
        const username = validation.username;

        if (bannedUserCache.has(username.toLowerCase())) {
            return res.status(403).json({ error: 'Banned' });
        }

        const role = getUserRole(username);

        // Anti-impersonation: privileged nicknames require the admin secret.
        if (role && role.level >= ADMIN_LEVEL) {
            if (!verifyAdminSecret(adminSecret)) {
                return res.status(403).json({ error: 'Admin verification failed' });
            }
        }

        const token = createSession(username, getClientIP(req));

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
app.get('/chat', requireAuth, requireNotBanned, async (req, res) => {
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
app.post('/chat', requireAuth, requireNotBanned, chatFloodLimiter, messageLimiter, async (req, res) => {
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
app.post('/whisper', requireAuth, requireNotBanned, chatFloodLimiter, messageLimiter, async (req, res) => {
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
app.get('/whispers', requireAuth, requireNotBanned, async (req, res) => {
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
        bannedUserCache.add(validation.username.toLowerCase());
        sessions.delete(validation.username);

        // Also ban the IP we last saw this user on, so they can't dodge the
        // ban by simply changing their claimed nickname.
        const ipHash = lastSeenIp.get(validation.username.toLowerCase());
        if (ipHash) {
            await db.addIpBan(ipHash, validation.username);
            bannedIpCache.add(ipHash);
        }

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
        bannedUserCache.delete(validation.username.toLowerCase());
        // Lift any IP bans tied to this user.
        const freed = await db.removeIpBansForUser(validation.username);
        for (const h of freed) bannedIpCache.delete(h);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/admin/bans', requireAuth, requireAdmin, async (req, res) => {
    try {
        // Prefer the header (query strings can leak into proxy/access logs).
        const secret = req.headers['x-admin-secret'] || req.query.secret;
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
        const secret = req.headers['x-admin-secret'] || req.query.secret;
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
        // Warm the ban caches from the database (sync, O(1) checks afterwards).
        try {
            for (const h of await db.listIpBans()) bannedIpCache.add(h);
            for (const b of await db.listBans()) bannedUserCache.add(b.username);
        } catch (_) {}
    } catch (e) {
        console.error('❌ Failed to initialize database:', e.message);
        process.exit(1);
    }

    const server = app.listen(PORT, () => {
        console.log(`🔐 Secure Chat Server v4.0 running on port ${PORT}`);
    });

    // Anti-slowloris / slow-DoS: cap how long a request may take to arrive.
    server.requestTimeout = 20000; // whole request must arrive within 20s
    server.headersTimeout = 15000; // headers within 15s
    server.keepAliveTimeout = 30000;
    server.maxHeadersCount = 50;

    // Periodic cleanup of expired rows + bounding of in-memory maps
    // (prevents slow memory-exhaustion from many distinct usernames over time).
    setInterval(() => {
        db.cleanupExpired().catch(() => {});
        const now = Date.now();
        for (const [user, s] of sessions) {
            if (now - s.lastActivity > 3600000) sessions.delete(user); // 1h idle
        }
        // Hard cap the last-seen-IP map; drop oldest entries beyond the cap.
        const CAP = 5000;
        if (lastSeenIp.size > CAP) {
            let toDrop = lastSeenIp.size - CAP;
            for (const k of lastSeenIp.keys()) {
                if (toDrop-- <= 0) break;
                lastSeenIp.delete(k);
            }
        }
    }, 60000);
}

start();

// Don't leak error details; keep the process alive.
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
