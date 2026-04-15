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

    const text = msg.text || msg.caption;

    // 🔒 hanya admin
    if (ADMIN_IDS.length && !ADMIN_IDS.includes(String(userId))) {
      return bot.sendMessage(chatId, '🔒 Bot ini private');
    }

    const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;

    if (!text && !photo) {
      return bot.sendMessage(chatId, '❗ Kirim text atau gambar + pertanyaan');
    }

    // loading
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Lagi mikir...');

    let messages;

    // 🔥 MODE GAMBAR (VISION)
    if (photo) {
      const file = await bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      messages = [
        {
          role: 'system',
          content: `
Kamu adalah ahli size chart pakaian.

TUGAS:
- WAJIB baca tabel ukuran di gambar
- Fokus ke angka (width, length, dll)
- Jangan kasih teori umum

ATURAN:
- Jawaban singkat & langsung
- Sebutkan size paling cocok (XL, XXL, dll)
- Jelaskan singkat pakai data dari tabel
- Jangan ngelantur

Contoh:
"BB 100kg tinggi 170cm cocok XXL karena width 63cm dan length 82cm lebih longgar dan aman."
`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: (text || '') + ' (gunakan data tabel di gambar, jangan asal jawab)'
            },
            {
              type: 'image_url',
              image_url: { url: fileUrl }
            }
          ]
        }
      ];
    } 
    
    // 🔹 MODE TEXT
    else {
      messages = [
        {
          role: 'system',
          content: 'Jawab singkat, jelas, dan langsung ke poin.'
        },
        {
          role: 'user',
          content: text
        }
      ];
    }

    // request ke OpenAI
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages
    });

    const reply = res.choices?.[0]?.message?.content || '❌ Tidak ada respon';

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
