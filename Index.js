// server.js - Улучшенный сервер для Global Chat
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// Rate limiting - защита от спама
const limiter = rateLimit({
    windowMs: 1000, // 1 секунда
    max: 5, // максимум 5 запросов в секунду
    message: { error: 'Слишком много запросов, подождите' },
    standardHeaders: true,
    legacyHeaders: false,
});

const messageLimiter = rateLimit({
    windowMs: 2000, // 2 секунды
    max: 1, // 1 сообщение в 2 секунды
    message: { error: 'Подождите перед отправкой следующего сообщения' },
    keyGenerator: (req) => req.body.player || req.ip,
});

app.use('/chat', limiter);

// Хранилище данных (в продакшене используй Redis или MongoDB)
let messages = [];
let whispers = [];
let bannedUsers = new Set();
let mutedUsers = new Map(); // username -> unmute timestamp

const MAX_MESSAGES = 100;
const MESSAGE_LIFETIME = 5 * 60 * 1000; // 5 минут

// Роли пользователей
const USER_ROLES = {
    'hihpik0': { level: 5, prefix: '👑 СОЗДАТЕЛЬ', color: 'RAINBOW', badge: '👑' },
    'BAAAAHHRR': { level: 4, prefix: '⚡ АДМИН', color: 'GOLD', badge: '⚡' },
    // Добавляй своих админов сюда
};

// Секретный ключ для админских команд (поменяй на свой!)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'super-secret-admin-key-12345';

// Запрещённые слова
const BANNED_WORDS = [
    'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'cunt', 'whore', 'faggot', 'kys', 'rape',
    'хуй', 'пизда', 'ебать', 'бля', 'шлюха', 'пидор', 'гандон', 'мразь', 'сука', 'еблан',
    'хер', 'даун', 'дебил', 'идиот', 'урод'
];

// Функции утилиты
function generateMessageId() {
    return crypto.randomBytes(8).toString('hex');
}

function cleanOldMessages() {
    const now = Date.now();
    messages = messages.filter(m => now - m.timestamp < MESSAGE_LIFETIME);
    whispers = whispers.filter(m => now - m.timestamp < MESSAGE_LIFETIME);
    
    // Ограничение количества
    if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(-MAX_MESSAGES);
    }
}

function filterMessage(text) {
    if (!text || typeof text !== 'string') {
        return { valid: false, reason: 'Пустое сообщение' };
    }
    
    text = text.trim();
    
    if (text.length === 0) {
        return { valid: false, reason: 'Пустое сообщение' };
    }
    
    if (text.length > 250) {
        return { valid: false, reason: 'Сообщение слишком длинное (макс. 250)' };
    }
    
    // Проверка на Caps Lock (более 70% заглавных)
    const upperCount = (text.match(/[A-ZА-ЯЁ]/g) || []).length;
    const letterCount = (text.match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length;
    if (letterCount > 10 && (upperCount / letterCount) > 0.7) {
        return { valid: false, reason: 'Слишком много заглавных букв' };
    }
    
    // Проверка на запрещённые слова
    const lowerText = text.toLowerCase();
    for (const word of BANNED_WORDS) {
        if (lowerText.includes(word.toLowerCase())) {
            return { valid: false, reason: 'Сообщение содержит запрещённое слово' };
        }
    }
    
    // Проверка на спам символов
    if (/(.)\1{5,}/.test(text)) {
        return { valid: false, reason: 'Обнаружен спам символов' };
    }
    
    return { valid: true, filtered: text };
}

function isUserMuted(username) {
    if (!mutedUsers.has(username)) return false;
    
    const unmuteTime = mutedUsers.get(username);
    if (Date.now() > unmuteTime) {
        mutedUsers.delete(username);
        return false;
    }
    return true;
}

function getUserRole(username) {
    return USER_ROLES[username] || null;
}

function isAdmin(username) {
    const role = getUserRole(username);
    return role && role.level >= 4;
}

// ============ API ENDPOINTS ============

// Главная страница
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        name: '🌐 Global Chat API',
        version: '23.0',
        messages: messages.length,
        uptime: process.uptime()
    });
});

// Проверка здоровья сервера
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: Date.now(),
        messages_count: messages.length
    });
});

