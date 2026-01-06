const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- НАСТРОЙКИ ---
const ADMIN_PASSWORD = "123"; // ПАРОЛЬ ОТ АДМИНКИ (ПОМЕНЯЙ ЕГО!)
let globalMessages = [];
let mutedUsers = {}; // Список мутов: { "Ник": timestamp_окончания }

const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 200, // Увеличили лимит для админки
    message: { error: "Too many requests" }
});
app.use(limiter);

// --- 1. ПОЛУЧЕНИЕ СООБЩЕНИЙ ---
app.get('/chat', (req, res) => {
    res.json(globalMessages);
});

// --- 2. ОТПРАВКА СООБЩЕНИЯ ---
app.post('/chat', (req, res) => {
    const { player, message } = req.body;
    if (!player || !message) return res.status(400).json({ error: "No data" });

    // Проверка мута
    if (mutedUsers[player]) {
        if (Date.now() < mutedUsers[player]) {
            const timeLeft = Math.ceil((mutedUsers[player] - Date.now()) / 1000);
            return res.status(403).json({ error: "MUTED", timeLeft: timeLeft });
        } else {
            delete mutedUsers[player]; // Мут истек
        }
    }

    let finalMessage = message.substring(0, 150); // Лимит 150 символов
    
    globalMessages.push({
        player: player,
        msg: finalMessage,
        timestamp: Date.now()
    });

    if (globalMessages.length > 50) globalMessages = globalMessages.slice(-50);
    
    res.json({ status: "success" });
});

// --- 3. КОМАНДЫ АДМИНА (МУТ / ОЧИСТКА) ---
app.post('/admin', (req, res) => {
    const { password, action, target, duration } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Wrong Password" });
    }

    if (action === "mute") {
        // duration в секундах
        const endTime = Date.now() + (duration * 1000);
        mutedUsers[target] = endTime;
        
        // Добавляем системное сообщение
        globalMessages.push({
            player: "[SYSTEM]",
            msg: `Игрок ${target} получил мут на ${duration} сек.`,
            timestamp: Date.now()
        });
        
        return res.json({ status: "Muted", target: target });
    }

    if (action === "clear") {
        globalMessages = [];
        globalMessages.push({
            player: "[SYSTEM]",
            msg: "Чат был очищен администратором.",
            timestamp: Date.now()
        });
        return res.json({ status: "Chat Cleared" });
    }
    
    if (action === "unmute") {
        delete mutedUsers[target];
        return res.json({ status: "Unmuted", target: target });
    }

    res.json({ error: "Unknown action" });
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
