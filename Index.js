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
// Изначальные админы (можно добавить себя сразу)
let adminUsers = new Set(["hihpik0", "BAAAAHHRR"]); 

// --- ЗАЩИТА ---
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 600,
    message: { error: "Too many requests" }
});
app.use(limiter);

// --- ГЛАВНАЯ ---
app.get('/', (req, res) => res.send("Chat Server Active v14.2"));

// --- ПОЛУЧЕНИЕ СООБЩЕНИЙ ---
app.get('/chat', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(globalMessages);
});

// --- ПРОВЕРКА РОЛИ (Нужно для Lua скрипта) ---
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
    if (!player || !message) return res.status(400).json({ error: "Missing data" });
    if (String(message).trim().length === 0) return res.status(400).json({ error: "Empty" });
    if (bannedUsers.has(player)) return res.status(403).json({ error: "BANNED" });
    if (mutedUsers.has(player) && Date.now() < mutedUsers.get(player)) return res.status(403).json({ error: "MUTED" });

    const newMessage = {
        player,
        msg: String(message).substring(0, 300),
        timestamp: Date.now(),
        type: "msg" // обычное сообщение
    };

    globalMessages.push(newMessage);
    if (globalMessages.length > MAX_HISTORY) globalMessages.shift();

    res.json({ success: true });
});

// --- АДМИН ПАНЕЛЬ (ОБРАБОТКА КОМАНД) ---
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    // Проверка пароля сервера
    if (password !== SERVER_PASSWORD) {
        return res.status(403).json({ error: "Wrong Password" });
    }

    // Логика команд
    switch (action) {
        case 'promote': // ВЫДАЧА АДМИНКИ
            if (target) {
                adminUsers.add(target);
                globalMessages.push({
                    player: "SYSTEM",
                    msg: `User ${target} has been promoted to ADMIN!`,
                    timestamp: Date.now(),
                    type: "sys"
                });
            }
            break;

        case 'demote': // СНЯТИЕ АДМИНКИ
            if (target) {
                adminUsers.delete(target);
                 globalMessages.push({
                    player: "SYSTEM",
                    msg: `User ${target} is no longer an admin.`,
                    timestamp: Date.now(),
                    type: "sys"
                });
            }
            break;

        case 'mute':
            if (target) mutedUsers.set(target, Date.now() + (duration * 1000));
            break;
        
        case 'ban':
            if (target) bannedUsers.add(target);
            break;

        case 'kick':
            // Кик реализуется на клиенте, сервер просто может отправить команду,
            // но в простой реализации мы просто проигнорируем или добавим во временный бан
            break;

        case 'announce':
            globalMessages.push({
                player: "ANNOUNCEMENT",
                msg: text,
                timestamp: Date.now(),
                type: "announce"
            });
            break;
            
        case 'clear':
            globalMessages = [];
            globalMessages.push({
                player: "SYSTEM",
                msg: "Chat has been cleared by an admin.",
                timestamp: Date.now(),
                type: "sys"
            });
            break;
    }

    res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
