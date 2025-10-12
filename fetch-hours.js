// fetch-hours.js
import fs from 'fs/promises';
import axios from 'axios';

const PLACE_ID = process.env.PLACE_ID;
const API_KEY  = process.env.PLACES_API_KEY;

// HHMMや"HH:MM" -> "HH:MM"
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
  // v1: { hour / hours, minute / minutes }
  const h = node.hour ?? node.hours;
  const m = node.minute ?? node.minutes ?? 0;
  if (Number.isInteger(h)) return `${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}`;
  // v1: { startTime: "11:00" } / { endTime: "14:30" }
  if (typeof node.startTime === 'string') return node.startTime.replace(':','');
  if (typeof node.endTime   === 'string') return node.endTime.replace(':','');
  return null;
}

// periods → 指定曜日のスロット抽出（深夜跨ぎも吸収／v1・v0両対応）
function extractDaySlots(periods = [], gday) {
  const slots = [];
  for (const p of periods) {
    const o = p.open ?? p.opens ?? p.start ?? p;
    const c = p.close ?? p.closes ?? p.end  ?? p;

    const oDay = (o?.day ?? o?.openDay ?? p?.openDay ?? p?.day);
    const cDay = (c?.day ?? c?.closeDay ?? p?.closeDay ?? p?.day);
    const oTimeRaw = getHHMM(o);
    const cTimeRaw = getHHMM(c);

    if (!oTimeRaw || !cTimeRaw || typeof oDay !== 'number' || typeof cDay !== 'number') continue;

    const oTime = hhmmToPretty(oTimeRaw);
    const cTime = hhmmToPretty(cTimeRaw);

    if (oDay === gday && cDay === gday) {
      slots.push({ start: oTime, end: cTime }); continue;
    }
    if (oDay === gday && cDay === ((gday + 1) % 7)) {
      slots.push({ start: oTime, end: '23:59' }); continue;
    }
    const prev = (gday + 6) % 7;
    if (oDay === prev && cDay === gday) {
      slots.push({ start: '00:00', end: cTime }); continue;
    }
  }
  return slots.sort((a,b)=>a.start.localeCompare(b.start));
}

// specialDays → slots
function slotsFromSpecialDay(specialDay) {
  const arr = specialDay?.openIntervals || [];
  return arr.map(iv => {
    const sh = iv.start?.hours ?? iv.start?.hour ?? 0;
    const sm = iv.start?.minutes ?? iv.start?.minute ?? 0;
    const eh = iv.end?.hours   ?? iv.end?.hour   ?? 0;
    const em = iv.end?.minutes ?? iv.end?.minute ?? 0;
    return {
      start: `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`,
      end:   `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`
    };
  });
}

// 現地（utcOffsetMinutes）での today/tomorrow を作る
const pad2 = (n)=>String(n).padStart(2,'0');
const ymd = (d)=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
function localDate(utcOffsetMinutes, baseUtc = new Date()) {
  const utcMs = baseUtc.getTime() + baseUtc.getTimezoneOffset() * 60000;
  return new Date(utcMs + utcOffsetMinutes * 60000);
}

function statusNow(slots, localNow) {
  const toNum = (s) => Number(String(s).replace(':',''));
  const cur = toNum(`${pad2(localNow.getHours())}:${pad2(localNow.getMinutes())}`);
  for (const s of slots) {
    const st = toNum(s.start), ed = toNum(s.end);
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
      // ★ specialDays を追加
      fields: [
        'id',
        'displayName',
        'utcOffsetMinutes',
        'regularOpeningHours.periods',
        'currentOpeningHours.periods',
        'currentOpeningHours.specialDays'
      ].join(','),
    };

    const { data } = await axios.get(url, { params, timeout: 15000 });

    const utcOffset = data?.utcOffsetMinutes ?? 540;
    const localNow  = localDate(utcOffset);
    const todayG    = localNow.getDay();
    const tomorrow  = new Date(localNow.getTime() + 24*60*60*1000);
    const tomorrowG = tomorrow.getDay();

    const todayStr    = ymd(localNow);
    const tomorrowStr = ymd(tomorrow);

    // weekly
    const periods =
      data?.regularOpeningHours?.periods ||
      data?.currentOpeningHours?.periods  ||
      data?.result?.opening_hours?.periods ||
      [];

    // special（v1）
    const specialDays = data?.currentOpeningHours?.specialDays || [];
    const sdToday    = specialDays.find(d => d.date === todayStr);
    const sdTomorrow = specialDays.find(d => d.date === tomorrowStr);

    // まず週次で計算 -> special があれば上書き（最優先）
    let todaySlots    = extractDaySlots(periods, todayG);
    let tomorrowSlots = extractDaySlots(periods, tomorrowG);
    if (sdToday)    todaySlots    = slotsFromSpecialDay(sdToday);      // 空 = 休業
    if (sdTomorrow) tomorrowSlots = slotsFromSpecialDay(sdTomorrow);  // 空 = 休業

    // デバッグ（Actionsログ）
    console.log('specialDays today/tomorrow:',
      sdToday?.date || null, sdTomorrow?.date || null,
      'todaySlots', todaySlots, 'tomorrowSlots', tomorrowSlots
    );

    const json = {
      fetchedAtUTC: new Date().toISOString(),
      fetchedAtJST: localNow.toISOString().replace('Z', '+09:00'),
      placeId: PLACE_ID,
      name: data?.displayName?.text || 'そば処 幸山',
      utcOffsetMinutes: utcOffset,
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
      },
      // 旧形式バックアップ
      result: { opening_hours: { periods } }
    };

    await fs.writeFile('opening-hours.json', JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ opening-hours.json updated');
  } catch (e) {
    console.error('❌ Failed to fetch hours:', e?.response?.data || e?.message || e);
    process.exitCode = 1;
  }
})();