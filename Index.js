/*
    🛡️ SECURE CHAT SERVER V3 (SERVER-SIDE AUTHORITY)
    - Логика команд полностью на сервере.
    - Жесткая проверка прав администратора.
    - Клиент просто "отображает" данные, но не принимает решений.
*/

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sanitizeHtml = require('sanitize-html');

const app = express();
const PORT = process.env.PORT || 3000;

// === 🔒 КОНФИГУРАЦИЯ БЕЗОПАСНОСТИ ===
const CONFIG = {
    // Этот токен должен быть вшит в Lua скрипт
    API_TOKEN: "CHANGE_THIS_TO_SUPER_SECRET_TOKEN_999",

    // Ключи администраторов (вводятся игроком в Lua поле 'MY_SECRET_PASS')
    // Формат: "Ключ": "Никнейм_в_Роблоксе" (для привязки ключа к конкретному нику - опционально)
    // Или просто список разрешенных ключей.
    ADMIN_KEYS: [
        "MySecretKey123",  // Простой ключ
        "SuperAdminKey777" 
    ],
    
    // Системный пароль для внешних утилит (если нужно)
    SERVER_MASTER_PASS: "hihpikpass", 

    MAX_HISTORY: 50
};

// === 🧠 ХРАНИЛИЩЕ В RAM ===
let messages = [];
let bans = {};     // { "Username": timestamp_end }
let mutes = {};    // { "Username": timestamp_end }
let admins = {};   // { "Username": true } (активные сессии админов)

app.use(cors());
app.use(bodyParser.json());

// === 🛑 ЗАЩИТНЫЙ СЛОЙ (AUTH MIDDLEWARE) ===
const authMiddleware = (req, res, next) => {
    // 1. Проверка API Токена (базовая защита от сканирования)
    const clientToken = req.headers['x-chat-auth'];
    if (!clientToken || clientToken !== CONFIG.API_TOKEN) {
        return res.status(404).send(); // Притворяемся, что сервера нет
    }

    // 2. Проверка User-Agent
    const userAgent = req.headers['user-agent'] || "";
    if (!userAgent.includes("Roblox") && !userAgent.includes("Postman")) {
         return res.status(403).json({ error: "Access Denied: Roblox Only" });
    }
    next();
};
app.use(authMiddleware);

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
const cleanText = (text) => sanitizeHtml(text || "", { allowedTags: [], allowedAttributes: {} });

// Проверка: Забанен ли игрок?
const isBanned = (player) => {
    if (!bans[player]) return false;
    if (Date.now() > bans[player]) { delete bans[player]; return false; } // Бан истек
    return true;
};

// Проверка: В муте ли игрок?
const isMuted = (player) => {
    if (!mutes[player]) return false;
    if (Date.now() > mutes[player]) { delete mutes[player]; return false; } // Мут истек
    return true;
};

// Проверка: Является ли игрок админом?
const isAdmin = (player) => {
    return admins[player] === true;
};

// === 🚀 ЭНДПОИНТЫ API ===

// 1. ПОЛУЧЕНИЕ СООБЩЕНИЙ
app.get('/chat', (req, res) => {
    // Возвращаем сообщения. Можно добавить фильтрацию, если нужно.
    res.json(messages);
});

// 2. ОТПРАВКА СООБЩЕНИЙ И АВТОРИЗАЦИЯ
app.post('/chat', (req, res) => {
    const { player, message, secureKey } = req.body;
    
    if (!player || !message) return res.status(400).json({ error: "No data" });

    // 1. Попытка авторизации админа
    if (secureKey && CONFIG.ADMIN_KEYS.includes(secureKey)) {
        admins[player] = true; // Выдаем права админа в сессии сервера
    }

    // 2. Проверка Бана
    if (isBanned(player)) {
        return res.status(403).json({ error: "You are banned from the chat." });
    }

    // 3. Проверка Мута
    if (isMuted(player)) {
        return res.status(403).json({ error: "You are muted." });
    }

    const safeMessage = cleanText(message);
    const safePlayer = cleanText(player);

    // Защита от подделки системных ников
    if (safePlayer.toUpperCase() === "SYSTEM" || safePlayer.toUpperCase() === "ANNOUNCEMENT") {
        return res.status(403).json({ error: "Reserved nickname" });
    }

    // Защита от ссылок
    if (safeMessage.includes("http") || safeMessage.includes("www.") || safeMessage.includes(".com")) {
         return res.json({ success: false, info: "Links blocked" });
    }

    // Добавляем сообщение
    messages.push({ 
        player: safePlayer, 
        msg: safeMessage, 
        timestamp: Date.now(), 
        type: "user" 
    });

    if (messages.length > CONFIG.MAX_HISTORY) messages.shift();

    res.json({ success: true });
});

