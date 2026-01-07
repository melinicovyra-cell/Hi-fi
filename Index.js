const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10kb' }));

// --- КОНФИГУРАЦИЯ ---
const SERVER_PASSWORD = "hihpikpass"; // Пароль для админ-панели
const MAX_HISTORY = 50;

// --- ХРАНИЛИЩЕ ---
let globalMessages = [];
let mutedUsers = new Map();
let bannedUsers = new Set();

// Словарь админов: ИМЯ -> ПЕРСОНАЛЬНЫЙ ПАРОЛЬ (или ключ)
// Это предотвратит подмену админа обычным игроком
const adminSecrets = {
    "hihpik0": "superSecretPass1", 
    "BAAAAHHRR": "superSecretPass2"
};

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

// --- ГЛАВНАЯ ---
app.get('/', (req, res) => res.send("Global Chat Server is Running! v16.1 (SECURED)"));

// --- ЧАТ ---
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

// --- ОТПРАВКА (ИСПРАВЛЕНО) ---
app.post('/chat', (req, res) => {
    // secureKey - это то, что клиент должен прислать, если хочет писать от имени админа
    const { player, message, secureKey } = req.body; 

    if (!player || !message) return res.status(400).json({ error: "Missing data" });

    const msgStr = String(message).trim();
    if (msgStr.length === 0) return res.status(400).json({ error: "Empty" });

    // 1. ЗАЩИТА ОТ ПОДМЕНЫ АДМИНА
    if (isAdmin(player)) {
        // Если кто-то пытается писать под ником админа, но не знает пароль
        if (secureKey !== adminSecrets[player]) {
            return res.status(403).json({ error: "Unauthorized: Fake Admin Detected" });
        }
    }

    // 2. ПРОВЕРКА БАНА
    if (bannedUsers.has(player)) return res.status(403).json({ error: "BANNED" });

    // 3. ПРОВЕРКА МУТА
    if (mutedUsers.has(player)) {
        if (Date.now() < mutedUsers.get(player)) {
            return res.status(403).json({ error: "MUTED" });
        } else {
            mutedUsers.delete(player);
        }
    }

    // Сохраняем сообщение
    globalMessages.push({
        player,
        msg: msgStr.substring(0, 300),
        timestamp: Date.now(),
        type: "msg",
        // Добавляем метку, чтобы на клиенте можно было красиво подсветить настоящего админа
        isAdmin: isAdmin(player) 
    });

    if (globalMessages.length > MAX_HISTORY) globalMessages.shift();
    res.json({ success: true });
});

// --- АДМИН КОМАНДЫ ---
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    // Глобальный пароль сервера для выполнения команд
    if (password !== SERVER_PASSWORD) return res.status(403).json({ error: "Wrong Password" });

    switch (action) {
        case 'promote':
            // Внимание: динамическое добавление админов в простой схеме сложно без базы данных,
            // так как нужно генерировать и передавать им пароль. 
            // Для простоты пока оставим добавление в runtime, но без пароля он не сможет писать как админ.
            // Лучше добавлять админов вручную в код (в объект adminSecrets).
            res.json({ error: "Please add admins via source code configuration for security." });
            return; 
        
        case 'mute':
            if (target) {
                mutedUsers.set(target, Date.now() + (duration * 1000));
                globalMessages.push({ player: "SYSTEM", msg: `🔇 User ${target} muted for ${duration/60} minutes.`, timestamp: Date.now(), type: "sys" });
            }
            break;
        case 'ban':
            if (target) {
                bannedUsers.add(target);
                globalMessages.push({ player: "SYSTEM", msg: `🚫 User ${target} has been BANNED.`, timestamp: Date.now(), type: "sys" });
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
            return res.status(400).json({ error: "Unknown action" });
    }
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Active on port ${PORT}`));
