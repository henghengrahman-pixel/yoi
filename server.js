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
let store = {};

if (fs.existsSync(MEMORY_FILE)) {
  try {
    store = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    store = {};
  }
}

function saveStore() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2));
}

function ensureUser(userId) {
  if (!store[userId]) {
    store[userId] = {
      messages: [],
      lastChart: null,
      lastChartSource: null
    };
  }
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/,/g, '.')
    .trim();
}

function parseChartFromText(text) {
  const raw = normalizeText(text);
  if (!raw) return null;

  const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);

  const chart = {
    S: null,
    M: null,
    L: null,
    XL: null,
    XXL: null,
    XXXL: null
  };

  for (const line of lines) {
    const lower = line.toLowerCase();

    let key = null;
    if (/size\s*s\b/i.test(lower)) key = 'S';
    else if (/size\s*m\b/i.test(lower)) key = 'M';
    else if (/size\s*l\b/i.test(lower)) key = 'L';
    else if (/size\s*xl\b/i.test(lower)) key = 'XL';
    else if (/size\s*xxl\b/i.test(lower)) key = 'XXL';
    else if (/size\s*xxxl\b/i.test(lower)) key = 'XXXL';

    if (!key) continue;

    const widthMatch = lower.match(/(?:lebar dada|width)[^\d]{0,20}(\d+(?:\.\d+)?)/i);
    if (widthMatch) {
      chart[key] = Number(widthMatch[1]);
    }
  }

  const hasAny = Object.values(chart).some((v) => typeof v === 'number' && !Number.isNaN(v));
  return hasAny ? chart : null;
}