// 3. ПРОВЕРКА РОЛИ (Для обновления UI клиента)
app.get('/check-role', (req, res) => {
    const { player } = req.query;
    res.json({ role: isAdmin(player) ? "ADMIN" : "USER" });
});

// 4. ВЫПОЛНЕНИЕ АДМИН-КОМАНД (ТОЛЬКО СЕРВЕРНАЯ ОБРАБОТКА)
app.post('/admin', (req, res) => {
    const { password, action, target, duration, text, executor } = req.body;
    
    // Два способа выполнить команду:
    // 1. Знать SERVER_MASTER_PASS (для внешних панелей)
    // 2. Быть авторизованным админом в памяти сервера (executor)
    
    const isMaster = password === CONFIG.SERVER_MASTER_PASS;
    const isAuthorizedAdmin = executor && isAdmin(executor);

    if (!isMaster && !isAuthorizedAdmin) {
        return res.status(401).send(); // Молчаливый отказ
    }

    const sysTime = Date.now();
    let sysMsg = "";
    const targetClean = cleanText(target);

    switch (action) {
        case 'ban':
            if (!targetClean) return res.json({error: "No target"});
            // Нельзя забанить другого админа (защита от дурака)
            if (isAdmin(targetClean)) return res.json({error: "Cannot ban admin"});
            
            bans[targetClean] = sysTime + (duration * 1000); 
            sysMsg = `🚫 SYSTEM: ${targetClean} banned for ${duration/60} mins.`; 
            break;

        case 'unban':
            if (bans[targetClean]) delete bans[targetClean];
            sysMsg = `✅ SYSTEM: ${targetClean} unbanned.`;
            break;

        case 'mute':
            if (isAdmin(targetClean)) return res.json({error: "Cannot mute admin"});
            mutes[targetClean] = sysTime + (duration * 1000);
            sysMsg = `🔇 SYSTEM: ${targetClean} muted for ${duration/60} mins.`;
            break;

        case 'kick':
            if (isAdmin(targetClean)) return res.json({error: "Cannot kick admin"});
            // Кик - это просто сообщение, клиентский скрипт должен увидеть его и закрыть игру
            sysMsg = `👢 SYSTEM: ${targetClean} kicked.`; 
            break;

        case 'clear':
            messages = [];
            sysMsg = `🧹 Chat cleared by administrator.`;
            break;

        case 'announce':
            messages.push({ 
                player: "ANNOUNCEMENT", 
                msg: cleanText(text), 
                timestamp: Date.now(), 
                type: "announce" 
            });
            return res.json({ success: true });

        case 'info':
            // Возвращаем статус, но СКРЫВАЕМ IP
            const infoData = { 
                status: isBanned(targetClean) ? "BANNED" : (isMuted(targetClean) ? "MUTED" : "ACTIVE"),
                role: isAdmin(targetClean) ? "ADMIN" : "USER",
                ip: "HIDDEN-BY-SERVER" 
            };
            return res.json({ success: true, data: infoData });
    }

    if (sysMsg) {
        messages.push({ 
            player: "SYSTEM", 
            msg: sysMsg, 
            timestamp: Date.now(), 
            type: "sys" 
        });
    }

    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🛡️ ULTRA SECURE SERVER PORT ${PORT}`));