const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 3000;

// --- 1. БЕЗОПАСНОСТЬ И НАСТРОЙКИ ---
app.disable('x-powered-by'); 
app.set('trust proxy', 1); // Обязательно для получения реального IP на Render

app.use(cors());
app.use(express.json({ limit: '10kb' }));

// Защита от кривого JSON
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: "Bad JSON" });
    }
    next();
});

// --- 2. КОНФИГУРАЦИЯ ---
const SERVER_PASSWORD = process.env.SERVER_PASSWORD || "hihpikpass"; 
const MAX_HISTORY = 70;
const CREATOR_NAME = "hihpik0"; // Имя Создателя (Неуязвимый)

const adminSecrets = {
    "hihpik0": process.env.ADMIN_KEY_1 || "MySecretKey123", 
    "BAAAAHHRR": process.env.ADMIN_KEY_2 || "AdminKey456"
};

const FORBIDDEN_WORDS = [
    "system", "server", "announcement", "admin", "moderator", "root",
    "nigga", "nigger", "hitler", "faggot", "sex", "porn", "xxx", "child", "rape"
];

// --- 3. ХРАНИЛИЩЕ ДАННЫХ (RAM) ---
let globalMessages = [];
let mutedUsers = new Map();
let bannedUsers = new Set();
let bannedIPs = new Set();
let userInfoMap = new Map(); 

// Анти-спам
let lastMessageTime = new Map();

// --- 4. RATE LIMITERS ---
const readLimiter = rateLimit({
    windowMs: 60 * 1000, max: 200, 
    message: { error: "Too many reads" }
});

const writeLimiter = rateLimit({
    windowMs: 10 * 1000, max: 10, // Чуть поднял лимит
    message: { error: "Spam detected. Slow down." }
});

// --- 5. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function isAdmin(username) { return Object.keys(adminSecrets).includes(username); }

function getClientIP(req) {
    // Получаем реальный IP через заголовки прокси
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    // Если IP несколько (через запятую), берем первый
    if (ip && ip.includes(',')) return ip.split(',')[0].trim();
    return ip;
}

function sanitize(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').trim();
}

function updateUserInfo(player, ip, userAgent) {
    userInfoMap.set(player, {
        ip: ip,
        userAgent: userAgent || "Unknown",
        lastSeen: Date.now(),
        isBanned: bannedUsers.has(player),
        isMuted: mutedUsers.has(player)
    });
}

// --- 6. МАРШРУТЫ ---

app.get('/', (req, res) => res.send("🛡️ Secure Chat v21.0 (God Mode Active)"));

// ПУБЛИЧНЫЙ ЧАТ
app.get('/chat', readLimiter, (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Отправляем чат без IP для безопасности игроков
    const safeMessages = globalMessages.map(msg => ({
        player: msg.player,
        msg: msg.msg,
        timestamp: msg.timestamp,
        type: msg.type,
        isAdmin: msg.isAdmin
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

    // === ЛОГИРОВАНИЕ В КОНСОЛЬ RENDER ===
    // Это увидит только владелец в логах
    console.log(`[MSG] ${player} (IP: ${clientIP}): ${message.substring(0, 50)}`);

    // 1. БАНЫ
    if (bannedIPs.has(clientIP)) return res.status(403).json({ error: "IP BANNED" });
    if (bannedUsers.has(player)) return res.status(403).json({ error: "BANNED" });

    // 2. ВАЛИДАЦИЯ
    if (!player || !message) return res.status(400).json({ error: "No data" });

    // 3. СБОР ИНФЫ
    updateUserInfo(player, clientIP, userAgent);

    // 4. МУТ
    if (mutedUsers.has(player)) {
        if (Date.now() < mutedUsers.get(player)) return res.status(403).json({ error: "MUTED" });
        else mutedUsers.delete(player);
    }

    // 5. АНТИ-СПАМ (Кроме админов)
    if (!isAdmin(player)) {
        const now = Date.now();
        if (lastMessageTime.has(player) && (now - lastMessageTime.get(player) < 1000)) {
            return res.status(429).json({ error: "Too fast" });
        }
        lastMessageTime.set(player, now);
    }

    // 6. АВТОРИЗАЦИЯ
    if (isAdmin(player)) {
        if (secureKey !== adminSecrets[player]) {
            console.warn(`[SECURITY] Fake Admin Attempt: ${player} IP: ${clientIP}`);
            return res.status(403).json({ error: "Fake Admin" });
        }
    } else {
        const lower = player.toLowerCase();
        if (FORBIDDEN_WORDS.some(w => lower.includes(w))) return res.status(403).json({ error: "Bad Name" });
        if (player.length > 20 || message.length > 300) return res.status(400).json({ error: "Limit Exceeded" });
    }

    // 7. СОХРАНЕНИЕ
    const safeMsg = sanitize(message);
    if (!safeMsg) return res.status(400).json({ error: "Empty" });

    globalMessages.push({
        player: sanitize(player),
        msg: safeMsg,
        timestamp: Date.now(),
        type: "msg",
        isAdmin: isAdmin(player),
        ip: clientIP // Сохраняем IP внутри памяти
    });

    if (globalMessages.length > MAX_HISTORY) globalMessages.shift();
    res.json({ success: true });
});

// АДМИН ПАНЕЛЬ
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;
    const adminIP = getClientIP(req);

    if (password !== SERVER_PASSWORD) {
        console.warn(`[AUTH FAIL] IP: ${adminIP}`);
        return res.status(403).json({ error: "Wrong Password" });
    }

    // === GOD MODE PROTECTION ===
    // Если целью действия является Создатель, отменяем действие
    if (target === CREATOR_NAME) {
        // Разрешаем только 'info', остальные карательные меры запрещены
        if (action === 'ban' || action === 'kick' || action === 'mute') {
            console.log(`[GOD MODE] Attempt to ${action} CREATOR by IP: ${adminIP}. BLOCKED.`);
            // Отправляем в чат сообщение о том, что кто-то офигел, но действие не выполняем
            return res.json({ success: false, error: "YOU CANNOT BAN THE CREATOR!" });
        }
    }

    switch (action) {
        case 'info':
            if (target && userInfoMap.has(target)) {
                const info = userInfoMap.get(target);
                return res.json({ 
                    success: true, 
                    data: {
                        username: target,
                        ip: info.ip,
                        userAgent: info.userAgent,
                        lastSeen: new Date(info.lastSeen).toLocaleString(),
                        status: info.isBanned ? "BANNED" : (info.isMuted ? "MUTED" : "ACTIVE")
                    } 
                });
            } else {
                return res.json({ success: false, error: "User not found in cache" });
            }
            break;

        case 'ban':
            if (target) {
                bannedUsers.add(target);
                if (userInfoMap.has(target)) {
                    const ipToBan = userInfoMap.get(target).ip;
                    bannedIPs.add(ipToBan);
                    console.log(`[BAN] User: ${target} | IP: ${ipToBan} | By Admin IP: ${adminIP}`);
                }
                globalMessages.push({ 
                    player: "SYSTEM", 
                    msg: `🚫 User ${sanitize(target)} BANNED.`, 
                    timestamp: Date.now(), 
                    type: "sys"
                });
            }
            break;

        case 'announce':
            if(text) {
                console.log(`[ANNOUNCE] From Admin IP ${adminIP}: ${text}`);
                globalMessages.push({ 
                    player: "ANNOUNCEMENT", 
                    msg: sanitize(text), 
                    timestamp: Date.now(), 
                    type: "announce",
                });
            }
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
