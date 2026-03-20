
// fetch-hours.js
import fs from 'fs/promises';
import axios from 'axios';

const PLACE_ID = process.env.PLACE_ID;
const API_KEY  = process.env.PLACES_API_KEY;

/* ---------- helpers ---------- */

const toHHMM = (v) => {
  if (v == null) return '';
  const s = String(v).replace(':','').padStart(4,'0');
  return `${s.slice(0,2)}:${s.slice(2,4)}`;
};

function pickHHMM(node) {
  if (!node) return null;
  if (typeof node.time === 'string' && node.time.length >= 3) return node.time;
  const h = node.hour ?? node.hours;
  const m = node.minute ?? node.minutes ?? 0;
  if (Number.isInteger(h)) return `${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}`;
  return null;
}

// Googleから届いた「期間(periods)」の中から、指定された曜日のものをすべて抜き出す関数
function getSlotsByDay(periods, gday) {
  const slots = [];
  for (const p of periods) {
    const o = p.open;
    const c = p.close;
    // 曜日が一致するかチェック (0:日, 1:月...6:土)
    if (o && o.day === gday) {
      const sRaw = pickHHMM(o);
      const cRaw = pickHHMM(c);
      if (sRaw && cRaw) {
        slots.push({ start: toHHMM(sRaw), end: toHHMM(cRaw) });
      }
    }
  }
  // 時間順に並べて、二部制なら2つ入った状態で返す
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

const pad2 = n => String(n).padStart(2,'0');
const ymd  = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

function localDate(utcOffsetMinutes, baseUtc = new Date()) {
  const utcMs = baseUtc.getTime() + baseUtc.getTimezoneOffset() * 60000;
  return new Date(utcMs + utcOffsetMinutes * 60000);
}

function statusNow(slots, now) {
  const toNum = s => Number(String(s).replace(':',''));
  const cur = toNum(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
  if (slots.length === 0) return '定休日';
  for (const t of slots) {
    const s = toNum(t.start), e = toNum(t.end);
    if (s <= cur && cur < e) return '営業中';
  }
  return '準備中';
}

/* ---------- main ---------- */
(async () => {
  try {
    const url = `https://places.googleapis.com/v1/places/${PLACE_ID}`;
    const params = {
      key: API_KEY,
      languageCode: 'ja',
      regionCode: 'JP',
      fields: [
        'id',
        'displayName',
        'utcOffsetMinutes',
        'regularOpeningHours.periods',
        'currentOpeningHours.periods'
      ].join(','),
    };

    const { data } = await axios.get(url, { params, timeout: 15000 });

    const offset   = data?.utcOffsetMinutes ?? 540;
    const localNow = localDate(offset);
    const todayG   = localNow.getDay();
    const tomorrow = new Date(localNow.getTime() + 24*60*60*1000);
    const tomorrowG= tomorrow.getDay();

    // ★重要：まず「特別（Current）」を見て、なければ「通常（Regular）」を見る
    // Googleの二部制データ（periods）をそのまま使う
    const periods = 
      data?.currentOpeningHours?.periods || 
      data?.regularOpeningHours?.periods || [];

    // 今日のスロットと明日のスロットを抽出（二部制なら2つ入る）
    const todaySlots    = getSlotsByDay(periods, todayG);
    const tomorrowSlots = getSlotsByDay(periods, tomorrowG);

    const json = {
      fetchedAtUTC: new Date().toISOString(),
      fetchedAtLocal: localNow.toISOString(),
      placeId: PLACE_ID,
      name: data?.displayName?.text || 'そば処 幸山',
      utcOffsetMinutes: offset,
      today: {
        gDay: todayG,
        slots: todaySlots,
        statusNow: statusNow(todaySlots, localNow),
        isClosed: todaySlots.length === 0,
      },
      tomorrow: {
        gDay: tomorrowG,
        slots: tomorrowSlots,
        isClosed: tomorrowSlots.length === 0,
      }
    };

    await fs.writeFile('opening-hours.json', JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ opening-hours.json updated with all slots');
  } catch (e) {
    console.error('❌ Failed to fetch hours:', e?.response?.data || e?.message || e);
    process.exitCode = 1;
  }
})();