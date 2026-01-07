const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 3000;

// Включаем доверие к прокси (важно для Render/Heroku/Glitch, чтобы видеть реальный IP)
app.set('trust proxy', true);

app.use(cors());
app.use(express.json({ limit: '10kb' }));

// --- КОНФИГУРАЦИЯ БЕЗОПАСНОСТИ ---
const SERVER_PASSWORD = "hihpikpass"; // Пароль для админ-команд
const MAX_HISTORY = 50;

// 1. ПАРОЛИ АДМИНОВ
const adminSecrets = {
    "hihpik0": "MySecretKey123", 
    "BAAAAHHRR": "AdminKey456"
};

// 2. ЗАПРЕЩЕННЫЕ НИКИ
const FORBIDDEN_NAMES = [
    "system", "server", "announcement", "admin", "moderator", "console",
    "nigga", "nigger", "hitler", "faggot", "sex", "porn"
];

// --- ХРАНИЛИЩЕ ---
let globalMessages = [];
let mutedUsers = new Map();
let bannedUsers = new Set(); // Баны по никам
let bannedIPs = new Set();   // Баны по IP

// Карта соответствия: Ник -> Последний IP (чтобы знать, какой IP банить по нику)
let userIPMap = new Map();

// --- ЗАЩИТА ---
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 600,
    message: { error: "Too many requests" }
});
app.use(limiter);

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function isAdmin(username) {
    return Object.keys(adminSecrets).includes(username);
}

// Получение реального IP пользователя
function getClientIP(req) {
    return req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

// --- ГЛАВНАЯ ---
app.get('/', (req, res) => res.send("Global Chat Server SECURED v18.0 (IP BAN ADDED)"));

// --- ПОЛУЧИТЬ ЧАТ ---
app.get('/chat', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(globalMessages);
});

// --- ПРОВЕРКА РОЛИ ---
app.get('/check-role', (req, res) => {
    res.set('Cache-Control', 'no-store'); 
    const player = req.query.player;
    if (isAdmin(player)) {
        res.json({ role: "ADMIN" });
    } else {
        res.json({ role: "USER" });
    }
});

// --- ОТПРАВКА СООБЩЕНИЯ ---
app.post('/chat', (req, res) => {
    const { player, message, secureKey } = req.body;
    const clientIP = getClientIP(req); // Получаем IP отправителя

    // 1. ПРОВЕРКА IP БАНА (Самая первая проверка)
    if (bannedIPs.has(clientIP)) {
        console.log(`[BLOCK] Request from BANNED IP: ${clientIP}`);
        return res.status(403).json({ error: "IP BANNED" });
    }

    if (!player || !message) return res.status(400).json({ error: "Missing data" });
    const msgStr = String(message).trim();
    if (msgStr.length === 0) return res.status(400).json({ error: "Empty" });

    // Сохраняем IP пользователя для возможности бана в будущем
    if (player) userIPMap.set(player, clientIP);

    // 2. ПРОВЕРКА БАНА ПО НИКУ
    if (bannedUsers.has(player)) return res.status(403).json({ error: "BANNED" });

    // 3. ПРОВЕРКА МУТА
    if (mutedUsers.has(player)) {
        if (Date.now() < mutedUsers.get(player)) {
            return res.status(403).json({ error: "MUTED" });
        } else {
            mutedUsers.delete(player);
        }
    }

    // 4. АВТОРИЗАЦИЯ И ФИЛЬТР НИКОВ
    if (isAdmin(player)) {
        if (secureKey !== adminSecrets[player]) {
            console.log(`[SECURITY] Fake admin attempt: ${player} from ${clientIP}`);
            return res.status(403).json({ error: "Identity Theft Detected" });
        }
    } else {
        const lowerName = player.toLowerCase();
        const isForbidden = FORBIDDEN_NAMES.some(badWord => lowerName.includes(badWord));
        
        if (isForbidden) {
            console.log(`[SECURITY] Forbidden name attempt: ${player} from ${clientIP}`);
            return res.status(403).json({ error: "Forbidden Username" });
        }
    }

    globalMessages.push({
        player,
        msg: msgStr.substring(0, 300),
        timestamp: Date.now(),
        type: "msg",
        isAdmin: isAdmin(player)
    });

    if (globalMessages.length > MAX_HISTORY) globalMessages.shift();
    res.json({ success: true });
});

// --- АДМИН КОМАНДЫ ---
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    if (password !== SERVER_PASSWORD) return res.status(403).json({ error: "Wrong Password" });

    switch (action) {
        case 'mute':
            if (target) {
                mutedUsers.set(target, Date.now() + (duration * 1000));
                globalMessages.push({ player: "SYSTEM", msg: `🔇 User ${target} muted for ${duration/60} minutes.`, timestamp: Date.now(), type: "sys" });
            }
            break;
        case 'ban':
            if (target) {
                // Баним Ник
                bannedUsers.add(target);
                
                // Баним IP, если знаем его
                if (userIPMap.has(target)) {
                    const targetIP = userIPMap.get(target);
                    bannedIPs.add(targetIP);
                    console.log(`[ADMIN] IP Banned for user ${target}: ${targetIP}`);
                }

                globalMessages.push({ player: "SYSTEM", msg: `🚫 User ${target} has been BANNED (IP & Name).`, timestamp: Date.now(), type: "sys" });
            }
            break;
        case 'unban': // Новая команда для разбана (если случайно забанил)
            if (target) {
                bannedUsers.delete(target);
                 // При разбане ника IP остаётся в бане для безопасности. 
                 // Чтобы разбанить IP, нужно перезагрузить сервер (так проще).
                 globalMessages.push({ player: "SYSTEM", msg: `✅ User ${target} unbanned (Name only).`, timestamp: Date.now(), type: "sys" });
            }
            break;
        case 'kick':
            if (target) {
                globalMessages.push({ player: "SYSTEM", msg: `🦵 User ${target} has been KICKED.`, timestamp: Date.now(), type: "sys" });
            }
            break;
        case 'announce':
            globalMessages.push({ player: "ANNOUNCEMENT", msg: text, timestamp: Date.now(), type: "announce" });
            break;
        case 'clear':
            globalMessages = [];
            globalMessages.push({ player: "SYSTEM", msg: "🧹 Chat cleared by admin.", timestamp: Date.now(), type: "sys" });
            break;
        default:
            return res.status(400).json({ error: "Unknown Action" });
    }
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Active on port ${PORT}`));
