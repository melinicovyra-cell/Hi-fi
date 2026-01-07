const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10kb' }));

// --- КОНФИГУРАЦИЯ ---
const SERVER_PASSWORD = "hihpikpass"; 
const MAX_HISTORY = 50;

// --- ХРАНИЛИЩЕ ---
let globalMessages = [];
let mutedUsers = new Map();
let bannedUsers = new Set();
let adminUsers = new Set(["hihpik0", "BAAAAHHRR"]); 

// --- ЗАЩИТА ---
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 600,
    message: { error: "Too many requests" }
});
app.use(limiter);

// --- ГЛАВНАЯ ---
app.get('/', (req, res) => res.send("Global Chat Server is Running! v16.0 (FULL ADMIN)"));

// --- ЧАТ ---
app.get('/chat', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(globalMessages);
});

// --- ПРОВЕРКА РОЛИ ---
app.get('/check-role', (req, res) => {
    // Добавляем этот заголовок, чтобы браузеры/роблокс не кэшировали ответ
    res.set('Cache-Control', 'no-store'); 
    const player = req.query.player;
    if (adminUsers.has(player)) {
        res.json({ role: "ADMIN" });
    } else {
        res.json({ role: "USER" });
    }
});

// --- ОТПРАВКА ---
app.post('/chat', (req, res) => {
    const { player, message } = req.body;
    if (!player || !message) return res.status(400).json({ error: "Missing data" });

    const msgStr = String(message).trim();
    if (msgStr.length === 0) return res.status(400).json({ error: "Empty" });

    if (bannedUsers.has(player)) return res.status(403).json({ error: "BANNED" });

    if (mutedUsers.has(player)) {
        if (Date.now() < mutedUsers.get(player)) {
            return res.status(403).json({ error: "MUTED" });
        } else {
            mutedUsers.delete(player);
        }
    }

    globalMessages.push({
        player,
        msg: msgStr.substring(0, 300),
        timestamp: Date.now(),
        type: "msg"
    });

    if (globalMessages.length > MAX_HISTORY) globalMessages.shift();
    res.json({ success: true });
});

// --- АДМИН КОМАНДЫ (ВОТ ОНИ ВСЕ) ---
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    if (password !== SERVER_PASSWORD) return res.status(403).json({ error: "Wrong Password" });

    switch (action) {
        case 'promote':
            if (target) {
                adminUsers.add(target);
                globalMessages.push({ player: "SYSTEM", msg: `👑 User ${target} is now an ADMIN!`, timestamp: Date.now(), type: "sys" });
            }
            break;
        case 'demote':
            if (target) {
                adminUsers.delete(target);
                globalMessages.push({ player: "SYSTEM", msg: `User ${target} lost admin privileges.`, timestamp: Date.now(), type: "sys" });
            }
            break;
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
                // Серверное сообщение о кике
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
    }
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Active on port ${PORT}`));
