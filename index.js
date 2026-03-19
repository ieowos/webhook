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

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        country TEXT
    );
`).then(() => console.log('✅ Таблица users готова'))
  .catch(err => console.error('Ошибка таблицы:', err.message));

// ─── Webhook от ЮKassa ────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {

    // Отвечаем 200 сразу — ЮKassa ждёт ответ не дольше 3 секунд
    res.sendStatus(200);

    // Логируем всё что пришло — смотри в Railway Logs
    console.log('📩 ЮKassa webhook:');
    console.log(JSON.stringify(req.body, null, 2));

    const { type, event, object: payment } = req.body;

    // Нас интересует только успешная оплата
    if (type !== 'notification' || event !== 'payment.succeeded') {
        console.log(`ℹ️ Пропускаем событие: ${event}`);
        return;
    }

    if (payment.status !== 'succeeded' || !payment.paid) {
        console.log(`ℹ️ Платёж не завершён: status=${payment.status}`);
        return;
    }

    // Сумма
    const amount = Math.floor(parseFloat(payment.amount?.value));
    if (!amount || amount <= 0) {
        console.log('❌ Некорректная сумма:', payment.amount);
        return;
    }

    // ─── Ищем user_id во всех возможных местах ────────────────────────────────

    let userId = null;

    // 1. metadata.user_id — если пришло через YooKassa API
    if (payment.metadata?.user_id) {
        userId = String(payment.metadata.user_id).trim();
        console.log(`✅ user_id из metadata: ${userId}`);
    }

    // 2. description "GetTG|123456789" — Simplepay кладёт label в description
    if (!userId && payment.description && payment.description.includes('|')) {
        const parts = payment.description.split('|');
        const candidate = parts[parts.length - 1].trim();
        if (/^\d+$/.test(candidate)) {
            userId = candidate;
            console.log(`✅ user_id из description: ${userId}`);
        }
    }

    // 3. merchant_customer_id — Simplepay поле customerNumber
    if (!userId && payment.merchant_customer_id) {
        const candidate = String(payment.merchant_customer_id).trim();
        if (/^\d+$/.test(candidate)) {
            userId = candidate;
            console.log(`✅ user_id из merchant_customer_id: ${userId}`);
        }
    }

    // 4. label напрямую (некоторые версии Simplepay)
    if (!userId && payment.label) {
        const candidate = String(payment.label).trim();
        if (/^\d+$/.test(candidate)) {
            userId = candidate;
            console.log(`✅ user_id из label: ${userId}`);
        }
        // или формат "GetTG|ID"
        if (!userId && candidate.includes('|')) {
            const parts = candidate.split('|');
            const part = parts[parts.length - 1].trim();
            if (/^\d+$/.test(part)) {
                userId = part;
                console.log(`✅ user_id из label (split): ${userId}`);
            }
        }
    }

    // Не нашли user_id — уведомляем админа с полным дампом
    if (!userId) {
        console.log('❌ user_id не найден ни в одном поле');
        await notifyAdmin(
            `⚠️ <b>Платёж без user_id!</b>\n` +
            `Сумма: <b>${amount} ₽</b>\n` +
            `Payment ID: <code>${payment.id}</code>\n\n` +
            `Полный объект:\n<pre>${JSON.stringify(payment, null, 2).slice(0, 2000)}</pre>`
        );
        return;
    }

    console.log(`💰 Зачисляем ${amount} ₽ → user ${userId}`);

    // Зачисляем баланс (UPSERT)
    try {
        await pool.query(`
            INSERT INTO users (user_id, balance)
            VALUES ($1, $2)
            ON CONFLICT (user_id)
            DO UPDATE SET balance = users.balance + $2
        `, [userId, amount]);
        console.log(`✅ Баланс пользователя ${userId} пополнен на ${amount} ₽`);
    } catch (err) {
        console.error('❌ Ошибка БД:', err.message);
        await notifyAdmin(`❌ Ошибка БД!\nUser: <code>${userId}</code>\n${err.message}`);
        return;
    }

    // Уведомляем пользователя
    await notifyUser(userId, amount);

    // Уведомляем админа
    await notifyAdmin(
        `💰 <b>Пополнение баланса</b>\n` +
        `User: <code>${userId}</code>\n` +
        `Сумма: <b>${amount} ₽</b>\n` +
        `Payment ID: <code>${payment.id}</code>`
    );
});

async function notifyUser(userId, amount) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: userId,
            text: `✅ Оплата прошла успешно!\n\n💰 На баланс зачислено <b>${amount} ₽</b>`,
            parse_mode: 'HTML'
        });
        console.log(`✅ Пользователь ${userId} уведомлён`);
    } catch (e) {
        console.error(`❌ Не удалось уведомить пользователя ${userId}:`, e.message);
    }
}

async function notifyAdmin(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_ID,
            text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error('❌ Ошибка уведомления админа:', e.message);
    }
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🔗 Webhook: POST /webhook`);
    console.log(`🔗 Health:  GET  /health`);
});
