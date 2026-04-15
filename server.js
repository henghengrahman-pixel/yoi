require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');

// init bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true
});

// init openai
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// MULTI ADMIN
const ADMIN_IDS = String(process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// listener
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    // ambil text atau caption
    const text = msg.text || msg.caption;

    // 🔒 hanya admin
    if (ADMIN_IDS.length && !ADMIN_IDS.includes(String(userId))) {
      return bot.sendMessage(chatId, '🔒 Bot ini private');
    }

    // kalau kosong (misal kirim gambar tanpa caption)
    if (!text) {
      return bot.sendMessage(chatId, '❗ Kirim pesan text ya');
    }

    // ⏳ loading
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Lagi mikir...');

    // request ke OpenAI
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Jawab singkat, jelas, dan santai.'
        },
        {
          role: 'user',
          content: text
        }
      ]
    });

    const reply = res.choices?.[0]?.message?.content || '❌ Tidak ada respon';

    // hapus loading (opsional)
    try {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    } catch (e) {}

    // kirim jawaban
    await bot.sendMessage(chatId, reply);

  } catch (err) {
    console.error('ERROR:', err.message);

    try {
      bot.sendMessage(msg.chat.id, '❌ Terjadi error, coba lagi');
    } catch (e) {}
  }
});
