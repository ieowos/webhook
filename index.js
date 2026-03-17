const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

function verifySignature(body, signature) {
    const hmac = crypto.createHmac('sha256', YOOKASSA_SECRET_KEY);
    const digest = hmac.update(JSON.stringify(body)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

async function notifyUser(userId, amount) {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: userId,
        text: `✅ Баланс пополнен на ${amount} руб.`
    });
}

app.post('/webhook', async (req, res) => {
    const signature = req.headers['x-yookassa-signature'];
    
    if (!verifySignature(req.body, signature)) {
        return res.status(400).send('Invalid signature');
    }

    if (req.body.event === 'payment.succeeded') {
        const { customerNumber, amount } = req.body.object;
        await notifyUser(customerNumber, amount.value);
    }
    
    res.send('OK');
});

app.get('/health', (req, res) => res.send('OK'));

app.listen(8080, () => console.log('Webhook server running on port 8080'));