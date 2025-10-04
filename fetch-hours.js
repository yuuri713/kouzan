import fs from 'fs/promises';
import axios from 'axios';

const PLACE_ID = process.env.PLACE_ID;
const API_KEY  = process.env.PLACES_API_KEY;

// JST日付計算
const now = new Date();
const jstOffset = 9 * 60;
function dateInJST(d = new Date()) {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + jstOffset * 60000);
}
const jstNow = dateInJST(now);
const todayG = jstNow.getDay();
const tomorrowG = (todayG + 1) % 7;
const hhmmToPretty = (hhmm) => `${hhmm.slice(0,2)}:${hhmm.slice(2,4)}`;

function extractDaySlots(periods = [], gday) {
  const slots = [];
  for (const p of periods) {
    if (!p.open || !p.close) continue;
    const o = p.open;
    const c = p.close;
    if (o.day === gday && c.day === gday) {
      slots.push({ start: hhmmToPretty(o.time), end: hhmmToPretty(c.time) });
      continue;
    }
    if (o.day === gday && c.day === ((gday + 1) % 7)) {
      slots.push({ start: hhmmToPretty(o.time), end: '23:59' });
      continue;
    }
    const prev = (gday + 6) % 7;
    if (o.day === prev && c.day === gday) {
      slots.push({ start: '00:00', end: hhmmToPretty(c.time) });
      continue;
    }
  }
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

function statusNow(slots, jstDate) {
  const toNum = (s) => Number(s.replace(':',''));
  const cur = toNum(`${String(jstDate.getHours()).padStart(2,'0')}:${String(jstDate.getMinutes()).padStart(2,'0')}`);
  for (const s of slots) {
    const st = toNum(s.start);
    const ed = toNum(s.end);
    if (st <= cur && cur < ed) return '営業中';
  }
  return '準備中';
}

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

    const { data } = await axios.get(url, { params, timeout: 10000 });
    const periods = data?.regularOpeningHours?.periods || data?.currentOpeningHours?.periods || [];
    const todaySlots = extractDaySlots(periods, todayG);
    const tomorrowSlots = extractDaySlots(periods, tomorrowG);

    const json = {
      fetchedAtUTC: new Date().toISOString(),
      fetchedAtJST: jstNow.toISOString().replace('Z', '+09:00'),
      placeId: PLACE_ID,
      name: data?.displayName?.text || 'そば処 幸山',
      utcOffsetMinutes: data?.utcOffsetMinutes ?? 540,
      today: {
        gDay: todayG,
        slots: todaySlots,
        statusNow: statusNow(todaySlots, jstNow),
        isClosed: todaySlots.length === 0,
      },
      tomorrow: {
        gDay: tomorrowG,
        slots: tomorrowSlots,
        isClosed: tomorrowSlots.length === 0,
      }
    };

    await fs.writeFile('opening-hours.json', JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ opening-hours.json updated');
  } catch (e) {
    console.error('❌ Failed to fetch hours:', e?.response?.data || e?.message || e);
    process.exitCode = 1;
  }
})();