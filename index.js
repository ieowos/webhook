const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

// Переменные окружения (добавьте в Railway)
const BOT_TOKEN = process.env.BOT_TOKEN;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const ADMIN_ID = process.env.ADMIN_ID || '6966237267'; // Ваш Telegram ID для логов

// Проверка наличия переменных
if (!BOT_TOKEN || !YOOKASSA_SECRET_KEY) {
    console.error('❌ Ошибка: BOT_TOKEN или YOOKASSA_SECRET_KEY не заданы!');
    process.exit(1);
}

// Функция проверки подписи ЮKassa
function verifySignature(body, signature) {
    try {
        const hmac = crypto.createHmac('sha256', YOOKASSA_SECRET_KEY);
        const digest = hmac.update(JSON.stringify(body)).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch (error) {
        console.error('❌ Ошибка проверки подписи:', error.message);
        return false;
    }
}

// Отправка команды боту через Telegram API
async function sendCommandToBot(userId, amount) {
    try {
        // Отправляем команду /addbalance прямо пользователю
        // Бот получит это как обычное сообщение и выполнит add_balance
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: userId,
            text: `/addbalance ${amount}`
        });
        console.log(`✅ Команда отправлена пользователю ${userId}: +${amount} руб.`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка отправки команды: ${error.message}`);
        return false;
    }
}

// Отправка уведомления админу (опционально)
async function notifyAdmin(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_ID,
            text: message
        });
    } catch (error) {
        console.error('❌ Ошибка уведомления админа:', error.message);
    }
}

// Главный вебхук
app.post('/webhook', async (req, res) => {
    console.log('\n📩 ПОЛУЧЕН ВЕБХУК ОТ ЮKASSA');
    
    const signature = req.headers['x-yookassa-signature'];
    if (!signature) {
        console.log('⚠️ Отсутствует подпись');
        return res.status(400).send('Missing signature');
    }

    if (!verifySignature(req.body, signature)) {
        console.log('⚠️ Неверная подпись');
        return res.status(400).send('Invalid signature');
    }

    console.log('✅ Подпись верна');

    const data = req.body;
    console.log(`📦 Событие: ${data.event}`);

    if (data.event === 'payment.succeeded') {
        const payment = data.object;
        const userId = payment.customerNumber;
        const amount = payment.amount.value;
        
        console.log(`💰 Платёж: user=${userId}, amount=${amount} руб.`);
        
        if (userId && amount) {
            // 1. Отправляем команду боту
            const sent = await sendCommandToBot(userId, amount);
            
            // 2. Уведомляем админа
            if (sent) {
                await notifyAdmin(
                    `💰 Пополнение баланса\n👤 Пользователь: ${userId}\n💵 Сумма: ${amount} руб.`
                );
            }
        }
    }
    
    res.send('OK');
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        bot_token_set: !!BOT_TOKEN,
        yookassa_key_set: !!YOOKASSA_SECRET_KEY
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Webhook server запущен на порту ${PORT}`);
    console.log(`🔗 URL вебхука: https://webhook-production-dc64.up.railway.app/webhook`);
});