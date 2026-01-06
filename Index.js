const express = require('express');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Разрешаем серверу понимать JSON, который присылает Roblox
app.use(express.json());

// --- НАСТРОЙКА 1: "Обрубаем" частые запросы (Защита от спама/DDoS) ---
// Если один и тот же сервер Roblox шлет запросы слишком часто, мы его блокируем на время.
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 100, // Максимум 100 запросов с одного IP за 1 минуту
    message: { error: "Слишком много запросов, подождите немного." }
});

// Применяем ограничитель ко всем запросам
app.use(limiter);


// Хранилище сообщений (в памяти).
// В реальном проекте лучше использовать Redis или Базу Данных.
let globalMessages = []; 

// --- НАСТРОЙКА 2: Функция очистки старых данных ---
// Чтобы память сервера не переполнилась, удаляем старые сообщения
const MAX_MESSAGES_HISTORY = 50; // Храним только последние 50 сообщений

function cleanUpMessages() {
    if (globalMessages.length > MAX_MESSAGES_HISTORY) {
        // Отрезаем лишнее, оставляем только новые
        globalMessages = globalMessages.slice(-MAX_MESSAGES_HISTORY);
    }
}


// --- РОУТ: Получение сообщений (Get) ---
app.get('/chat', (req, res) => {
    res.json(globalMessages);
});


// --- РОУТ: Отправка сообщения (Post) ---
app.post('/chat', (req, res) => {
    const { player, message } = req.body;

    // Простая валидация: данные должны существовать
    if (!player || !message) {
        return res.status(400).json({ error: "Неверные данные" });
    }

    // --- НАСТРОЙКА 3: "Обрубаем" длинные сообщения ---
    let finalMessage = message;
    const MAX_LENGTH = 100; // Максимальная длина сообщения

    if (finalMessage.length > MAX_LENGTH) {
        // Обрезаем строку до 100 символов и добавляем "..."
        finalMessage = finalMessage.substring(0, MAX_LENGTH) + "...";
    }

    // Создаем объект сообщения
    const newMessage = {
        player: player,
        msg: finalMessage,
        timestamp: Date.now()
    };

    // Добавляем в массив
    globalMessages.push(newMessage);
    
    // Чистим историю, если накопилось много
    cleanUpMessages();

    console.log(`[CHAT] ${player}: ${finalMessage}`);
    res.json({ status: "success", received: newMessage });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер глобального чата запущен на порту ${PORT}`);
});
