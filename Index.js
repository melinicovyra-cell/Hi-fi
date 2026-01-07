const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors'); // Рекомендую добавить это
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Разрешаем запросы с любых источников
app.use(express.json({ limit: '10kb' }));

// --- КОНФИГУРАЦИЯ ---
const ADMIN_PASSWORD = "hihpikpass"; 
const MAX_HISTORY = 50; // Уменьшил до 50 для стабильности (можно вернуть 100)
const MESSAGE_LENGTH_LIMIT = 300; 

// --- ХРАНИЛИЩЕ ---
let globalMessages = [];
let mutedUsers = new Map(); 
let bannedUsers = new Set(); 
let lastMessageContent = new Map(); 

// --- ЗАЩИТА ---
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 600, // Поднял лимит для активного чата
    message: { error: "Too many requests" }
});
app.use(limiter);

// --- ГЛАВНАЯ СТРАНИЦА (Проверка жизни) ---
app.get('/', (req, res) => {
    res.send("Global Chat Server is Running! v11.0");
});

// --- ПОЛУЧЕНИЕ СООБЩЕНИЙ ---
app.get('/chat', (req, res) => {
    // Чтобы не кэшировалось браузером/прокси
    res.set('Cache-Control', 'no-store');
    res.json(globalMessages);
});

// --- ОТПРАВКА СООБЩЕНИЙ ---
app.post('/chat', (req, res) => {
    const { player, message } = req.body;

    // 1. Простая Валидация
    if (!player || !message) {
        return res.status(400).json({ error: "Missing data" });
    }

    const msgStr = String(message).trim();
    if (msgStr.length === 0) return res.status(400).json({ error: "Empty message" });

    // 2. Бан
    if (bannedUsers.has(player)) {
        return res.status(403).json({ error: "BANNED" });
    }

    // 3. Мут
    if (mutedUsers.has(player)) {
        const expiresAt = mutedUsers.get(player);
        if (Date.now() < expiresAt) {
            return res.status(403).json({ error: "MUTED" });
        } else {
            mutedUsers.delete(player);
        }
    }

    // 4. Анти-Спам (Только если сообщение точно такое же как прошлое)
    if (!msgStr.startsWith("||SYNC_")) {
        if (lastMessageContent.get(player) === msgStr) {
            // Возвращаем 200, но не добавляем сообщение (Silent Fail), чтобы не крашить скрипт
            console.log(`[SPAM BLOCKED] ${player}: ${msgStr}`);
            return res.json({ status: "ignored_spam" });
        }
        lastMessageContent.set(player, msgStr);
    }

    // 5. Добавление
    const finalMessage = msgStr.substring(0, MESSAGE_LENGTH_LIMIT);
    
    const msgObj = {
        type: "msg",
        player: player,
        msg: finalMessage,
        timestamp: Date.now()
    };

    globalMessages.push(msgObj);

    // 6. ИСПРАВЛЕННАЯ ОБРЕЗКА (Оставляем последние N сообщений)
    if (globalMessages.length > MAX_HISTORY) {
        // slice(-N) берет последние N элементов. Это надежнее.
        globalMessages = globalMessages.slice(-MAX_HISTORY);
    }

    console.log(`[CHAT] ${player}: ${finalMessage} (Total: ${globalMessages.length})`);
    res.json({ status: "success" });
});

// --- АДМИНКА ---
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Wrong Password" });

    const sysMsg = (txt) => ({ type: "sys", msg: txt, timestamp: Date.now() });

    try {
        switch (action) {
            case "announce":
                globalMessages.push({ type: "announce", player: "SYSTEM", msg: text, timestamp: Date.now() });
                break;
            case "mute":
                mutedUsers.set(target, Date.now() + ((duration || 60) * 1000));
                globalMessages.push(sysMsg(`🔇 ${target} muted.`));
                break;
            case "ban":
                bannedUsers.add(target);
                globalMessages.push(sysMsg(`🚫 ${target} BANNED.`));
                break;
            case "kick":
                globalMessages.push({ type: "cmd", cmd: "kick", target: target, timestamp: Date.now() });
                globalMessages.push(sysMsg(`🦵 ${target} kicked.`));
                break;
            case "clear":
                globalMessages = [];
                globalMessages.push(sysMsg("🧹 Chat cleared."));
                break;
        }
        res.json({ status: "Success" });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Internal Error" });
    }
});

// Очистка памяти каждые 5 минут
setInterval(() => {
    lastMessageContent.clear();
}, 5 * 60 * 1000);

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
