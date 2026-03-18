const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '6966237267';
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN || !DATABASE_URL) {
    console.error('❌ BOT_TOKEN или DATABASE_URL не заданы!');
    process.exit(1);
}

console.log('🚀 Webhook запущен');

// Подключение к PostgreSQL
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Создаём таблицу при первом запуске (один раз)
pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        country TEXT
    );
`)
    .then(() => console.log('✅ Таблица users готова'))
    .catch(err => console.error('Ошибка создания таблицы:', err.message));

// Уведомление пользователю
async function notifyUser(userId, amount) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: userId,
            text: `✅ Оплата прошла успешно!\n\n💰 На баланс зачислено **${amount} ₽**`,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error('Не удалось уведомить пользователя:', e.message);
    }
}

// Уведомление админу
async function notifyAdmin(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error('Ошибка уведомления админа:', e.message);
    }
}

app.post('/webhook', async (req, res) => {
    console.log('📩 Получен webhook от ЮKassa');

    const data = req.body;

    if (data.event === 'payment.succeeded') {
        const payment = data.object;
        const userId = payment.customerNumber;
        const amount = parseFloat(payment.amount.value);

        if (!userId || isNaN(amount) || amount <= 0) {
            console.log('Некорректные данные платежа');
            return res.send('OK');
        }

        console.log(`💰 Платёж: user=${userId}, сумма=${amount} ₽`);

        // Автоматическое пополнение (UPSERT)
        await pool.query(`
            INSERT INTO users (user_id, balance)
            VALUES ($1, $2)
            ON CONFLICT (user_id)
            DO UPDATE SET balance = users.balance + $2
        `, [userId, amount]);

        console.log(`✅ Баланс пополнен автоматически`);

        await notifyUser(userId, amount);
        await notifyAdmin(`💰 Автопополнение\nUser: <code>${userId}</code>\nСумма: <b>${amount} ₽</b>`);
    }

    res.send('OK');
});

app.get('/health', (req, res) => res.json({ status: 'OK', db: 'connected' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});