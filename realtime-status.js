// realtime-status.js
// 開店状況をJSTで判定して表示（アイコンなし・テキストのみ）
const JSON_URL = './opening-hours.json';
const REFRESH_MS = 30000; // 30秒ごとに再判定

// ---- helpers ----
const toHMnum = (hm) => Number(String(hm).replace(':',''));
const fmtHM = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

// "HHMM" "HH:MM" number などを "HH:MM" にそろえる
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

// v1/v0 どちらの形でも HHMM を取り出す
function getHHMMfromNode(node) {
  if (!node) return null;
  // v0: { time: "1100" }
  if (typeof node.time === 'string' && node.time.length >= 3) return node.time;
  // v1: { hour, minute } or { hours, minutes }
  const h = node.hour ?? node.hours;
  const m = node.minute ?? node.minutes ?? 0;
  if (Number.isInteger(h)) return `${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}`;
  // v1: { startTime: "11:00" } / { endTime: "14:30" }
  if (typeof node.startTime === 'string') return node.startTime.replace(':','');
  if (typeof node.endTime   === 'string') return node.endTime.replace(':','');
  // 文字列 "11:00"
  if (typeof node === 'string') return node.replace(':','');
  // number 1100
  if (typeof node === 'number') return String(node);
  return null;
}

// periods → 指定曜日(0:日〜6:土)のスロット抽出（深夜跨ぎも吸収）
function extractDaySlots(periods = [], gday) {
  const slots = [];
  for (const p of periods) {
    let oDay = p.openDay, cDay = p.closeDay;
    let oHHMM = null,     cHHMM = null;

    if (p.openTime || p.closeTime) {
      oHHMM = getHHMMfromNode(p.openTime);
      cHHMM = getHHMMfromNode(p.closeTime);
    }
    const o = p.open ?? p.opens ?? p.start ?? p;
    const c = p.close ?? p.closes ?? p.end   ?? p;
    if (oDay === undefined) oDay = o?.day ?? o?.openDay ?? p?.day;
    if (cDay === undefined) cDay = c?.day ?? c?.closeDay ?? p?.day;
    if (!oHHMM) oHHMM = getHHMMfromNode(o);
    if (!cHHMM) cHHMM = getHHMMfromNode(c);

    if (typeof oDay !== 'number' || typeof cDay !== 'number' || !oHHMM || !cHHMM) continue;

    const oTime = hmPretty(oHHMM);
    const cTime = hmPretty(cHHMM);

    if (oDay === gday && cDay === gday) {
      slots.push({ start: oTime, end: cTime });
      continue;
    }
    if (oDay === gday && cDay === ((gday + 1) % 7)) {
      slots.push({ start: oTime, end: '23:59' });
      continue;
    }
    const prev = (gday + 6) % 7;
    if (oDay === prev && cDay === gday) {
      slots.push({ start: '00:00', end: cTime });
      continue;
    }
  }
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

// 状態判定
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

// ★ ここがポイント：today/tomorrow のスロットを“最優先”で使い、なければ periods から起こす
function normalize(json) {
  const offset = json?.utcOffsetMinutes ?? 540; // JST
  const jstNow = nowInJST(offset);
  const gToday = jstNow.getDay();
  const gTomorrow = (gToday + 1) % 7;

  // まずは JSON に既にあるスロットを使う
  const todaySlotsFromJson    = json?.today?.slots ?? [];
  const tomorrowSlotsFromJson = json?.tomorrow?.slots ?? [];

  // フォールバック：periods から再計算
  const periods =
    json?.regularOpeningHours?.periods ||
    json?.currentOpeningHours?.periods ||
    json?.result?.opening_hours?.periods || [];

  const todaySlotsCalc    = extractDaySlots(periods, gToday);
  const tomorrowSlotsCalc = extractDaySlots(periods, gTomorrow);

  const todaySlots    = todaySlotsFromJson.length    ? todaySlotsFromJson    : todaySlotsCalc;
  const tomorrowSlots = tomorrowSlotsFromJson.length ? tomorrowSlotsFromJson : tomorrowSlotsCalc;

  return {
    utcOffsetMinutes: offset,
    today:    { gDay:gToday,    slots:todaySlots,    isClosed: todaySlots.length===0 },
    tomorrow:{ gDay:gTomorrow,  slots:tomorrowSlots, isClosed: tomorrowSlots.length===0 },
  };
}

// 描画（営業終了後→「明日の営業時間」、明日が定休日ならその旨を表示）
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
    // 営業終了後は「明日の営業時間」
    if (st.finishedToday) {
      const ts = data?.tomorrow?.slots || [];
      subline = ts.length ? `明日の営業時間　${formatSlots(ts)}` : '明日は定休日です';
    } else {
      subline = `営業時間　${formatSlots(slots)}`;
    }
  } else { // 定休日（そもそも今日が休み）
    headline = '本日は定休日です';
    const ts = data?.tomorrow?.slots || [];
    subline  = ts.length ? `明日の営業時間　${formatSlots(ts)}` : '明日も定休日です';
  }

  statusEl.textContent = headline;
  hoursEl.textContent  = subline;
}

// ---- 起動（キャッシュバスター＆パース失敗ログ付き） ----
async function loadJSON() {
  const url = `${JSON_URL}${JSON_URL.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`opening-hours.json fetch failed: ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('JSON parse error. Response was:\n', text);
    throw e;
  }
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