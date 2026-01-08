const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const app = express();

const PORT = process.env.PORT || 3000;

// --- 1. БЕЗОПАСНОСТЬ И НАСТРОЙКИ ---

// ВАШ СЕКРЕТНЫЙ КЛЮЧ
const GAME_API_KEY = process.env.GAME_API_KEY || "hihpik0oikopy"; 

const SERVER_PASSWORD = process.env.SERVER_PASSWORD || "hihpikpass"; 
const CREATOR_NAME = "hihpik0";

// Базовая защита
app.set('trust proxy', 1); 
app.use(helmet()); 
app.use(hpp()); 

// CORS
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-game-key'] 
}));

app.use(express.json({ limit: '5kb' })); 

// Защита от битого JSON
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: "Malicious Payload" });
    }
    next();
});

// --- 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function getClientIP(req) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (ip && ip.includes(',')) return ip.split(',')[0].trim();
    return ip;
}

// --- 3. MIDDLEWARE ПРОВЕРКИ ИСТОЧНИКА (ГЛАВНАЯ ЗАЩИТА) ---
const verifySource = (req, res, next) => {
    const clientKey = req.headers['x-game-key'];
    
    // Для отправки сообщений (POST) ключ обязателен
    if (req.method === 'POST') {
        // Проверка ключа
        if (!clientKey || clientKey !== GAME_API_KEY) {
            console.warn(`[SECURITY] Blocked Request (Wrong Key). IP: ${getClientIP(req)}`);
            return res.status(401).json({ error: "Unauthorized: Invalid Game Key" });
        }

        // Проверка User-Agent (защита от скриптов)
        const userAgent = req.get('User-Agent') || "";
        if (userAgent.includes("Postman") || userAgent.includes("insomnia") || userAgent.includes("python")) {
             return res.status(403).json({ error: "Forbidden Client" });
        }
    }
    next();
};

app.use(verifySource);

// --- 4. ДАННЫЕ СЕРВЕРА ---
const MAX_HISTORY = 70;
const adminSecrets = {
    "hihpik0": process.env.ADMIN_KEY_1 || "spirithih0", 
    "BAAAAHHRR": process.env.ADMIN_KEY_2 || "AdminKey456"
};

const FORBIDDEN_WORDS = [
    "system", "server", "announcement", "admin", "moderator", "root",
    "nigga", "nigger", "hitler", "faggot", "sex", "porn", "xxx", "child", "rape"
];

let globalMessages = [];
let mutedUsers = new Map();
let bannedUsers = new Set();
let bannedIPs = new Set();
let userInfoMap = new Map(); 
let lastMessageTime = new Map();

// --- 5. RATE LIMITERS ---
const readLimiter = rateLimit({
    windowMs: 60 * 1000, max: 100, 
    message: { error: "Rate limit exceeded" }
});

const writeLimiter = rateLimit({
    windowMs: 10 * 1000, max: 8, // Чуть мягче, но все равно строго
    message: { error: "Spam detected. Slow down." }
});

function isAdmin(username) { return Object.keys(adminSecrets).includes(username); }

function sanitize(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;').trim();
}

function updateUserInfo(player, ip, userAgent) {
    userInfoMap.set(player, {
        ip: ip, userAgent: userAgent || "Unknown", lastSeen: Date.now(),
        isBanned: bannedUsers.has(player), isMuted: mutedUsers.has(player)
    });
}

// --- 6. МАРШРУТЫ ---

app.get('/', (req, res) => res.send("🛡️ Secure Chat v2.1 (Key Protected)"));

// ЧТЕНИЕ ЧАТА
app.get('/chat', readLimiter, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const safeMessages = globalMessages.map(msg => ({
        player: msg.player, msg: msg.msg, timestamp: msg.timestamp,
        type: msg.type, isAdmin: msg.isAdmin
    }));
    res.json(safeMessages);
});

// ПРОВЕРКА РОЛИ
app.get('/check-role', readLimiter, (req, res) => {
    res.set('Cache-Control', 'no-store'); 
    const player = req.query.player;
    if (player && isAdmin(player)) res.json({ role: "ADMIN" });
    else res.json({ role: "USER" });
});

