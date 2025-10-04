const JSON_URL = './opening-hours.json'; // GitHub Actionsで毎日更新されるJSON
const REFRESH_MS = 30000;                // 30秒ごとに再判定

// JST現在時刻を返す
function nowInJST(offset = 540) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + offset * 60000);
}

// "HH:MM" → 数値(例: 1130)
function hmToNum(hm) {
  return Number(hm.replace(':',''));
}

// ステータス判定
function calcStatus(slots, jstDate) {
  if (!slots?.length) return { state: '定休日' };
  const cur = hmToNum(`${String(jstDate.getHours()).padStart(2, '0')}:${String(jstDate.getMinutes()).padStart(2, '0')}`);
  const starts = slots.map(s => hmToNum(s.start));
  const ends   = slots.map(s => hmToNum(s.end));

  // 営業中判定
  for (const s of slots) {
    const st = hmToNum(s.start);
    const ed = hmToNum(s.end);
    if (st <= cur && cur < ed) return { state: '営業中' };
  }

  // 次の営業枠があるか
  const nextOpen = starts.find(st => cur < st);
  if (nextOpen !== undefined) {
    const hadPrev = ends.some(ed => ed <= cur);
    return { state: hadPrev ? '休憩中' : '準備中', nextOpen };
  }

  // 全枠終了
  return { state: '準備中', finishedToday: true };
}

// スロット整形
function formatSlots(slots) {
  return slots.map(s => `${s.start}–${s.end}`).join(' / ');
}

// 表示更新
function setStatusHTML(json) {
  const statusEl = document.getElementById('status');
  const hoursEl = document.getElementById('hours');

  if (!json?.today) {
    statusEl.textContent = '現在、営業時間を取得できません';
    hoursEl.textContent = '';
    return;
  }

  const jstNow = nowInJST(json.utcOffsetMinutes ?? 540);
  const today = json.today;
  const slots = today.slots || [];
  const st = calcStatus(slots, jstNow);

  let headline = '';
  let subline  = '';

  if (st.state === '営業中') {
    headline = 'ただいま、営業しております ▶︎';
    subline  = `営業時間　${formatSlots(slots)}`;
  } else if (st.state === '休憩中') {
    const next = String(st.nextOpen).padStart(4,'0').replace(/(..)(..)/, '$1:$2');
    headline = `ただいま、休憩中です（${next}〜再開）`;
    subline  = `本日の営業時間　${formatSlots(slots)}`;
  } else if (st.state === '準備中') {
    headline = st.finishedToday
      ? '本日の営業は終了しました'
      : 'ただいま、準備中です';
    subline  = `本日の営業時間　${formatSlots(slots)}`;
  } else if (st.state === '定休日') {
    headline = '本日は定休日です';
    subline  = (json?.tomorrow?.slots?.length ?? 0) > 0
      ? `明日の営業時間　${formatSlots(json.tomorrow.slots)}`
      : '';
  }

  statusEl.textContent = headline;
  hoursEl.textContent = subline;
}

// JSON取得
async function loadJSON() {
  const res = await fetch(JSON_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('opening-hours.json の取得に失敗');
  return res.json();
}

// 初期化
async function init() {
  try {
    const json = await loadJSON();
    setStatusHTML(json);

    // 30秒ごとに再判定
    setInterval(() => setStatusHTML(json), REFRESH_MS);
  } catch (e) {
    console.error(e);
    document.getElementById('status').textContent = '営業時間を取得できませんでした';
    document.getElementById('hours').textContent = '時間をおいて再読み込みしてください';
  }
}

init();