// Получение сообщений
app.get('/chat', (req, res) => {
    try {
        cleanOldMessages();
        
        // Возвращаем только публичные сообщения
        const publicMessages = messages.filter(m => !m.isWhisper);
        
        res.json(publicMessages);
    } catch (error) {
        console.error('Error getting messages:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправка сообщения
app.post('/chat', messageLimiter, (req, res) => {
    try {
        const { player, message } = req.body;
        
        // Валидация
        if (!player || typeof player !== 'string') {
            return res.status(400).json({ error: 'Неверное имя игрока' });
        }
        
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Неверное сообщение' });
        }
        
        const username = player.trim().substring(0, 50);
        
        // Проверка бана
        if (bannedUsers.has(username.toLowerCase())) {
            return res.status(403).json({ error: 'Вы забанены в чате' });
        }
        
        // Проверка мута
        if (isUserMuted(username)) {
            const remaining = Math.ceil((mutedUsers.get(username) - Date.now()) / 1000);
            return res.status(403).json({ error: `Вы замучены. Осталось: ${remaining} сек.` });
        }
        
        // Фильтрация сообщения
        const filterResult = filterMessage(message);
        if (!filterResult.valid) {
            return res.status(400).json({ error: filterResult.reason });
        }
        
        // Получение роли
        const role = getUserRole(username);
        
        // Создание сообщения
        const newMessage = {
            id: generateMessageId(),
            player: username,
            msg: filterResult.filtered,
            timestamp: Date.now(),
            role: role
        };
        
        messages.push(newMessage);
        cleanOldMessages();
        
        console.log(`💬 [${username}]: ${filterResult.filtered.substring(0, 50)}...`);
        
        res.json({ 
            success: true, 
            id: newMessage.id,
            message: newMessage
        });
        
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправка личного сообщения (whisper)
app.post('/whisper', messageLimiter, (req, res) => {
    try {
        const { sender, target, message } = req.body;
        
        if (!sender || !target || !message) {
            return res.status(400).json({ error: 'Неверные данные' });
        }
        
        if (sender.toLowerCase() === target.toLowerCase()) {
            return res.status(400).json({ error: 'Нельзя писать себе' });
        }
        
        // Проверка бана
        if (bannedUsers.has(sender.toLowerCase())) {
            return res.status(403).json({ error: 'Вы забанены' });
        }
        
        // Фильтрация
        const filterResult = filterMessage(message);
        if (!filterResult.valid) {
            return res.status(400).json({ error: filterResult.reason });
        }
        
        const whisperMessage = {
            id: generateMessageId(),
            sender: sender.trim(),
            target: target.trim(),
            msg: filterResult.filtered,
            timestamp: Date.now(),
            isWhisper: true
        };
        
        whispers.push(whisperMessage);
        
        res.json({ success: true, id: whisperMessage.id });
        
    } catch (error) {
        console.error('Error sending whisper:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение личных сообщений
app.get('/whispers/:username', (req, res) => {
    try {
        const username = req.params.username.toLowerCase();
        
        cleanOldMessages();
        
        // Сообщения для этого пользователя
        const userWhispers = whispers.filter(w => 
            w.sender.toLowerCase() === username || 
            w.target.toLowerCase() === username
        );
        
        res.json(userWhispers);
        
    } catch (error) {
        console.error('Error getting whispers:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Проверка роли пользователя
app.get('/check-role', (req, res) => {
    try {
        const player = req.query.player;
        
        if (!player) {
            return res.status(400).json({ error: 'Не указан игрок' });
        }
        
        const role = getUserRole(player);
        
        if (role) {
            res.json({
                role: role.level >= 4 ? 'ADMIN' : 'VIP',
                level: role.level,
                prefix: role.prefix,
                color: role.color,
                badge: role.badge
            });
        } else {
            res.json({
                role: 'USER',
                level: 0
            });
        }
        
    } catch (error) {
        console.error('Error checking role:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ АДМИНСКИЕ КОМАНДЫ ============

// Админское объявление
app.post('/admin/announce', (req, res) => {
    try {
        const { admin, message, secret } = req.body;
        
        if (secret !== ADMIN_SECRET) {
            return res.status(403).json({ error: 'Неверный ключ' });
        }
        
        if (!isAdmin(admin)) {
            return res.status(403).json({ error: 'Нет прав' });
        }
        
        const announcement = {
            id: generateMessageId(),
            player: '📢 ОБЪЯВЛЕНИЕ',
            msg: message,
            timestamp: Date.now(),
            type: 'announcement',
            admin: admin
        };
        
        messages.push(announcement);
        
        console.log(`📢 [ANNOUNCE by ${admin}]: ${message}`);
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Бан пользователя
app.post('/admin/ban', (req, res) => {
    try {
        const { admin, target, secret } = req.body;
        
        if (secret !== ADMIN_SECRET) {
            return res.status(403).json({ error: 'Неверный ключ' });
        }
        
        if (!isAdmin(admin)) {
            return res.status(403).json({ error: 'Нет прав' });
        }
        
        // Нельзя банить админов
        if (isAdmin(target)) {
            return res.status(400).json({ error: 'Нельзя забанить админа' });
        }
        
        bannedUsers.add(target.toLowerCase());
        
        // Системное сообщение
        messages.push({
            id: generateMessageId(),
            player: '🔨 СИСТЕМА',
            msg: `${target} был забанен администратором`,
            timestamp: Date.now(),
            type: 'system'
        });
        
        console.log(`🔨 [BAN] ${admin} забанил ${target}`);
        
        res.json({ success: true, message: `${target} забанен` });
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Разбан пользователя
app.post('/admin/unban', (req, res) => {
    try {
        const { admin, target, secret } = req.body;
        
        if (secret !== ADMIN_SECRET) {
            return res.status(403).json({ error: 'Неверный ключ' });
        }
        
        if (!isAdmin(admin)) {
            return res.status(403).json({ error: 'Нет прав' });
        }
        
        bannedUsers.delete(target.toLowerCase());
        
        console.log(`✅ [UNBAN] ${admin} разбанил ${target}`);
        
        res.json({ success: true, message: `${target} разбанен` });
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Мут пользователя
app.post('/admin/mute', (req, res) => {
    try {
        const { admin, target, duration, secret } = req.body;
        
        if (secret !== ADMIN_SECRET) {
            return res.status(403).json({ error: 'Неверный ключ' });
        }
        
        if (!isAdmin(admin)) {
            return res.status(403).json({ error: 'Нет прав' });
        }
        
        if (isAdmin(target)) {
            return res.status(400).json({ error: 'Нельзя замутить админа' });
        }
        
        const muteDuration = Math.min(duration || 60, 3600); // Макс 1 час
        const unmuteTime = Date.now() + (muteDuration * 1000);
        
        mutedUsers.set(target, unmuteTime);
        
        messages.push({
            id: generateMessageId(),
            player: '🔇 СИСТЕМА',
            msg: `${target} замучен на ${muteDuration} секунд`,
            timestamp: Date.now(),
            type: 'system'
        });
        
        console.log(`🔇 [MUTE] ${admin} замутил ${target} на ${muteDuration}с`);
        
        res.json({ success: true, message: `${target} замучен на ${muteDuration}с` });
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Очистка чата
app.post('/admin/clear', (req, res) => {
    try {
        const { admin, secret } = req.body;
        
        if (secret !== ADMIN_SECRET) {
            return res.status(403).json({ error: 'Неверный ключ' });
        }
        
        if (!isAdmin(admin)) {
            return res.status(403).json({ error: 'Нет прав' });
        }
        
        messages = [];
        
        messages.push({
            id: generateMessageId(),
            player: '🧹 СИСТЕМА',
            msg: 'Чат был очищен администратором',
            timestamp: Date.now(),
            type: 'system'
        });
        
        console.log(`🧹 [CLEAR] ${admin} очистил чат`);
        
        res.json({ success: true, message: 'Чат очищен' });
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Получение списка забаненных
app.get('/admin/banned', (req, res) => {
    try {
        const { secret } = req.query;
        
        if (secret !== ADMIN_SECRET) {
            return res.status(403).json({ error: 'Неверный ключ' });
        }
        
        res.json({
            banned: Array.from(bannedUsers),
            muted: Object.fromEntries(mutedUsers)
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Статистика сервера
app.get('/stats', (req, res) => {
    res.json({
        messages_count: messages.length,
        whispers_count: whispers.length,
        banned_count: bannedUsers.size,
        muted_count: mutedUsers.size,
        uptime_seconds: Math.floor(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║   🌐 GLOBAL CHAT SERVER v23.0         ║
    ║   ✅ Сервер запущен на порту ${PORT}     ║
    ║   🔒 Защита от спама активна          ║
    ║   📊 Лимит: ${MAX_MESSAGES} сообщений           ║
    ╚═══════════════════════════════════════╝
    `);
});

// Периодическая очистка
setInterval(cleanOldMessages, 60000); // Каждую минуту
