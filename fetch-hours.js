// fetch-hours.js
import fs from 'fs/promises';
import axios from 'axios';

const PLACE_ID = process.env.PLACE_ID;
const API_KEY  = process.env.PLACES_API_KEY;

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

// 曜日(gday)に一致する営業時間をすべて抽出する
function extractSlots(data, gday) {
  const allPeriods = [
    ...(data?.currentOpeningHours?.periods || []),
    ...(data?.regularOpeningHours?.periods || [])
  ];
  
  const found = [];
  const seen = new Set();

  for (const p of allPeriods) {
    if (p.open && p.open.day === gday) {
      const s = toHHMM(pickHHMM(p.open));
      const e = toHHMM(pickHHMM(p.close));
      if (s && e) {
        const key = `${s}-${e}`;
        if (!seen.has(key)) {
          found.push({ start: s, end: e });
          seen.add(key);
        }
      }
    }
  }
  return found.sort((a, b) => a.start.localeCompare(b.start));
}

const pad2 = n => String(n).padStart(2,'0');
function localDate(offset, baseUtc = new Date()) {
  const utcMs = baseUtc.getTime() + baseUtc.getTimezoneOffset() * 60000;
  return new Date(utcMs + offset * 60000);
}

function statusNow(slots, now) {
  const toNum = s => Number(String(s).replace(':',''));
  const cur = toNum(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
  if (slots.length === 0) return '定休日';
  for (const t of slots) {
    if (toNum(t.start) <= cur && cur < toNum(t.end)) return '営業中';
  }
  return '準備中';
}

(async () => {
  try {
    const url = `https://places.googleapis.com/v1/places/${PLACE_ID}`;
    const { data } = await axios.get(url, {
      params: {
        key: API_KEY,
        languageCode: 'ja',
        fields: 'id,displayName,utcOffsetMinutes,regularOpeningHours.periods,currentOpeningHours.periods',
      }
    });

    const offset   = data?.utcOffsetMinutes ?? 540;
    const localNow = localDate(offset);
    const todayG   = localNow.getDay();
    const tomorrowG = (todayG + 1) % 7;

    const todaySlots = extractSlots(data, todayG);
    const tomorrowSlots = extractSlots(data, tomorrowG);

    const json = {
      fetchedAtLocal: localNow.toISOString(),
      name: data?.displayName?.text || 'そば処 幸山',
      today: { gDay: todayG, slots: todaySlots, statusNow: statusNow(todaySlots, localNow) },
      tomorrow: { gDay: tomorrowG, slots: tomorrowSlots }
    };

    await fs.writeFile('opening-hours.json', JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ Success: All slots fetched.');
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  }
})();