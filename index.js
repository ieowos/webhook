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

// Создаём таблицу при первом запуске
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
            text: `✅ Оплата прошла успешно!\n\n💰 На баланс зачислено *${amount} ₽*`,
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
    // ИСПРАВЛЕНО: логируем полное тело вебхука для диагностики
    console.log('📩 Получен webhook от ЮKassa');
    console.log('📦 Полное тело:', JSON.stringify(req.body, null, 2));

    const data = req.body;

    if (data.event === 'payment.succeeded') {
        const payment = data.object;

        console.log('💳 Объект платежа:', JSON.stringify(payment, null, 2));

        // ИСПРАВЛЕНО: ищем userId в трёх местах по приоритету
        // 1. metadata.user_id — если форма передала name="metadata[user_id]"
        // 2. merchant_customer_id — если форма передала name="customerNumber"
        // 3. description — запасной вариант
        let userId =
            (payment.metadata && payment.metadata.user_id) ||
            payment.merchant_customer_id ||
            null;

        // Попытка вытащить из description если там что-то вроде "user:12345"
        if (!userId && payment.description) {
            const match = payment.description.match(/(\d{5,})/);
            if (match) userId = match[1];
        }

        console.log(`🔍 userId найден: ${userId}`);

        const amount = parseFloat(payment.amount && payment.amount.value);

        if (!userId || isNaN(amount) || amount <= 0) {
            console.log('⚠️ userId не найден или сумма некорректна!');
            // Отправляем админу дамп платежа для диагностики
            await notifyAdmin(
                `⚠️ <b>Платёж без userId!</b>\n\n` +
                `Сумма: <b>${amount} ₽</b>\n\n` +
                `<b>Дамп объекта платежа:</b>\n` +
                `<pre>${JSON.stringify(payment, null, 2).slice(0, 3000)}</pre>`
            );
            return res.send('OK');
        }

        console.log(`💰 Платёж: user=${userId}, сумма=${amount} ₽`);

        // Автоматическое пополнение (UPSERT)
        try {
            await pool.query(`
                INSERT INTO users (user_id, balance)
                VALUES ($1, $2)
                ON CONFLICT (user_id)
                DO UPDATE SET balance = users.balance + $2
            `, [userId, amount]);

            console.log(`✅ Баланс пользователя ${userId} пополнен на ${amount} ₽`);

            await notifyUser(userId, amount);
            await notifyAdmin(
                `💰 <b>Автопополнение</b>\n` +
                `User: <code>${userId}</code>\n` +
                `Сумма: <b>${amount} ₽</b>`
            );
        } catch (dbErr) {
            console.error('❌ Ошибка записи в БД:', dbErr.message);
            await notifyAdmin(`❌ Ошибка БД при пополнении user ${userId}: ${dbErr.message}`);
        }
    }

    res.send('OK');
});

app.get('/health', (req, res) => res.json({ status: 'OK', db: 'connected' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});