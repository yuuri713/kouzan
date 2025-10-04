// opening-hours.json を読み、JSTの現在時刻で「営業中/準備中/休憩中/定休日」を表示
const JSON_URL = './opening-hours.json';
const REFRESH_MS = 30000; // 30秒ごとに再判定

// ---- 時刻ヘルパ ----
const toHMnum = (hm) => Number(hm.replace(':',''));
const hmPretty = (hhmm='') => (hhmm.length===4 ? `${hhmm.slice(0,2)}:${hhmm.slice(2,4)}` : '');
const fmtHM = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

function nowInJST(offset = 540) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + offset * 60000);
}

// ---- periods → 指定曜日(0:日〜6:土)のスロット抽出 ----
function extractDaySlots(periods = [], gday) {
  const slots = [];
  for (const p of periods) {
    if (!p.open || !p.close) continue;
    const o = p.open, c = p.close;
    // 同日内
    if (o.day === gday && c.day === gday) {
      slots.push({ start: hmPretty(o.time), end: hmPretty(c.time) });
      continue;
    }
    // 当日→翌日またぎ（深夜クローズ）
    if (o.day === gday && c.day === ((gday + 1) % 7)) {
      slots.push({ start: hmPretty(o.time), end: '23:59' });
      continue;
    }
    // 前日→当日またぎ（0時台にクローズ）
    const prev = (gday + 6) % 7;
    if (o.day === prev && c.day === gday) {
      slots.push({ start: '00:00', end: hmPretty(c.time) });
      continue;
    }
  }
  return slots.sort((a,b)=>a.start.localeCompare(b.start));
}

// ---- 状態判定 ----
function calcStatus(slots, jstDate) {
  if (!slots?.length) return { state: '定休日' };
  const cur = toHMnum(fmtHM(jstDate.getHours(), jstDate.getMinutes()));

  for (const s of slots) {
    const st = toHMnum(s.start), ed = toHMnum(s.end);
    if (st <= cur && cur < ed) return { state: '営業中', current: s };
  }
  const starts = slots.map(s => toHMnum(s.start));
  const ends   = slots.map(s => toHMnum(s.end));
  const nextOpen = starts.find(st => cur < st);
  if (nextOpen !== undefined) {
    const hadPrev = ends.some(ed => ed <= cur);
    return { state: hadPrev ? '休憩中' : '準備中', nextOpen };
  }
  return { state: '準備中', finishedToday: true };
}

const formatSlots = (slots=[]) => slots.map(s => `${s.start}–${s.end}`).join(' / ');

// ---- JSONの形の違いを吸収して today/tomorrow を作る ----
function normalize(json) {
  // v1系 or v0系の両対応
  const periods =
    json?.regularOpeningHours?.periods ||
    json?.currentOpeningHours?.periods ||
    json?.result?.opening_hours?.periods ||
    [];

  // utcOffsetMinutes がない想定なのでJST=540固定（必要ならfetch側で入れてOK）
  const offset = json?.utcOffsetMinutes ?? 540;
  const jstNow = nowInJST(offset);
  const gToday = jstNow.getDay();          // 0:日〜6:土（Googleも同じ）
  const gTomorrow = (gToday + 1) % 7;

  const todaySlots = extractDaySlots(periods, gToday);
  const tomorrowSlots = extractDaySlots(periods, gTomorrow);

  return {
    utcOffsetMinutes: offset,
    today: {
      gDay: gToday,
      slots: todaySlots,
      isClosed: todaySlots.length === 0,
    },
    tomorrow: {
      gDay: gTomorrow,
      slots: tomorrowSlots,
      isClosed: tomorrowSlots.length === 0,
    }
  };
}

// ---- 描画 ----
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
  const slots = data.today.slots || [];
  const st = calcStatus(slots, jstNow);

  let headline = '';
  let subline  = '';

  if (st.state === '営業中') {
    headline = 'ただいま、営業しております <span class="icon">▶</span>';
    subline  = `営業時間　${formatSlots(slots)}`;
  } else if (st.state === '休憩中') {
    const next = String(st.nextOpen).padStart(4,'0').replace(/(..)(..)/,'$1:$2');
    headline = `ただいま、休憩中です（${next}〜再開）`;
    subline  = `本日の営業時間　${formatSlots(slots)}`;
  } else if (st.state === '準備中') {
    headline = st.finishedToday ? '本日の営業は終了しました' : 'ただいま、準備中です';
    subline  = `本日の営業時間　${formatSlots(slots)}`;
  } else { // 定休日
    headline = '本日は定休日です';
    subline  = (data?.tomorrow?.slots?.length ?? 0) > 0
      ? `明日の営業時間　${formatSlots(data.tomorrow.slots)}`
      : '';
  }

  statusEl.innerHTML = headline;   // ← textContent ではなく innerHTML を使う！
  hoursEl.textContent = subline;
}

// ---- 起動 ----
async function loadJSON() {
  const res = await fetch(JSON_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`opening-hours.json fetch failed: ${res.status}`);
  return res.json();
}

async function boot() {
  try {
    const json = await loadJSON();
    render(json);
    setInterval(() => render(json), REFRESH_MS);
  } catch (e) {
    console.error(e);
    document.getElementById('status').textContent = '現在、営業時間を取得できません';
    document.getElementById('hours').textContent  = '時間をおいて再読み込みしてください';
  }
}

boot();