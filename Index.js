const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- КОНФИГУРАЦИЯ ---
const ADMIN_PASSWORD = "123"; // ТВОЙ ПАРОЛЬ
let globalMessages = [];
let mutedUsers = {};  // Временные муты
let bannedUsers = {}; // Вечные баны

// Лимит запросов
const limiter = rateLimit({ windowMs: 60000, max: 500 });
app.use(limiter);

// 1. ПОЛУЧИТЬ ЧАТ
app.get('/chat', (req, res) => {
    res.json(globalMessages);
});

// 2. ОТПРАВИТЬ СООБЩЕНИЕ
app.post('/chat', (req, res) => {
    const { player, message } = req.body;
    if (!player || !message) return res.status(400).json({ error: "No data" });

    // ПРОВЕРКА БАНА
    if (bannedUsers[player]) {
        return res.status(403).json({ error: "BANNED" });
    }

    // ПРОВЕРКА МУТА
    if (mutedUsers[player]) {
        if (Date.now() < mutedUsers[player]) {
            const timeLeft = Math.ceil((mutedUsers[player] - Date.now()) / 1000);
            return res.status(403).json({ error: "MUTED", timeLeft: timeLeft });
        } else {
            delete mutedUsers[player];
        }
    }

    let finalMessage = message.substring(0, 200);
    
    globalMessages.push({
        type: "msg", // Обычное сообщение
        player: player,
        msg: finalMessage,
        timestamp: Date.now()
    });

    if (globalMessages.length > 60) globalMessages = globalMessages.slice(-60);
    res.json({ status: "success" });
});

// 3. АДМИН ПАНЕЛЬ
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Wrong Password" });

    // СИСТЕМНОЕ ОБЪЯВЛЕНИЕ
    if (action === "announce") {
        globalMessages.push({
            type: "announce",
            player: "[ANNOUNCEMENT]",
            msg: text || "Внимание!",
            timestamp: Date.now()
        });
        return res.json({ status: "Announced" });
    }

    // МУТ
    if (action === "mute") {
        const endTime = Date.now() + (duration * 1000);
        mutedUsers[target] = endTime;
        globalMessages.push({ type: "sys", msg: `🚫 Игрок ${target} получил мут на ${duration} сек.` });
        return res.json({ status: "Muted" });
    }

    // БАН
    if (action === "ban") {
        bannedUsers[target] = true;
        globalMessages.push({ type: "sys", msg: `☠️ Игрок ${target} был ЗАБАНЕН администратором.` });
        return res.json({ status: "Banned" });
    }

    // РАЗБАН / РАЗМУТ
    if (action === "unban") {
        delete bannedUsers[target];
        delete mutedUsers[target];
        globalMessages.push({ type: "sys", msg: `✅ Игрок ${target} был помилован.` });
        return res.json({ status: "Unbanned" });
    }

    // ОЧИСТКА
    if (action === "clear") {
        globalMessages = [];
        globalMessages.push({ type: "sys", msg: "🧹 Чат был очищен." });
        return res.json({ status: "Cleared" });
    }

    res.json({ error: "Unknown action" });
});

app.listen(PORT, () => console.log(`Server on ${PORT}`));
            
