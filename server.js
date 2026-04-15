require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// MULTI ADMIN
const ADMIN_IDS = String(process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // 🔒 hanya admin
    if (ADMIN_IDS.length && !ADMIN_IDS.includes(String(userId))) {
      return bot.sendMessage(chatId, '🔒 Bot ini private');
    }

    if (!text) return;

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Jawab singkat, jelas, dan santai.' },
        { role: 'user', content: text }
      ]
    });

    const reply = res.choices[0].message.content;

    await bot.sendMessage(chatId, reply);

  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, '❌ error');
  }
});
