const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();

// Render автоматически выдает порт через process.env.PORT
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
// Изначальные админы
let adminUsers = new Set(["hihpik0", "BAAAAHHRR"]); 

// --- ЗАЩИТА ---
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 600,
    message: { error: "Too many requests" }
});
app.use(limiter);

// --- ГЛАВНАЯ СТРАНИЦА (Индикатор жизни) ---
app.get('/', (req, res) => {
    res.send("Global Chat Server is Running! v15.0");
});

// --- ПОЛУЧЕНИЕ СООБЩЕНИЙ ---
app.get('/chat', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(globalMessages);
});

// --- ПРОВЕРКА РОЛИ ---
app.get('/check-role', (req, res) => {
    const player = req.query.player;
    if (adminUsers.has(player)) {
        res.json({ role: "ADMIN" });
    } else {
        res.json({ role: "USER" });
    }
});

// --- ОТПРАВКА СООБЩЕНИЙ ---
app.post('/chat', (req, res) => {
    const { player, message } = req.body;

    if (!player || !message) {
        return res.status(400).json({ error: "Missing data" });
    }

    const msgStr = String(message).trim();
    if (msgStr.length === 0) return res.status(400).json({ error: "Empty message" });

    // Проверка банов и мутов
    if (bannedUsers.has(player)) {
        return res.status(403).json({ error: "BANNED" });
    }

    if (mutedUsers.has(player)) {
        const expiresAt = mutedUsers.get(player);
        if (Date.now() < expiresAt) {
            return res.status(403).json({ error: "MUTED" });
        } else {
            mutedUsers.delete(player); // Мут истек
        }
    }

    const newMessage = {
        player,
        msg: msgStr.substring(0, 300),
        timestamp: Date.now(),
        type: "msg"
    };

    globalMessages.push(newMessage);
    if (globalMessages.length > MAX_HISTORY) globalMessages.shift();

    res.json({ success: true });
});

// --- АДМИН ПАНЕЛЬ ---
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    if (password !== SERVER_PASSWORD) {
        return res.status(403).json({ error: "Wrong Password" });
    }

    switch (action) {
        case 'promote':
            if (target) {
                adminUsers.add(target);
                globalMessages.push({ player: "SYSTEM", msg: `User ${target} promoted to ADMIN!`, timestamp: Date.now(), type: "sys" });
            }
            break;
        case 'demote':
            if (target) {
                adminUsers.delete(target);
                globalMessages.push({ player: "SYSTEM", msg: `User ${target} demoted.`, timestamp: Date.now(), type: "sys" });
            }
            break;
        case 'mute':
            if (target) mutedUsers.set(target, Date.now() + (duration * 1000));
            break;
        case 'ban':
            if (target) bannedUsers.add(target);
            break;
        case 'announce':
            globalMessages.push({ player: "ANNOUNCEMENT", msg: text, timestamp: Date.now(), type: "announce" });
            break;
        case 'clear':
            globalMessages = [];
            globalMessages.push({ player: "SYSTEM", msg: "Chat cleared by admin.", timestamp: Date.now(), type: "sys" });
            break;
    }
    res.json({ success: true });
});

// Запуск с привязкой к 0.0.0.0 для Render
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
