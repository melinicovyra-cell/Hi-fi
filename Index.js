const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10kb' })); // Лимит на размер запроса

// --- КОНФИГУРАЦИЯ ---
const ADMIN_PASSWORD = "hihpikpass"; 
const MAX_HISTORY = 100; // Храним последние 100 сообщений
const MESSAGE_LENGTH_LIMIT = 300; // Макс длина сообщения

// --- ХРАНИЛИЩЕ В ПАМЯТИ ---
let globalMessages = [];
let mutedUsers = new Map(); // Map быстрее работает с частыми проверками
let bannedUsers = new Set(); // Set идеален для проверки наличия (O(1))
let lastMessageContent = new Map(); // Для защиты от повтора сообщений

// --- ЗАЩИТА ОТ DDOS ---
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 500, // Максимум запросов с одного IP
    message: { error: "Too many requests" }
});
app.use(limiter);

// --- ЭНДПОИНТЫ ---

// Получение сообщений
app.get('/chat', (req, res) => {
    // Отдаем клиенту массив сообщений
    res.json(globalMessages);
});

// Отправка сообщений
app.post('/chat', (req, res) => {
    const { player, message } = req.body;

    // 1. Валидация
    if (!player || !message || typeof message !== 'string') {
        return res.status(400).json({ error: "Invalid data" });
    }

    // 2. Проверка Бана
    if (bannedUsers.has(player)) {
        return res.status(403).json({ error: "BANNED" });
    }

    // 3. Проверка Мута
    if (mutedUsers.has(player)) {
        const expiresAt = mutedUsers.get(player);
        if (Date.now() < expiresAt) {
            const timeLeft = Math.ceil((expiresAt - Date.now()) / 1000);
            return res.status(403).json({ error: "MUTED", timeLeft });
        } else {
            mutedUsers.delete(player); // Мут истек
        }
    }

    // 4. Анти-спам (одинаковые сообщения)
    // Разрешаем спам только админ-командам синхронизации
    if (!message.startsWith("||SYNC_")) {
        if (lastMessageContent.get(player) === message) {
            return res.status(429).json({ error: "No spam" });
        }
        lastMessageContent.set(player, message);
    }

    // 5. Формирование сообщения
    const finalMessage = message.substring(0, MESSAGE_LENGTH_LIMIT);
    
    const msgObj = {
        type: "msg",
        player: player,
        msg: finalMessage,
        timestamp: Date.now()
    };

    // 6. Сохранение
    globalMessages.push(msgObj);

    // Удаляем старые сообщения, чтобы не забить память
    if (globalMessages.length > MAX_HISTORY) {
        globalMessages = globalMessages.slice(globalMessages.length - MAX_HISTORY);
    }

    console.log(`[CHAT] ${player}: ${finalMessage}`); // Лог в консоль
    res.json({ status: "success" });
});

// Админ действия
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    // 1. Проверка пароля
    if (password !== ADMIN_PASSWORD) {
        console.warn(`[AUTH FAIL] Action: ${action} from IP: ${req.ip}`);
        return res.status(401).json({ error: "Wrong Password" });
    }

    // 2. Обработка действий
    const sysMsg = (txt) => ({ type: "sys", msg: txt, timestamp: Date.now() });

    switch (action) {
        case "announce":
            globalMessages.push({ 
                type: "announce", 
                player: "SYSTEM", 
                msg: text || "Attention!", 
                timestamp: Date.now() 
            });
            break;

        case "mute":
            const dur = duration || 60;
            mutedUsers.set(target, Date.now() + (dur * 1000));
            globalMessages.push(sysMsg(`🔇 ${target} muted for ${dur}s.`));
            break;

        case "ban":
            bannedUsers.add(target);
            globalMessages.push(sysMsg(`🚫 ${target} BANNED.`));
            break;

        case "unban":
            bannedUsers.delete(target);
            mutedUsers.delete(target);
            globalMessages.push(sysMsg(`✅ ${target} unbanned.`));
            break;

        case "kick":
            // Отправляем команду клиентам, они сами решат кого кикнуть
            globalMessages.push({ type: "cmd", cmd: "kick", target: target, timestamp: Date.now() });
            globalMessages.push(sysMsg(`🦵 ${target} kicked.`));
            break;

        case "clear":
            globalMessages = [];
            globalMessages.push(sysMsg("🧹 Chat cleared."));
            break;

        default:
            return res.status(400).json({ error: "Unknown action" });
    }

    console.log(`[ADMIN] Action: ${action}, Target: ${target}`);
    res.json({ status: "Success" });
});

// --- ОЧИСТКА ПАМЯТИ (Раз в 10 минут) ---
setInterval(() => {
    const now = Date.now();
    // Удаляем истекшие муты
    for (const [user, time] of mutedUsers) {
        if (now > time) mutedUsers.delete(user);
    }
    // Очищаем кэш последних сообщений
    lastMessageContent.clear();
}, 10 * 60 * 1000);

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
