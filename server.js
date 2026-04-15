require('dotenv').config();
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ADMIN_IDS = String(process.env.ADMIN_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const MEMORY_FILE = './memory.json';
let userMemory = {};

if (fs.existsSync(MEMORY_FILE)) {
  try {
    userMemory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    userMemory = {};
  }
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(userMemory, null, 2));
}

function ensureUserMemory(userId) {
  if (!userMemory[userId]) {
    userMemory[userId] = {
      messages: [],
      chartText: '',
      parsedChart: null
    };
  }
}

function parseSizeChart(text) {
  if (!text) return null;

  const normalized = text
    .replace(/,/g, '.')
    .replace(/\r/g, '')
    .toLowerCase();

  const result = {
    S: null,
    M: null,
    L: null,
    XL: null
  };

  const patterns = {
    S: /size\s*s\s*[:\-]?\s.*?(?:lebar dada|width)[^\d]{0,20}(\d+(?:\.\d+)?)/i,
    M: /size\s*m\s*[:\-]?\s.*?(?:lebar dada|width)[^\d]{0,20}(\d+(?:\.\d+)?)/i,
    L: /size\s*l\s*[:\-]?\s.*?(?:lebar dada|width)[^\d]{0,20}(\d+(?:\.\d+)?)/i,
    XL: /size\s*xl\s*[:\-]?\s.*?(?:lebar dada|width)[^\d]{0,20}(\d+(?:\.\d+)?)/i
  };

  for (const key of Object.keys(patterns)) {
    const match = normalized.match(patterns[key]);
    if (match) result[key] = Number(match[1]);
  }

  if (!result.S && !result.M && !result.L && !result.XL) return null;
  return result;
}

function detectFitType(chart) {
  if (!chart || !chart.S) return null;

  // patokan kasar:
  // regular fit umum size S sekitar 48-53
  // kalau S sudah 56+ biasanya loose / oversize
  if (chart.S >= 56) {
    return 'oversize';
  }

  if (chart.S >= 54) {
    return 'semi-oversize';
  }

  return 'regular';
}

function recommendSizeFromCustomChart(weight, height, chart) {
  const sizes = [
    { size: 'S', width: chart?.S || 57 },
    { size: 'M', width: chart?.M || 59 },
    { size: 'L', width: chart?.L || 61 },
    { size: 'XL', width: chart?.XL || 62 }
  ];

  // rumus kasar, lebih aman dari versi lama
  let targetWidth = 0;

  if (weight <= 55) targetWidth = 57;
  else if (weight <= 65) targetWidth = 59;
  else if (weight <= 75) targetWidth = 61;
  else targetWidth = 62;

  if (height >= 175 && targetWidth < 61) {
    targetWidth += 2;
  }

  for (const s of sizes) {
    if (s.width >= targetWidth) return s;
  }

  return sizes[sizes.length - 1];
}

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id || '');
    const textRaw = (msg.text || msg.caption || '').trim();
    const text = textRaw.toLowerCase();

    if (ADMIN_IDS.length && !ADMIN_IDS.includes(userId)) {
      return bot.sendMessage(chatId, '🔒 Bot private');
    }

    ensureUserMemory(userId);

    if (text === '/start') {
      userMemory[userId] = {
        messages: [],
        chartText: '',
        parsedChart: null
      };
      saveMemory();
      return bot.sendMessage(chatId, '♻️ Chat direset');
    }

    if (!textRaw) {
      return bot.sendMessage(chatId, '❗ Kirim pesan ya');
    }

    // simpan size chart kalau user kirim chart
    if (text.includes('size chart') || text.includes('size charts') || text.includes('size s:')) {
      userMemory[userId].chartText = textRaw;
      userMemory[userId].parsedChart = parseSizeChart(textRaw);

      const fitType = detectFitType(userMemory[userId].parsedChart);

      if (fitType === 'oversize') {
        return bot.sendMessage(
          chatId,
          '✅ Size chart disimpan.\nDari lebar size S yang sudah besar, chart ini cenderung oversize / loose fit.'
        );
      }

      if (fitType === 'semi-oversize') {
        return bot.sendMessage(
          chatId,
          '✅ Size chart disimpan.\nChart ini cenderung semi-oversize, tidak slim.'
        );
      }

      return bot.sendMessage(
        chatId,
        '✅ Size chart disimpan.\nChart ini cenderung regular fit.'
      );
    }

    const chart = userMemory[userId].parsedChart;
    const fitType = detectFitType(chart);

    // tanya model / fit
    if (
      text.includes('oversize') ||
      text.includes('boxy') ||
      text.includes('reguler') ||
      text.includes('regular') ||
      text.includes('fit')
    ) {
      if (chart) {
        if (fitType === 'oversize') {
          return bot.sendMessage(
            chatId,
            'Dari chart yang kamu kirim, ini cenderung oversize / loose fit, bukan regular. Soalnya size S saja sudah lebar.'
          );
        }

        if (fitType === 'semi-oversize') {
          return bot.sendMessage(
            chatId,
            'Dari chart ini, modelnya cenderung semi-oversize. Bukan slim / kecil.'
          );
        }

        return bot.sendMessage(
          chatId,
          'Dari chart ini, modelnya cenderung regular fit.'
        );
      }

      return bot.sendMessage(
        chatId,
        'Kalau belum ada size chart, oversize biasanya potongannya lebih longgar dari regular fit.'
      );
    }

    // pertanyaan bb/tb
    const match = text.match(/(\d+).*?(\d+)/);
    if (match) {
      let a = parseInt(match[1], 10);
      let b = parseInt(match[2], 10);

      let weight = a;
      let height = b;

      if (a > b) {
        weight = b;
        height = a;
      }

      const result = recommendSizeFromCustomChart(weight, height, chart);

      let extra = '';
      if (fitType === 'oversize') {
        extra = '\nCatatan: chart ini model oversize / loose fit.';
      } else if (fitType === 'semi-oversize') {
        extra = '\nCatatan: chart ini cenderung semi-oversize.';
      }

      return bot.sendMessage(
        chatId,
        `BB ${weight}kg TB ${height}cm → size ${result.size}\nLebar dada size ${result.size}: ${result.width}cm${extra}`
      );
    }

    // fallback AI
    userMemory[userId].messages.push({
      role: 'user',
      content: textRaw
    });

    if (userMemory[userId].messages.length > 10) {
      userMemory[userId].messages.shift();
    }

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Kamu admin toko baju. Jawab singkat, jelas, santai, dan fokus ke ukuran, fit baju, serta size chart.'
        },
        ...userMemory[userId].messages
      ]
    });

    const reply = res.choices?.[0]?.message?.content || '❌ Tidak ada respon';

    userMemory[userId].messages.push({
      role: 'assistant',
      content: reply
    });

    saveMemory();
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    console.log(err);
    await bot.sendMessage(msg.chat.id, '❌ Error');
  }
});
