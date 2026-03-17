const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const BOT_API_URL = 'https://rogue-lopik.amvera.io/api/add_balance';

// Проверка наличия обязательных переменных
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не задан!');
    process.exit(1);
}
if (!YOOKASSA_SECRET_KEY) {
    console.error('❌ YOOKASSA_SECRET_KEY не задан!');
    process.exit(1);
}
console.log('✅ Переменные окружения загружены');

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

async function notifyUser(userId, amount) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: userId,
            text: `✅ Баланс пополнен на ${amount} руб.`
        });
        console.log(`📨 Уведомление отправлено пользователю ${userId}`);
    } catch (error) {
        console.error(`❌ Ошибка отправки уведомления: ${error.message}`);
    }
}

async function updateBalance(userId, amount) {
    try {
        await axios.post(BOT_API_URL, {
            user_id: userId,
            amount: amount
        });
        console.log(`💰 Баланс обновлён: user ${userId} +${amount}`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка обновления баланса: ${error.message}`);
        return false;
    }
}

app.post('/webhook', async (req, res) => {
    console.log('\n📩 ПОЛУЧЕН ВЕБХУК');
    
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

    if (req.body.event === 'payment.succeeded') {
        const { customerNumber, amount } = req.body.object;
        console.log(`💰 Платёж: user=${customerNumber}, amount=${amount.value}`);
        
        if (customerNumber && amount) {
            // Обновляем баланс через API бота
            const updated = await updateBalance(customerNumber, amount.value);
            
            if (updated) {
                // Отправляем уведомление пользователю
                await notifyUser(customerNumber, amount.value);
            }
        }
    } else {
        console.log(`ℹ️ Событие: ${req.body.event}`);
    }
    
    res.send('OK');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        bot_token_set: !!BOT_TOKEN,
        yookassa_key_set: !!YOOKASSA_SECRET_KEY
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Webhook server running on port ${PORT}`);
    console.log(`🔗 Бот API: ${BOT_API_URL}`);
});