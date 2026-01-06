const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- ВАЖНО: ПАРОЛЬ ТУТ ДОЛЖЕН СОВПАДАТЬ С ТЕМ, ЧТО В СКРИПТЕ ---
const ADMIN_PASSWORD = "hihpikpass"; 
// -------------------------------------------------------------

let globalMessages = [];
let mutedUsers = {};
let bannedUsers = {};
let warns = {};
let slowMode = 0;
let lastMessageTime = {};

// Увеличиваем лимит, чтобы админка не лагала
const limiter = rateLimit({ windowMs: 60000, max: 2000 });
app.use(limiter);

app.get('/chat', (req, res) => {
    res.json(globalMessages);
});

app.post('/chat', (req, res) => {
    const { player, message } = req.body;
    if (!player || !message) return res.status(400).json({ error: "No data" });

    if (bannedUsers[player]) return res.status(403).json({ error: "BANNED" });

    if (mutedUsers[player]) {
        if (Date.now() < mutedUsers[player]) {
            const t = Math.ceil((mutedUsers[player] - Date.now()) / 1000);
            return res.status(403).json({ error: "MUTED", timeLeft: t });
        } else delete mutedUsers[player];
    }

    if (slowMode > 0) {
        const last = lastMessageTime[player] || 0;
        if (Date.now() - last < slowMode * 1000) {
            return res.status(429).json({ error: "SLOWMODE", wait: slowMode });
        }
        lastMessageTime[player] = Date.now();
    }

    let finalMessage = message.substring(0, 250);
    
    globalMessages.push({
        type: "msg",
        player: player,
        msg: finalMessage,
        timestamp: Date.now()
    });

    if (globalMessages.length > 80) globalMessages = globalMessages.slice(-80);
    res.json({ status: "success" });
});

app.post('/admin', (req, res) => {
    const { password, action, target, duration, text } = req.body;

    // ПРОВЕРКА ПАРОЛЯ
    if (password !== ADMIN_PASSWORD) {
        console.log("Неверный пароль:", password); // Для логов
        return res.status(401).json({ error: "Wrong Password" });
    }

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
        globalMessages.push({ type: "cmd", cmd: "kick", target: target });
        globalMessages.push({ type: "sys", msg: `🦵 ${target} был кикнут.` });
        return res.json({ status: "Kicked" });
    }
    if (action === "warn") {
        globalMessages.push({ type: "cmd", cmd: "warn", target: target, reason: text });
        globalMessages.push({ type: "sys", msg: `⚠️ ${target} получил ПРЕДУПРЕЖДЕНИЕ.` });
        return res.json({ status: "Warned" });
    }
    if (action === "slowmode") {
        slowMode = duration;
        globalMessages.push({ type: "sys", msg: `🐢 Слоумод: ${slowMode} сек.` });
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
