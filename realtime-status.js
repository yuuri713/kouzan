<!-- realtime-status.js -->
<script>
// 開店状況をJSTで判定して表示（Googleの祝日/特別営業時間を最優先）
const JSON_URL   = './opening-hours.json';
const REFRESH_MS = 30000; // 30秒ごとに再判定

// ---------- helpers ----------
const toHMnum = (hm) => Number(String(hm).replace(':',''));
const fmtHM   = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
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
function ymdFromDate(d){ // YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dateAddDaysJST(d, days){
  const nd = new Date(d.getTime());
  nd.setDate(nd.getDate()+days);
  return nd;
}
function nextYMD(ymd){
  const [y,m,d] = ymd.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const nd = dateAddDaysJST(dt, 1);
  return ymdFromDate(nd);
}
function prevYMD(ymd){
  const [y,m,d] = ymd.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const pd = dateAddDaysJST(dt, -1);
  return ymdFromDate(pd);
}

// v1/v0 どちらの形でも HHMM を取り出す
function getHHMMfromNode(node) {
  if (!node) return null;
  if (typeof node.time === 'string' && node.time.length >= 3) return node.time; // v0
  const h = node.hour ?? node.hours;
  const m = node.minute ?? node.minutes ?? 0;
  if (Number.isInteger(h)) return `${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}`; // v1
  if (typeof node.startTime === 'string') return node.startTime.replace(':','');
  if (typeof node.endTime   === 'string') return node.endTime.replace(':','');
  if (typeof node === 'string') return node.replace(':','');
  if (typeof node === 'number') return String(node);
  return null;
}

