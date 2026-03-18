const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
app.use(express.raw({ type: 'application/json' }));

// ────────────────────────────────────────────────
// Конфигурация
// ────────────────────────────────────────────────
const BOT_TOKEN           = process.env.BOT_TOKEN;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const ADMIN_ID            = process.env.ADMIN_ID || '6966237267';
const DB_PATH             = process.env.DB_PATH || './users.db';   // ← или '/data/users.db' если volume

console.log(`[START] DB_PATH = ${DB_PATH}`);

if (!BOT_TOKEN || !YOOKASSA_SECRET_KEY) {
    console.error('❌ BOT_TOKEN или YOOKASSA_SECRET_KEY отсутствуют');
    process.exit(1);
}

// Проверка существования файла базы (только лог)
if (!fs.existsSync(DB_PATH)) {
    console.warn(`⚠️ Файл базы не найден по пути ${DB_PATH} — создастся при первом INSERT`);
}

// Подключение к базе
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('❌ Ошибка открытия базы данных:', err.message);
    } else {
        console.log(`✅ База данных открыта: ${DB_PATH}`);
    }
});

// Простая проверка таблицы при старте
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
    if (err) {
        console.error('Ошибка проверки таблицы users:', err.message);
    } else if (row) {
        console.log('Таблица users найдена');
    } else {
        console.warn('Таблица users НЕ найдена — будет создана при первом INSERT');
    }
});

// Уведомление пользователю
async function notifyUser(userId, amount) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: userId,
            text: `✅ Оплата прошла успешно!\n\n💰 На баланс зачислено **${amount} ₽**`,
            parse_mode: 'Markdown'
        });
        console.log(`Уведомление пользователю ${userId} отправлено`);
    } catch (err) {
        console.error(`Ошибка отправки пользователю ${userId}:`, err.message);
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
    } catch (err) {
        console.error('Ошибка уведомления админа:', err.message);
    }
}

app.post('/webhook', async (req, res) => {
    console.log('📩 Получен webhook от ЮKassa');

    const signature = req.headers['x-yookassa-signature'];
    if (!signature) {
        console.log('Отсутствует подпись');
        return res.status(400).send('Missing signature');
    }

    // Проверка подписи
    const hmac = crypto.createHmac('sha256', YOOKASSA_SECRET_KEY);
    const computed = hmac.update(req.body).digest('hex');

    if (computed !== signature) {
        console.log('Неверная подпись');
        return res.status(400).send('Invalid signature');
    }

    let data;
    try {
        data = JSON.parse(req.body.toString());
    } catch (e) {
        console.error('Невалидный JSON:', e.message);
        return res.status(400).send('Invalid JSON');
    }

    if (data.event === 'payment.succeeded') {
        const payment = data.object;
        const userId = payment.customerNumber;          // Telegram ID
        const amount = parseFloat(payment.amount.value);

        if (!userId || isNaN(amount) || amount <= 0) {
            console.log('Некорректные данные в платеже');
            return res.send('OK');
        }

        console.log(`💰 Успешный платёж → user=${userId}, сумма=${amount}`);

        // 1. Пытаемся обновить существующий баланс
        db.run(
            `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
            [amount, userId],
            function (err) {
                if (err) {
                    console.error('Ошибка UPDATE:', err.message);
                    notifyAdmin(`⚠️ Ошибка зачисления ${amount}₽ → ${userId}\n${err.message}`);
                } else if (this.changes === 0) {
                    // Пользователя нет → создаём
                    db.run(
                        `INSERT INTO users (user_id, balance) VALUES (?, ?)`,
                        [userId, amount],
                        (err2) => {
                            if (err2) {
                                console.error('Ошибка INSERT:', err2.message);
                            } else {
                                console.log(`Создан пользователь ${userId} с балансом ${amount}`);
                            }
                        }
                    );
                } else {
                    console.log(`Баланс ${userId} увеличен на ${amount}`);
                }
            }
        );

        // Уведомления
        await notifyUser(userId, amount);
        await notifyAdmin(
            `💰 Автозачёт\n` +
            `Пользователь: <code>${userId}</code>\n` +
            `Сумма: <b>${amount} ₽</b>`
        );
    }

    res.status(200).send('OK');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        db_path: DB_PATH,
        db_connected: !!db.open
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Webhook запущен на порту ${PORT}`);
});