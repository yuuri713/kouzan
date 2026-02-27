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
  if (typeof node.startTime === 'string') return node.startTime.replace(':','');
  if (typeof node.endTime   === 'string') return node.endTime.replace(':','');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return null;
}

function slotsFromWeekly(periods = [], gday) {
  const slots = [];
  for (const p of periods) {
    const o = p.open  ?? p.opens  ?? p.start ?? p;
    const c = p.close ?? p.closes ?? p.end   ?? p;
    const oDay = (o?.day ?? o?.openDay  ?? p?.openDay  ?? p?.day);
    const cDay = (c?.day ?? c?.closeDay ?? p?.closeDay ?? p?.day);
    const oRaw = pickHHMM(o);
    const cRaw = pickHHMM(c);
    if (!oRaw || !cRaw || typeof oDay !== 'number' || typeof cDay !== 'number') continue;
    const oTime = toHHMM(oRaw);
    const cTime = toHHMM(cRaw);
    if (oDay === gday && cDay === gday) {
      slots.push({ start:oTime, end:cTime }); continue;
    }
    if (oDay === gday && cDay === ((gday + 1) % 7)) {
      slots.push({ start:oTime, end:'23:59' }); continue;
    }
    const prev = (gday + 6) % 7;
    if (oDay === prev && cDay === gday) {
      slots.push({ start:'00:00', end:cTime }); continue;
    }
  }
  return slots.sort((a,b)=>a.start.localeCompare(b.start));
}

function slotsFromSpecialDay(sd) {
  if (!sd) return [];
  if (Array.isArray(sd.openIntervals)) {
    return sd.openIntervals.map(iv => {
      const sh = iv.start?.hours ?? iv.start?.hour ?? 0;
      const sm = iv.start?.minutes ?? iv.start?.minute ?? 0;
      const eh = iv.end?.hours   ?? iv.end?.hour   ?? 0;
      const em = iv.end?.minutes ?? iv.end?.minute ?? 0;
      return {
        start: `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`,
        end:   `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`,
      };
    }).sort((a,b)=>a.start.localeCompare(b.start));
  }
  const anyPeriods = sd.periods || sd.specialHourPeriods || sd.intervals || [];
  if (Array.isArray(anyPeriods) && anyPeriods.length) {
    const coerce = (n) => {
      const s = pickHHMM(n);
      return s ? toHHMM(s) : '';
    };
    return anyPeriods
      .map(p => {
        const s = coerce(p.openTime ?? p.open ?? p.start);
        const e = coerce(p.closeTime ?? p.close ?? p.end);
        return (s && e) ? { start:s, end:e } : null;
      })
      .filter(Boolean)
      .sort((a,b)=>a.start.localeCompare(b.start));
  }
  return [];
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
        'currentOpeningHours.periods',
        'currentOpeningHours.specialDays'
      ].join(','),
    };

    const { data } = await axios.get(url, { params, timeout: 15000 });

    const offset   = data?.utcOffsetMinutes ?? 540;
    const localNow = localDate(offset);
    const todayG   = localNow.getDay();
    const tomorrow = new Date(localNow.getTime() + 24*60*60*1000);
    const tomorrowG= tomorrow.getDay();

    const todayStr    = ymd(localNow);
    const tomorrowStr = ymd(tomorrow);

    const periods =
      data?.regularOpeningHours?.periods ||
      data?.currentOpeningHours?.periods  || [];

    const specialDays = data?.currentOpeningHours?.specialDays || [];
    const sdToday     = specialDays.find(d => d.date === todayStr);
    const sdTomorrow  = specialDays.find(d => d.date === tomorrowStr);

    // 基本は通常営業
    let todaySlots    = slotsFromWeekly(periods, todayG);
    let tomorrowSlots = slotsFromWeekly(periods, tomorrowG);

    // ★店主の特別設定（祝日・臨時設定）があれば完全に上書き
    if (sdToday) {
      todaySlots = slotsFromSpecialDay(sdToday);
    }
    if (sdTomorrow) {
      tomorrowSlots = slotsFromSpecialDay(sdTomorrow);
    }

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
    console.log('✅ opening-hours.json updated');
  } catch (e) {
    console.error('❌ Failed to fetch hours:', e?.response?.data || e?.message || e);
    process.exitCode = 1;
  }
})();