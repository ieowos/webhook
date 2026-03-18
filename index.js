const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// Важно: raw body для корректной проверки подписи ЮKassa
app.use(express.raw({ type: 'application/json' }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const ADMIN_ID = process.env.ADMIN_ID || '6966237267';

if (!BOT_TOKEN || !YOOKASSA_SECRET_KEY) {
    console.error('❌ BOT_TOKEN или YOOKASSA_SECRET_KEY не заданы!');
    process.exit(1);
}

console.log('✅ YooKassa Webhook запущен');

// Уведомление пользователя
async function notifyUser(userId, amount) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: userId,
            text: `✅ <b>Оплата прошла успешно!</b>\n\n💰 Сумма: ${amount} руб.\n\nБаланс будет пополнен в течение 1 минуты.`,
            parse_mode: "HTML"
        });
    } catch (e) { console.error('Не удалось уведомить пользователя:', e.message); }
}

// Уведомление админа
async function notifyAdmin(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_ID,
            text: text,
            parse_mode: "HTML"
        });
    } catch (e) { console.error('Ошибка уведомления админа:', e.message); }
}

app.post('/webhook', async (req, res) => {
    console.log('\n📩 ПОЛУЧЕН ВЕБХУК ОТ ЮKASSA');

    const signature = req.headers['x-yookassa-signature'];
    const rawBody = req.body;

    if (!signature) return res.status(400).send('Missing signature');

    // Проверка подписи (исправлено!)
    const hmac = crypto.createHmac('sha256', YOOKASSA_SECRET_KEY);
    const digest = hmac.update(rawBody).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
        console.log('⚠️ Неверная подпись');
        return res.status(400).send('Invalid signature');
    }

    console.log('✅ Подпись верна');

    const data = JSON.parse(rawBody.toString());

    if (data.event === 'payment.succeeded') {
        const payment = data.object;
        const userId = payment.customerNumber;
        const amount = payment.amount.value;

        console.log(`💰 ПЛАТЁЖ УСПЕШЕН: user=${userId}, amount=${amount} руб.`);

        if (userId && amount) {
            await notifyUser(userId, amount);
            await notifyAdmin(
                `💰 <b>Новое пополнение!</b>\n\n` +
                `👤 User ID: <code>${userId}</code>\n` +
                `💵 Сумма: <b>${amount}</b> руб.\n\n` +
                `✅ Добавь баланс командой:\n` +
                `<code>/addbalance ${userId} ${amount}</code>`
            );
        }
    }

    res.send('OK');
});

app.get('/health', (req, res) => res.json({ status: 'OK' }));
app.get('/', (req, res) => res.send('<h1>🚀 Webhook работает</h1>'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер на порту ${PORT}`);
});