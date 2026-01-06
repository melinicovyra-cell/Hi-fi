const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- КОНФИГУРАЦИЯ ---
const ADMIN_PASSWORD = "123"; // ТВОЙ ПАРОЛЬ
let globalMessages = [];
let mutedUsers = {};
let bannedUsers = {};
let warns = {}; // Система варнов
let slowMode = 0; // Задержка чата (0 = выкл)
let lastMessageTime = {}; // Для слоумода

const limiter = rateLimit({ windowMs: 60000, max: 1000 }); // Увеличили лимит
app.use(limiter);

// 1. ПОЛУЧИТЬ ЧАТ
app.get('/chat', (req, res) => {
    res.json(globalMessages);
});

// 2. ОТПРАВИТЬ СООБЩЕНИЕ
app.post('/chat', (req, res) => {
    const { player, message } = req.body;
    if (!player || !message) return res.status(400).json({ error: "No data" });

    // ПРОВЕРКИ
    if (bannedUsers[player]) return res.status(403).json({ error: "BANNED" });

    if (mutedUsers[player]) {
        if (Date.now() < mutedUsers[player]) {
            const t = Math.ceil((mutedUsers[player] - Date.now()) / 1000);
            return res.status(403).json({ error: "MUTED", timeLeft: t });
        } else delete mutedUsers[player];
    }

    // SLOWMODE
    if (slowMode > 0) {
        const last = lastMessageTime[player] || 0;
        if (Date.now() - last < slowMode * 1000) {
            return res.status(429).json({ error: "SLOWMODE", wait: slowMode });
        }
        lastMessageTime[player] = Date.now();
    }

    let finalMessage = message.substring(0, 250);
    
    // ПРОВЕРКА НА КОМАНДЫ KICK (Клиент сам обработает сообщение типа "cmd")
    
    globalMessages.push({
        type: "msg",
        player: player,
        msg: finalMessage,
        timestamp: Date.now()
    });

    if (globalMessages.length > 80) globalMessages = globalMessages.slice(-80);
    res.json({ status: "success" });
});

// 3. АДМИН ПАНЕЛЬ (МОЗГ)
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Wrong Password" });

    // --- ЛОГИКА ---

    if (action === "announce") {
        globalMessages.push({ type: "announce", player: "SYSTEM", msg: text || "Внимание!", timestamp: Date.now() });
        return res.json({ status: "Announced" });
    }

    if (action === "mute") {
        mutedUsers[target] = Date.now() + (duration * 1000);
        globalMessages.push({ type: "sys", msg: `🔇 ${target} замьючен на ${duration}с.` });
        return res.json({ status: "Muted" });
    }

    if (action === "ban") {
        bannedUsers[target] = true;
        globalMessages.push({ type: "sys", msg: `🚫 ${target} ЗАБАНЕН.` });
        return res.json({ status: "Banned" });
    }

    if (action === "kick") {
        // Отправляем спец. сообщение, которое скрипт клиента поймет как команду "вылет"
        globalMessages.push({ type: "cmd", cmd: "kick", target: target });
        globalMessages.push({ type: "sys", msg: `🦵 ${target} был кикнут из чата.` });
        return res.json({ status: "Kicked" });
    }

    if (action === "warn") {
        warns[target] = (warns[target] || 0) + 1;
        globalMessages.push({ type: "cmd", cmd: "warn", target: target, reason: text }); // Клиент покажет скример/алерт
        globalMessages.push({ type: "sys", msg: `⚠️ ${target} получил ПРЕДУПРЕЖДЕНИЕ (${warns[target]}/3). Причина: ${text}` });
        return res.json({ status: "Warned" });
    }

    if (action === "slowmode") {
        slowMode = duration; // duration тут используем как секунды задержки
        globalMessages.push({ type: "sys", msg: `🐢 Включен медленный режим: ${slowMode} сек.` });
        return res.json({ status: "Slowmode set" });
    }

    if (action === "unban") {
        delete bannedUsers[target]; delete mutedUsers[target];
        globalMessages.push({ type: "sys", msg: `✅ ${target} разбанен.` });
        return res.json({ status: "Unbanned" });
    }

    if (action === "clear") {
        globalMessages = [];
        globalMessages.push({ type: "sys", msg: "🧹 Чат очищен." });
        return res.json({ status: "Cleared" });
    }

    res.json({ error: "Unknown action" });
});

app.listen(PORT, () => console.log(`Server on ${PORT}`));
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
            