async function parseChartFromImage(fileUrl, note = '') {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
Kamu membaca size chart pakaian dari gambar.

Tugas:
- Ambil WIDTH / lebar dada tiap size jika terlihat jelas.
- Jangan menebak kalau tidak jelas.
- Kalau tidak jelas, isi null.
- Tentukan fit_type berdasarkan width size S:
  - S >= 56 => "oversize"
  - S 54-55.99 => "semi-oversize"
  - S < 54 => "regular"

Balas HANYA JSON valid:
{
  "chart_found": true,
  "fit_type": "oversize",
  "reason": "size S width 57 cm",
  "sizes": {
    "S": 57,
    "M": 59,
    "L": 61,
    "XL": 62,
    "XXL": null,
    "XXXL": null
  }
}
`
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: note || 'Baca size chart pada gambar ini dan ambil ukuran width/lebar dada tiap size.'
          },
          {
            type: 'image_url',
            image_url: { url: fileUrl }
          }
        ]
      }
    ]
  });

  try {
    return JSON.parse(res.choices?.[0]?.message?.content || '{}');
  } catch {
    return null;
  }
}

function detectFitType(chart) {
  if (!chart || !chart.S) return null;
  if (chart.S >= 56) return 'oversize';
  if (chart.S >= 54) return 'semi-oversize';
  return 'regular';
}

function fitLabel(fitType) {
  if (fitType === 'oversize') return 'oversize / loose fit';
  if (fitType === 'semi-oversize') return 'semi-oversize';
  if (fitType === 'regular') return 'regular fit';
  return 'tidak diketahui';
}

function extractWeightHeight(text) {
  const nums = normalizeText(text).toLowerCase().match(/\d+/g);
  if (!nums || nums.length < 2) return null;

  let a = parseInt(nums[0], 10);
  let b = parseInt(nums[1], 10);

  let weight = a;
  let height = b;

  if (a > b) {
    weight = b;
    height = a;
  }

  if (weight < 20 || weight > 250) return null;
  if (height < 100 || height > 250) return null;

  return { weight, height };
}

function looksLikeChartText(text) {
  const t = normalizeText(text).toLowerCase();
  return (
    t.includes('size chart') ||
    t.includes('size charts') ||
    t.includes('size s:') ||
    t.includes('size m:') ||
    t.includes('size l:') ||
    t.includes('size xl:') ||
    t.includes('lebar dada') ||
    t.includes('width')
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

function recommendSize(weight, height, chart) {
  const sizes = [
    { size: 'S', width: chart?.S },
    { size: 'M', width: chart?.M },
    { size: 'L', width: chart?.L },
    { size: 'XL', width: chart?.XL },
    { size: 'XXL', width: chart?.XXL },
    { size: 'XXXL', width: chart?.XXXL }
  ].filter((x) => typeof x.width === 'number');

  if (!sizes.length) return null;

  let targetIndex = 0;

  if (weight <= 55) targetIndex = 0;
  else if (weight <= 65) targetIndex = 1;
  else if (weight <= 75) targetIndex = 2;
  else if (weight <= 90) targetIndex = 3;
  else if (weight <= 105) targetIndex = 4;
  else targetIndex = 5;

  if (targetIndex > sizes.length - 1) targetIndex = sizes.length - 1;

  if (height >= 175 && targetIndex < sizes.length - 1) {
    targetIndex += 1;
  }

  return sizes[targetIndex] || sizes[sizes.length - 1];
}

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id || '');
    const textRaw = normalizeText(msg.text || msg.caption || '');
    const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;

    if (ADMIN_IDS.length && !ADMIN_IDS.includes(userId)) {
      return bot.sendMessage(chatId, '🔒 Bot private');
    }

    ensureUser(userId);

    if (textRaw.toLowerCase() === '/start') {
      store[userId] = {
        messages: [],
        lastChart: null,
        lastChartSource: null
      };
      saveStore();
      return bot.sendMessage(chatId, '♻️ Chat direset');
    }

    if (!textRaw && !photo) {
      return bot.sendMessage(chatId, '❗ Kirim teks atau gambar size chart');
    }

    const loading = await bot.sendMessage(chatId, '⏳ Lagi proses...');

    let parsedChart = null;

    // 1) Chart dari teks
    if (textRaw && looksLikeChartText(textRaw)) {
      parsedChart = parseChartFromText(textRaw);
    }

    // 2) Chart dari gambar
    if (!parsedChart && photo) {
      const file = await bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const imageResult = await parseChartFromImage(fileUrl, textRaw);

      if (imageResult?.chart_found && imageResult?.sizes) {
        parsedChart = imageResult.sizes;
      }
    }

    // simpan chart kalau berhasil kebaca
    if (parsedChart) {
      store[userId].lastChart = parsedChart;
      store[userId].lastChartSource = textRaw || '[image chart]';
      saveStore();
    }

    const chart = store[userId].lastChart;
    const fitType = detectFitType(chart);

    // 3) tanya fit
    if (asksFitQuestion(textRaw)) {
      try { await bot.deleteMessage(chatId, loading.message_id); } catch {}

      if (!chart) {
        return bot.sendMessage(chatId, '❌ Size chart belum kebaca. Kirim ulang chart yang lebih jelas atau tulis chart dalam teks.');
      }

      return bot.sendMessage(
        chatId,
        `Dari size chart ini, modelnya cenderung ${fitLabel(fitType)}.` +
        (chart?.S ? ` Size S lebarnya ${chart.S} cm.` : '')
      );
    }

    // 4) tanya BB/TB
    const wh = extractWeightHeight(textRaw);
    if (wh) {
      try { await bot.deleteMessage(chatId, loading.message_id); } catch {}

      if (!chart) {
        return bot.sendMessage(chatId, '❌ Saya belum punya size chart yang valid. Kirim chart dulu ya, teks atau gambar.');
      }

      const sizeResult = recommendSize(wh.weight, wh.height, chart);

      if (!sizeResult) {
        return bot.sendMessage(chatId, '❌ Size chart kebaca, tapi data ukurannya belum cukup.');
      }

      return bot.sendMessage(
        chatId,
        `BB ${wh.weight}kg TB ${wh.height}cm → cocok size ${sizeResult.size}\n` +
        `Lebar dada size ${sizeResult.size}: ${sizeResult.width} cm\n` +
        `Catatan: chart ini cenderung ${fitLabel(fitType)}.`
      );
    }

    // 5) user cuma kirim chart
    if (parsedChart) {
      try { await bot.deleteMessage(chatId, loading.message_id); } catch {}

      return bot.sendMessage(
        chatId,
        `✅ Size chart berhasil dibaca dan disimpan.\n` +
        `Fit: ${fitLabel(fitType)}\n` +
        `Data: ${Object.entries(parsedChart)
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => `${k}:${v}`)
          .join(', ')}`
      );
    }

    // 6) fallback AI
    store[userId].messages.push({
      role: 'user',
      content: textRaw || '[image]'
    });

    if (store[userId].messages.length > 12) {
      store[userId].messages.shift();
    }

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Kamu admin toko baju. Jawab singkat, santai, fokus ke ukuran, fit baju, dan size chart.'
        },
        ...store[userId].messages
      ]
    });

    const reply = res.choices?.[0]?.message?.content || '❌ Tidak ada respon';

    store[userId].messages.push({
      role: 'assistant',
      content: reply
    });
    saveStore();

    try { await bot.deleteMessage(chatId, loading.message_id); } catch {}
    await bot.sendMessage(chatId, reply);

  } catch (err) {
    console.log(err);
    try {
      await bot.sendMessage(msg.chat.id, '❌ Error');
    } catch {}
  }
});
