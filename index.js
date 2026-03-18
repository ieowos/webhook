const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

// Переменные окружения
const BOT_TOKEN = process.env.BOT_TOKEN;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const ADMIN_ID = process.env.ADMIN_ID || '6966237267';

// Проверка наличия переменных
if (!BOT_TOKEN || !YOOKASSA_SECRET_KEY) {
    console.error('❌ Ошибка: BOT_TOKEN или YOOKASSA_SECRET_KEY не заданы!');
    process.exit(1);
}

console.log('✅ Переменные окружения загружены');
console.log(`🤖 BOT_TOKEN: ${BOT_TOKEN.substring(0, 10)}...`);
console.log(`🔑 YOOKASSA_SECRET_KEY: ${YOOKASSA_SECRET_KEY ? 'задан' : 'не задан'}`);

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
        console.log(`📤 Отправка команды пользователю ${userId}: /addbalance ${amount}`);
        
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: userId,
            text: `/addbalance ${amount}`  // ← ИСПРАВЛЕНО!
        });
        
        console.log(`✅ Команда отправлена, статус: ${response.status}`);
        console.log(`📨 Ответ Telegram:`, response.data);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка отправки команды:`, error.response?.data || error.message);
        return false;
    }
}

// Отправка уведомления админу
async function notifyAdmin(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_ID,
            text: message
        });
        console.log(`✅ Уведомление админу отправлено`);
    } catch (error) {
        console.error('❌ Ошибка уведомления админа:', error.message);
    }
}

// Главный вебхук
app.post('/webhook', async (req, res) => {
    console.log('\n' + '='.repeat(50));
    console.log('📩 ПОЛУЧЕН ВЕБХУК ОТ ЮKASSA');
    console.log('='.repeat(50));
    
    const signature = req.headers['x-yookassa-signature'];
    if (!signature) {
        console.log('⚠️ Отсутствует подпись');
        return res.status(400).send('Missing signature');
    }

    console.log(`🔑 Подпись: ${signature.substring(0, 20)}...`);

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
    } else {
        console.log(`ℹ️ Другое событие: ${data.event}`);
    }
    
    console.log('✅ Вебхук обработан, отправляем OK');
    res.send('OK');
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        bot_token_set: !!BOT_TOKEN,
        yookassa_key_set: !!YOOKASSA_SECRET_KEY
    });
});

// Корневой маршрут
app.get('/', (req, res) => {
    res.send(`
        <h1>🚀 Webhook Server Running</h1>
        <p>POST /webhook - для приема уведомлений от ЮKassa</p>
        <p>GET /health - проверка статуса</p>
    `);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log(`🚀 Webhook server запущен на порту ${PORT}`);
    console.log(`🔗 URL вебхука: https://webhook-production-dc64.up.railway.app/webhook`);
    console.log(`📊 Health check: https://webhook-production-dc64.up.railway.app/health`);
    console.log('='.repeat(50) + '\n');
});