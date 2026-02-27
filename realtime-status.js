// realtime-status.js

const JSON_URL = './opening-hours.json';
const REFRESH_MS = 30000;

const toHMnum = (hm) => Number(String(hm).replace(':',''));
const fmtHM = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

function nowInJST(offset = 540) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + offset * 60000);
}

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

function normalize(json) {
  // すでに fetch-hours.js で店主の設定が反映されているので、そのまま返す
  return {
    utcOffsetMinutes: json.utcOffsetMinutes ?? 540,
    today: json.today,
    tomorrow: json.tomorrow
  };
}

function render(jsonRaw) {
  const statusEl = document.getElementById('status');
  const hoursEl  = document.getElementById('hours');

  if (!jsonRaw) {
    statusEl.textContent = '現在、営業時間を取得できません';
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
      const ts = data.tomorrow.slots || [];
      subline = ts.length ? `明日の営業時間　${formatSlots(ts)}` : '明日は定休日です';
    } else {
      subline = `営業時間　${formatSlots(slots)}`;
    }
  } else {
    headline = '本日は定休日です';
    const ts = data.tomorrow.slots || [];
    subline  = ts.length ? `明日の営業時間　${formatSlots(ts)}` : '明日も定休日です';
  }

  statusEl.textContent = headline;
  hoursEl.textContent  = subline;
}

async function loadJSON() {
  const url = `${JSON_URL}?v=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  return res.json();
}

async function boot() {
  try {
    const json = await loadJSON();
    render(json);
    setInterval(async () => {
      const j = await loadJSON();
      render(j);
    }, REFRESH_MS);
  } catch (e) {
    console.error(e);
  }
}
boot();