// ОТПРАВКА СООБЩЕНИЯ
app.post('/chat', writeLimiter, (req, res) => {
    const { player, message, secureKey } = req.body;
    const clientIP = getClientIP(req);
    const userAgent = req.get('User-Agent');

    // Логирование (видит только владелец)
    console.log(`[MSG] ${player} (${clientIP}): ${message.substring(0, 30)}`);

    if (bannedIPs.has(clientIP)) return res.status(403).json({ error: "IP BANNED" });
    if (bannedUsers.has(player)) return res.status(403).json({ error: "BANNED" });
    if (!player || !message) return res.status(400).json({ error: "No data" });

    updateUserInfo(player, clientIP, userAgent);

    if (mutedUsers.has(player)) {
        if (Date.now() < mutedUsers.get(player)) return res.status(403).json({ error: "MUTED" });
        else mutedUsers.delete(player);
    }

    if (!isAdmin(player)) {
        const now = Date.now();
        if (lastMessageTime.has(player) && (now - lastMessageTime.get(player) < 1500)) {
            return res.status(429).json({ error: "Too fast" });
        }
        lastMessageTime.set(player, now);

        const lower = player.toLowerCase();
        const lowerMsg = message.toLowerCase();
        if (FORBIDDEN_WORDS.some(w => lower.includes(w))) return res.status(403).json({ error: "Bad Name" });
        if (FORBIDDEN_WORDS.some(w => lowerMsg.includes(w))) return res.status(403).json({ error: "Profanity" });
        if (player.length > 20 || message.length > 300) return res.status(400).json({ error: "Limit Exceeded" });
    } else {
        if (secureKey !== adminSecrets[player]) {
            return res.status(403).json({ error: "Fake Admin" });
        }
    }

    const safeMsg = sanitize(message);
    if (!safeMsg) return res.status(400).json({ error: "Empty" });

    globalMessages.push({
        player: sanitize(player), msg: safeMsg, timestamp: Date.now(),
        type: "msg", isAdmin: isAdmin(player), ip: clientIP
    });

    if (globalMessages.length > MAX_HISTORY) globalMessages.shift();
    res.json({ success: true });
});

// АДМИН ПАНЕЛЬ
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;
    const adminIP = getClientIP(req);

    if (password !== SERVER_PASSWORD) return res.status(403).json({ error: "Wrong Password" });

    if (target === CREATOR_NAME && ['ban', 'kick', 'mute'].includes(action)) {
        return res.json({ success: false, error: "GOD MODE: Cannot touch Creator." });
    }

    switch (action) {
        case 'info':
            if (target && userInfoMap.has(target)) {
                const info = userInfoMap.get(target);
                return res.json({ 
                    success: true, 
                    data: {
                        username: target, ip: info.ip, userAgent: info.userAgent,
                        lastSeen: new Date(info.lastSeen).toLocaleString(),
                        status: info.isBanned ? "BANNED" : (info.isMuted ? "MUTED" : "ACTIVE")
                    } 
                });
            } else return res.json({ success: false, error: "User not found" });

        case 'ban':
            if (target) {
                bannedUsers.add(target);
                if (userInfoMap.has(target)) bannedIPs.add(userInfoMap.get(target).ip);
                globalMessages.push({ player: "SYSTEM", msg: `🚫 User ${sanitize(target)} BANNED.`, timestamp: Date.now(), type: "sys" });
            }
            break;

        case 'announce':
            if(text) globalMessages.push({ player: "ANNOUNCEMENT", msg: sanitize(text), timestamp: Date.now(), type: "announce" });
            break;
            
        case 'mute':
            if (target) {
                mutedUsers.set(target, Date.now() + (duration * 1000));
                globalMessages.push({ player: "SYSTEM", msg: `🔇 User ${sanitize(target)} muted.`, timestamp: Date.now(), type: "sys" });
            }
            break;
            
        case 'kick':
            if (target) globalMessages.push({ player: "SYSTEM", msg: `🦵 User ${sanitize(target)} KICKED.`, timestamp: Date.now(), type: "sys" });
            break;
            
        case 'unban':
            if (target) {
                bannedUsers.delete(target);
                globalMessages.push({ player: "SYSTEM", msg: `✅ User ${sanitize(target)} unbanned.`, timestamp: Date.now(), type: "sys" });
            }
            break;

        case 'clear':
            globalMessages = [];
            globalMessages.push({ player: "SYSTEM", msg: "🧹 Chat cleared.", timestamp: Date.now(), type: "sys" });
            break;

        default: return res.status(400).json({ error: "Unknown Action" });
    }
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Active on port ${PORT}`));
