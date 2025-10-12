// realtime-status.js
// Google Business specialOpeningHours（祝日・特別営業）を優先して表示

const JSON_URL = './opening-hours.json';
const REFRESH_MS = 30000; // 30秒ごとに再判定

// ---- helpers ----
const toHMnum = (hm) => Number(String(hm).replace(':',''));
const fmtHM = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
function hmPretty(hhmm = '') {
  if (hhmm == null) return '';
  if (/^\d{2}:\d{2}$/.test(String(hhmm))) return String(hhmm);
  const s = String(hhmm).padStart(4,'0').replace(':','');
  if (/^\d{4}$/.test(s)) return `${s.slice(0,2)}:${s.slice(2,4)}`;
  return '';
}
function nowInJST(offset = 540) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + offset * 60000);
}

// periods → 指定曜日(0:日〜6:土)のスロット抽出
function extractDaySlots(periods = [], gday) {
  const slots = [];
  for (const p of periods) {
    const o = p.open ?? p.opens ?? p.start ?? p;
    const c = p.close ?? p.closes ?? p.end ?? p;
    const oDay = o.day ?? p.openDay ?? p.day;
    const cDay = c.day ?? p.closeDay ?? p.day;
    const oTime = hmPretty(o.time ?? o.startTime);
    const cTime = hmPretty(c.time ?? c.endTime);
    if (oDay == null || cDay == null || !oTime || !cTime) continue;
    if (oDay === gday && cDay === gday) slots.push({ start:oTime, end:cTime });
    if (oDay === gday && cDay === (gday+1)%7) slots.push({ start:oTime, end:'23:59' });
    if ((oDay+1)%7 === gday && cDay === gday) slots.push({ start:'00:00', end:cTime });
  }
  return slots.sort((a,b)=>a.start.localeCompare(b.start));
}

// 状態判定
function calcStatus(slots, jstDate) {
  if (!slots?.length) return { state: '定休日' };
  const cur = toHMnum(fmtHM(jstDate.getHours(), jstDate.getMinutes()));
  for (const s of slots) {
    const st = toHMnum(s.start), ed = toHMnum(s.end);
    if (st <= cur && cur < ed) return { state: '営業中', current: s };
  }
  const starts = slots.map(s=>toHMnum(s.start));
  const ends = slots.map(s=>toHMnum(s.end));
  const nextOpen = starts.find(st=>cur < st);
  if (nextOpen !== undefined) {
    const hadPrev = ends.some(ed=>ed <= cur);
    return { state: hadPrev ? '休憩中' : '準備中', nextOpen };
  }
  return { state: '準備中', finishedToday: true };
}

const formatSlots = (slots=[]) => slots.map(s=>`${s.start}–${s.end}`).join(' / ');

// ✅ specialOpeningHours 優先ロジックを追加
function normalize(json) {
  const offset = json?.utcOffsetMinutes ?? 540;
  const jstNow = nowInJST(offset);
  const todayISO = jstNow.toISOString().split('T')[0];
  const tomorrowISO = new Date(jstNow.getTime()+86400000).toISOString().split('T')[0];

  // 特別営業日（祝日等）を優先
  const specials = json?.specialOpeningHours ?? json?.specialHours ?? [];
  const findSpecial = (iso) => specials.find(s => s.date === iso);

  const specialToday = findSpecial(todayISO);
  const specialTomorrow = findSpecial(tomorrowISO);

  const periods =
    json?.regularOpeningHours?.periods ||
    json?.currentOpeningHours?.periods ||
    json?.result?.opening_hours?.periods || [];

  const gToday = jstNow.getDay();
  const gTomorrow = (gToday + 1) % 7;
  const todaySlots = specialToday ? extractDaySlots(specialToday.periods, gToday) : extractDaySlots(periods, gToday);
  const tomorrowSlots = specialTomorrow ? extractDaySlots(specialTomorrow.periods, gTomorrow) : extractDaySlots(periods, gTomorrow);

  return {
    utcOffsetMinutes: offset,
    today: { gDay:gToday, slots:todaySlots, isClosed: !todaySlots.length },
    tomorrow: { gDay:gTomorrow, slots:tomorrowSlots, isClosed: !tomorrowSlots.length },
  };
}

// 描画
function render(jsonRaw) {
  const statusEl = document.getElementById('status');
  const hoursEl  = document.getElementById('hours');

  if (!jsonRaw) {
    statusEl.textContent = '現在、営業時間を取得できません';
    hoursEl.textContent  = '';
    return;
  }

  const data = normalize(jsonRaw);
  const jstNow = nowInJST(data.utcOffsetMinutes);
  const slots  = data.today.slots || [];
  const st     = calcStatus(slots, jstNow);

  let headline = '';
  let subline  = '';

  if (st.state === '営業中') {
    headline = 'ただいま、営業しております';
    subline  = `営業時間　${formatSlots(slots)}`;
  } else if (st.state === '休憩中') {
    const next = String(st.nextOpen).padStart(4,'0').replace(/(..)(..)/,'$1:$2');
    headline = `ただいま、休憩中です（${next}〜再開）`;
    subline  = `営業時間　${formatSlots(slots)}`;
  } else if (st.state === '準備中') {
    headline = st.finishedToday ? '本日の営業は終了しました' : 'ただいま、準備中です';
    if (st.finishedToday) {
      const ts = data?.tomorrow?.slots || [];
      subline = ts.length ? `明日の営業時間　${formatSlots(ts)}` : '明日は定休日です';
    } else {
      subline = `営業時間　${formatSlots(slots)}`;
    }
  } else {
    headline = '本日は定休日です';
    const ts = data?.tomorrow?.slots || [];
    subline  = ts.length ? `明日の営業時間　${formatSlots(ts)}` : '明日も定休日です';
  }

  statusEl.textContent = headline;
  hoursEl.textContent  = subline;
}

// ---- 起動 ----
async function loadJSON() {
  const url = `${JSON_URL}${JSON_URL.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`opening-hours.json fetch failed: ${res.status}`);
  return res.json();
}

async function boot() {
  try {
    const json = await loadJSON();
    render(json);
    setInterval(async () => {
      try {
        const j = await loadJSON();
        render(j);
      } catch (e) {
        console.error('periodic reload failed:', e);
      }
    }, REFRESH_MS);
  } catch (e) {
    console.error('boot error:', e);
    document.getElementById('status').textContent = '現在、営業時間を取得できません';
    document.getElementById('hours').textContent  = '時間をおいて再読み込みしてください';
  }
}
boot();
