require('dotenv').config();
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ADMIN
const ADMIN_IDS = String(process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// MEMORY
const MEMORY_FILE = './memory.json';
let userMemory = {};

if (fs.existsSync(MEMORY_FILE)) {
  userMemory = JSON.parse(fs.readFileSync(MEMORY_FILE));
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(userMemory, null, 2));
}

// SIZE LOGIC
function recommendSize(weight, height) {
  const sizes = [
    { size: 'S', width: 51, length: 70 },
    { size: 'M', width: 54, length: 73 },
    { size: 'L', width: 57, length: 76 },
    { size: 'XL', width: 60, length: 79 },
    { size: 'XXL', width: 63, length: 82 },
    { size: 'XXXL', width: 65, length: 85 }
  ];

  let targetWidth = weight * 0.6;
  let targetLength = height * 0.45;

  for (let s of sizes) {
    if (s.width >= targetWidth && s.length >= targetLength) {
      return s;
    }
  }

  return sizes[sizes.length - 1];
}

// 🔥 AMBIL CONTEXT TERAKHIR
function getLastContext(userId) {
  if (!userMemory[userId]) return '';
  return userMemory[userId]
    .slice(-3)
    .map(m => m.content)
    .join(' ')
    .toLowerCase();
}

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const textRaw = msg.text || msg.caption || '';
    const text = textRaw.toLowerCase();

    // ADMIN
    if (ADMIN_IDS.length && !ADMIN_IDS.includes(String(userId))) {
      return bot.sendMessage(chatId, '🔒 Bot private');
    }

    // RESET
    if (text === '/start') {
      userMemory[userId] = [];
      saveMemory();
      return bot.sendMessage(chatId, '♻️ Chat direset');
    }

    if (!text) return bot.sendMessage(chatId, '❗ Kirim pesan ya');

    const lastContext = getLastContext(userId);

    // ==================================================
    // 🔥 CONTEXT AWARE HANDLER (FIX UTAMA)
    // ==================================================

    // MODEL / OVERSIZE
    if (text.includes('oversize') || text.includes('boxy') || text.includes('model')) {

      // 👉 kalau sebelumnya bahas size chart
      if (lastContext.includes('size') || lastContext.includes('lebar') || lastContext.includes('width')) {
        return bot.sendMessage(chatId,
          'Dari size chart ini, modelnya cenderung regular fit (normal).\n\n' +
          '👉 Kalau mau oversize, naik 1 size dari ukuran yang direkomendasikan.'
        );
      }

      // 👉 kalau tidak ada konteks
      return bot.sendMessage(chatId,
        'Oversize / boxy itu model lebih longgar dari ukuran normal.\n\n' +
        '👉 Saran:\n' +
        '- Mau pas → pakai size normal\n' +
        '- Mau oversize → naik 1 size'
      );
    }

    // REGULAR
    if (text.includes('regular')) {
      return bot.sendMessage(chatId,
        'Regular fit itu ukuran normal (tidak terlalu ketat & tidak terlalu longgar).\n' +
        '👉 Pakai size sesuai rekomendasi.'
      );
    }

    // ==================================================
    // 🔥 SIZE LOGIC
    // ==================================================
    const match = text.match(/(\d+).*?(\d+)/);

    if (match) {
      let w = parseInt(match[1]);
      let h = parseInt(match[2]);

      if (w > h) [w, h] = [h, w];

      const result = recommendSize(w, h);

      return bot.sendMessage(chatId,
        `BB ${w}kg TB ${h}cm → size ${result.size}\n` +
        `Width ${result.width}cm, Length ${result.length}cm`
      );
    }

    // ==================================================
    // 🧠 MEMORY + AI (fallback)
    // ==================================================
    if (!userMemory[userId]) userMemory[userId] = [];

    userMemory[userId].push({
      role: 'user',
      content: textRaw
    });

    if (userMemory[userId].length > 10) {
      userMemory[userId].shift();
    }

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Kamu admin toko baju. Jawab santai, singkat, dan fokus ke ukuran dan produk.'
        },
        ...userMemory[userId]
      ]
    });

    const reply = res.choices[0].message.content;

    userMemory[userId].push({
      role: 'assistant',
      content: reply
    });

    saveMemory();

    bot.sendMessage(chatId, reply);

  } catch (err) {
    console.log(err);
    bot.sendMessage(msg.chat.id, '❌ Error');
  }
});
