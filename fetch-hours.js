import fs from 'fs/promises';
import axios from 'axios';

const PLACE_ID = process.env.PLACE_ID;
const API_KEY  = process.env.PLACES_API_KEY;

// JST
const jstOffset = 9 * 60;
function dateInJST(d = new Date()) {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + jstOffset * 60000);
}
const jstNow = dateInJST();
const todayG = jstNow.getDay();
const tomorrowG = (todayG + 1) % 7;

const hhmmToPretty = (hhmm) => {
  if (!hhmm) return '';
  const s = String(hhmm).replace(':', '');
  return `${s.slice(0,2)}:${s.slice(2,4)}`;
};

// v1/v0 どちらの形でも HHMM を取り出す
function getHHMM(node) {
  if (!node) return null;
  // v0: { time: "1100" }
  if (typeof node.time === 'string' && node.time.length >= 3) return node.time;
  // v1: { hour: 11, minute: 0 } or { hours: 11, minutes: 0 }
  const h = node.hour ?? node.hours;
  const m = node.minute ?? node.minutes ?? 0;
  if (Number.isInteger(h)) {
    return `${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}`;
  }
  // v1: { startTime: "11:00" } / { endTime: "14:30" }
  if (typeof node.startTime === 'string') return node.startTime.replace(':','');
  if (typeof node.endTime === 'string')   return node.endTime.replace(':','');
  return null;
}

// periods → 指定曜日のスロット抽出（深夜跨ぎも吸収）
function extractDaySlots(periods = [], gday) {
  const slots = [];
  for (const p of periods) {
    // v1/v0 両対応で open/close を読む
    const o = p.open ?? p.opens ?? p.start ?? p;
    const c = p.close ?? p.closes ?? p.end   ?? p;

    const oDay = (o?.day ?? o?.openDay ?? p?.openDay ?? p?.day);
    const cDay = (c?.day ?? c?.closeDay ?? p?.closeDay ?? p?.day);
    const oTimeRaw = getHHMM(o);
    const cTimeRaw = getHHMM(c);

    // 片方でも欠けてたらスキップ（ここで undefined 由来の落ちを防止）
    if (!oTimeRaw || !cTimeRaw || typeof oDay !== 'number' || typeof cDay !== 'number') continue;

    const oTime = hhmmToPretty(oTimeRaw);
    const cTime = hhmmToPretty(cTimeRaw);

    // 同日
    if (oDay === gday && cDay === gday) {
      slots.push({ start: oTime, end: cTime });
      continue;
    }
    // 当日→翌日
    if (oDay === gday && cDay === ((gday + 1) % 7)) {
      slots.push({ start: oTime, end: '23:59' });
      continue;
    }
    // 前日→当日（0時台クローズ）
    const prev = (gday + 6) % 7;
    if (oDay === prev && cDay === gday) {
      slots.push({ start: '00:00', end: cTime });
      continue;
    }
  }
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

function statusNow(slots, jstDate) {
  const toNum = (s) => Number(String(s).replace(':',''));
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

    // v1/v0 どちらでも periods を拾う
    const periods =
      data?.regularOpeningHours?.periods ||
      data?.currentOpeningHours?.periods  ||
      data?.result?.opening_hours?.periods ||
      [];

    // 形を軽くログ（失敗調査用） ※Actions のログに出るだけ
    console.log('periods sample:', JSON.stringify(periods?.[0] ?? {}, null, 2));

    const todaySlots = extractDaySlots(periods, todayG);
    const tomorrowSlots = extractDaySlots(periods, tomorrowG);

    const json = {
      fetchedAtUTC: new Date().toISOString(),
      fetchedAtJST: jstNow.toISOString().replace('Z', '+09:00'),
      placeId: PLACE_ID,
      name: data?.displayName?.text || 'そば処 幸山',
      utcOffsetMinutes: data?.utcOffsetMinutes ?? 540,
      // 互換フォーマット（realtime-status.js はこの today/tomorrow を読む）
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
      },
      // v0 互換も残す（万一のバックアップ）
      result: {
        opening_hours: {
          periods: periods
        }
      }
    };

    await fs.writeFile('opening-hours.json', JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ opening-hours.json updated');
  } catch (e) {
    console.error('❌ Failed to fetch hours:', e?.response?.data || e?.message || e);
    process.exitCode = 1;
  }
})();