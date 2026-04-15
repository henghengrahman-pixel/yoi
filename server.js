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

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/,/g, '.')
    .trim();
}

function parseSizeChart(text) {
  const raw = normalizeText(text);
  if (!raw) return null;

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  const chart = {
    S: null,
    M: null,
    L: null,
    XL: null
  };

  for (const line of lines) {
    const lower = line.toLowerCase();

    let key = null;
    if (/size\s*s\b/i.test(lower)) key = 'S';
    else if (/size\s*m\b/i.test(lower)) key = 'M';
    else if (/size\s*l\b/i.test(lower)) key = 'L';
    else if (/size\s*xl\b/i.test(lower)) key = 'XL';

    if (!key) continue;

    const widthMatch = lower.match(/(?:lebar dada|width)[^\d]{0,20}(\d+(?:\.\d+)?)/i);
    if (widthMatch) {
      chart[key] = Number(widthMatch[1]);
    }
  }

  if (!chart.S && !chart.M && !chart.L && !chart.XL) return null;
  return chart;
}

function detectFitType(chart) {
  if (!chart || !chart.S) return null;

  // Patokan sederhana:
  // regular fit S umumnya sekitar 48-53
  // 54-55 cenderung semi loose
  // 56+ sudah oversize / loose
  if (chart.S >= 56) return 'oversize';
  if (chart.S >= 54) return 'semi-oversize';
  return 'regular';
}

function recommendSizeFromChart(weight, height, chart) {
  const widths = [
    { size: 'S', width: chart?.S || 57 },
    { size: 'M', width: chart?.M || 59 },
    { size: 'L', width: chart?.L || 61 },
    { size: 'XL', width: chart?.XL || 62 }
  ];

  let targetWidth;

  if (weight <= 55) targetWidth = widths[0].width;
  else if (weight <= 65) targetWidth = widths[1].width || widths[0].width;
  else if (weight <= 75) targetWidth = widths[2].width || widths[1].width;
  else targetWidth = widths[3].width || widths[2].width;

  if (height >= 175) {
    const idx = widths.findIndex((x) => x.width >= targetWidth);
    if (idx >= 0 && idx < widths.length - 1) {
      return widths[idx + 1];
    }
  }

  for (const item of widths) {
    if (item.width >= targetWidth) return item;
  }

  return widths[widths.length - 1];
}

function looksLikeChartText(text) {
  const t = normalizeText(text).toLowerCase();
  return (
    t.includes('size chart') ||
    t.includes('size charts') ||
    t.includes('size s:') ||
    t.includes('size m:') ||
    t.includes('size l:') ||
    t.includes('size xl:')
  );
}

function asksFitQuestion(text) {
  const t = normalizeText(text).toLowerCase();
  return (
    t.includes('oversize') ||
    t.includes('boxy') ||
    t.includes('regular') ||
    t.includes('reguler') ||
    t.includes('fit')
  );
}

function extractWeightHeight(text) {
  const t = normalizeText(text).toLowerCase();
  const nums = t.match(/\d+/g);
  if (!nums || nums.length < 2) return null;

  let a = parseInt(nums[0], 10);
  let b = parseInt(nums[1], 10);

  // cari mana BB mana TB
  let weight = a;
  let height = b;

  if (a > b) {
    weight = b;
    height = a;
  }

  // validasi sederhana
  if (weight < 20 || weight > 250) return null;
  if (height < 100 || height > 250) return null;

  return { weight, height };
}

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id || '');
    const textRaw = normalizeText(msg.text || msg.caption || '');
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

    // 1) simpan chart kalau ada
    const chartFound = looksLikeChartText(textRaw) ? parseSizeChart(textRaw) : null;
    if (chartFound) {
      userMemory[userId].chartText = textRaw;
      userMemory[userId].parsedChart = chartFound;
      saveMemory();
    }

    const chart = userMemory[userId].parsedChart;
    const fitType = detectFitType(chart);

    // 2) kalau dalam pesan yang sama ada pertanyaan fit
    if (asksFitQuestion(textRaw) && chart) {
      if (fitType === 'oversize') {
        return bot.sendMessage(
          chatId,
          'Dari size chart ini, modelnya cenderung oversize / loose fit, bukan regular. Soalnya size S saja sudah lebar 57 cm.'
        );
      }

      if (fitType === 'semi-oversize') {
        return bot.sendMessage(
          chatId,
          'Dari size chart ini, modelnya cenderung semi-oversize, bukan slim fit.'
        );
      }

      return bot.sendMessage(
        chatId,
        'Dari size chart ini, modelnya cenderung regular fit.'
      );
    }

    // 3) kalau ada pertanyaan BB/TB dan chart sudah tersimpan
    const wh = extractWeightHeight(textRaw);
    if (wh && chart) {
      const result = recommendSizeFromChart(wh.weight, wh.height, chart);

      let note = '';
      if (fitType === 'oversize') {
        note = '\nCatatan: chart ini cenderung oversize / loose fit.';
      } else if (fitType === 'semi-oversize') {
        note = '\nCatatan: chart ini cenderung semi-oversize.';
      }

      return bot.sendMessage(
        chatId,
        `BB ${wh.weight}kg TB ${wh.height}cm → cocok size ${result.size}\nLebar dada size ${result.size}: ${result.width}cm${note}`
      );
    }

    // 4) kalau user cuma kirim chart tanpa tanya apa-apa
    if (chartFound && !asksFitQuestion(textRaw) && !wh) {
      if (fitType === 'oversize') {
        return bot.sendMessage(
          chatId,
          '✅ Size chart disimpan.\nChart ini cenderung oversize / loose fit.'
        );
      }

      if (fitType === 'semi-oversize') {
        return bot.sendMessage(
          chatId,
          '✅ Size chart disimpan.\nChart ini cenderung semi-oversize.'
        );
      }

      return bot.sendMessage(
        chatId,
        '✅ Size chart disimpan.\nChart ini cenderung regular fit.'
      );
    }

    // 5) kalau tanya fit tapi chart belum ada
    if (asksFitQuestion(textRaw) && !chart) {
      return bot.sendMessage(
        chatId,
        'Kirim size chart dulu ya, biar saya cek ini oversize, regular fit, atau boxy.'
      );
    }

    // 6) fallback AI
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