// {year,month,day} / "YYYY-MM-DD" などから YYYY-MM-DD をとる
function getYMDfromNode(node){
  if (!node) return null;
  if (typeof node === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(node)) return node;
  const y = node.year ?? node.y;
  const m = node.month ?? node.m;
  const d = node.day ?? node.d;
  if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)){
    return `${String(y)}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  return null;
}

// ---------- 抽出：通常（曜日ベース） ----------
function extractRegularDaySlots(periods = [], gday) {
  const slots = [];
  for (const p of periods) {
    if (!p.open || !p.close) continue;
    const o = p.open, c = p.close;
    const oTime = hmPretty(getHHMMfromNode(o));
    const cTime = hmPretty(getHHMMfromNode(c));
    if (!o || !c || !oTime || !cTime) continue;

    if (o.day === gday && c.day === gday) {
      slots.push({ start: oTime, end: cTime });
      continue;
    }
    if (o.day === gday && c.day === ((gday + 1) % 7)) {
      slots.push({ start: oTime, end: '23:59' });
      continue;
    }
    const prev = (gday + 6) % 7;
    if (o.day === prev && c.day === gday) {
      slots.push({ start: '00:00', end: cTime });
      continue;
    }
  }
  return slots.sort((a,b)=>a.start.localeCompare(b.start));
}

// ---------- 抽出：特別（祝日・臨時、日付ベース） ----------
function extractSpecialSlots(periods = [], targetYMD){
  const slots = [];
  const next = nextYMD(targetYMD);
  const prev = prevYMD(targetYMD);

  for (const p of periods) {
    // v1 だと openDate/closeDate + openTime/closeTime が来る
    // v0 系や別形のフォールバックもできるだけ吸収
    const oDate = getYMDfromNode(p.openDate ?? p.startDate ?? p.date ?? p.open?.date);
    const cDate = getYMDfromNode(p.closeDate ?? p.endDate   ?? p.close?.date);
    const oHHMM = getHHMMfromNode(p.openTime ?? p.startTime ?? p.open);
    const cHHMM = getHHMMfromNode(p.closeTime ?? p.endTime   ?? p.close);

    if (!oDate || !cDate || !oHHMM || !cHHMM) continue;

    const oTime = hmPretty(oHHMM);
    const cTime = hmPretty(cHHMM);
    if (!oTime || !cTime) continue;

    // 同日内の特別営業
    if (oDate === targetYMD && cDate === targetYMD){
      slots.push({ start: oTime, end: cTime });
      continue;
    }
    // 当日→翌日を跨ぐ
    if (oDate === targetYMD && cDate === next){
      slots.push({ start: oTime, end: '23:59' });
      continue;
    }
    // 前日→当日0時台クローズ
    if (oDate === prev && cDate === targetYMD){
      slots.push({ start: '00:00', end: cTime });
      continue;
    }
  }
  return slots.sort((a,b)=>a.start.localeCompare(b.start));
}

// ---------- 状態判定 ----------
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

// ---------- 正規化（特別営業時間を最優先） ----------
function normalize(json) {
  const offset = json?.utcOffsetMinutes ?? 540; // JST
  const jstNow = nowInJST(offset);
  const todayY = ymdFromDate(jstNow);
  const tomoY  = ymdFromDate(dateAddDaysJST(jstNow, 1));
  const gToday = jstNow.getDay();
  const gTom   = (gToday + 1) % 7;

  // JSON 既存スロット（fetch-hour が吐いているならそれを尊重）
  const todaySlotsFromJson    = json?.today?.slots ?? [];
  const tomorrowSlotsFromJson = json?.tomorrow?.slots ?? [];

  // Google の periods 抽出
  const specialP =
    json?.specialOpeningHours?.periods ||
    json?.currentOpeningHours?.specialDays?.periods || // 念のため
    [];

  const regularP =
    json?.regularOpeningHours?.periods ||
    json?.currentOpeningHours?.periods ||
    json?.result?.opening_hours?.periods ||
    [];

  // 1) 特別（祝日・臨時）を最優先
  const todaySpecial    = extractSpecialSlots(specialP, todayY);
  const tomorrowSpecial = extractSpecialSlots(specialP, tomoY);

  // 2) 既存 today/tomorrow（fetch の結果）があればそれを優先（＝Google値をすでに取り込んだもの）
  const todayByJson    = todaySlotsFromJson.length    ? todaySlotsFromJson    : null;
  const tomorrowByJson = tomorrowSlotsFromJson.length ? tomorrowSlotsFromJson : null;

  // 3) 通常（曜日）フォールバック
  const todayRegular    = extractRegularDaySlots(regularP, gToday);
  const tomorrowRegular = extractRegularDaySlots(regularP, gTom);

  // 最終決定：特別 > 既存JSON > 通常
  const todayFinal    = (todaySpecial.length    ? todaySpecial    : (todayByJson    ?? todayRegular));
  const tomorrowFinal = (tomorrowSpecial.length ? tomorrowSpecial : (tomorrowByJson ?? tomorrowRegular));

  return {
    utcOffsetMinutes: offset,
    today:    { gDay:gToday,   slots: todayFinal,    isClosed: todayFinal.length===0 },
    tomorrow:{ gDay:gTom,      slots: tomorrowFinal, isClosed: tomorrowFinal.length===0 },
  };
}

// ---------- 描画（営業終了後→「明日の営業時間」） ----------
function render(jsonRaw) {
  const statusEl = document.getElementById('status');
  const hoursEl  = document.getElementById('hours');

  if (!jsonRaw) {
    statusEl.textContent = '現在、営業時間を取得できません';
    hoursEl.textContent  = '時間をおいて再読み込みしてください';
    return;
  }

  const data   = normalize(jsonRaw);
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
    subline  = `本日の営業時間　${formatSlots(slots)}`;
  } else if (st.state === '準備中') {
    headline = st.finishedToday ? '本日の営業は終了しました' : 'ただいま、準備中です';
    if (st.finishedToday) {
      const ts = data?.tomorrow?.slots || [];
      subline = ts.length ? `明日の営業時間　${formatSlots(ts)}` : '明日は定休日です';
    } else {
      subline = `本日の営業時間　${formatSlots(slots)}`;
    }
  } else { // 定休日
    headline = '本日は定休日です';
    const ts = data?.tomorrow?.slots || [];
    subline  = ts.length ? `明日の営業時間　${formatSlots(ts)}` : '明日も定休日です';
  }

  statusEl.textContent = headline;
  hoursEl.textContent  = subline;
}

// ---------- 起動 ----------
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
</script>
