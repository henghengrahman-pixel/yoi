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

// 🧠 MEMORY CHAT
const userMemory = {};

// listener
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    const text = msg.text || msg.caption;

    // 🔒 hanya admin
    if (ADMIN_IDS.length && !ADMIN_IDS.includes(String(userId))) {
      return bot.sendMessage(chatId, '🔒 Bot ini private');
    }

    // 🔥 /start = reset chat
    if (text === '/start') {
      userMemory[userId] = [
        {
          role: 'system',
          content: 'Jawab singkat, jelas, dan nyambung dengan percakapan.'
        }
      ];

      return bot.sendMessage(chatId, '♻️ Percakapan baru dimulai');
    }

    const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;

    if (!text && !photo) {
      return bot.sendMessage(chatId, '❗ Kirim text atau gambar + pertanyaan');
    }

    // ⏳ loading
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Lagi mikir...');

    // 🧠 INIT MEMORY
    if (!userMemory[userId]) {
      userMemory[userId] = [
        {
          role: 'system',
          content: 'Jawab singkat, jelas, dan nyambung dengan percakapan.'
        }
      ];
    }

    let userMessage;

    // 🔥 MODE GAMBAR (VISION)
    if (photo) {
      const file = await bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      userMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: (text || '') + ' (gunakan data tabel di gambar, jawab langsung dan akurat)'
          },
          {
            type: 'image_url',
            image_url: { url: fileUrl }
          }
        ]
      };
    } 
    
    // 🔹 MODE TEXT
    else {
      userMessage = {
        role: 'user',
        content: text
      };
    }

    // simpan ke memory
    userMemory[userId].push(userMessage);

    // batasi memory (biar ringan)
    if (userMemory[userId].length > 12) {
      userMemory[userId].splice(1, 2); // buang chat lama, tapi system tetap
    }

    // request ke OpenAI
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: userMemory[userId]
    });

    const reply = res.choices?.[0]?.message?.content || '❌ Tidak ada respon';

    // simpan jawaban bot
    userMemory[userId].push({
      role: 'assistant',
      content: reply
    });

    // hapus loading
    try {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    } catch (e) {}

    await bot.sendMessage(chatId, reply);

  } catch (err) {
    console.error('ERROR:', err.message);

    try {
      bot.sendMessage(msg.chat.id, '❌ Terjadi error, coba lagi');
    } catch (e) {}
  }
});
