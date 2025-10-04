// realtime-status.js
// opening-hours.json を1回だけ取得し、現在時刻と照合して
// 「✅ただいま営業中 / ❌営業時間外」をリアルタイム表示します。

const JSON_URL = './opening-hours.json'; // ルートに置いてある想定

// ---------- ユーティリティ ----------
const HHMM_to_min = (hhmm) => {
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(2, 4), 10);
  return h * 60 + m;
};

const min_to_HHMM = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Google Places の曜日: 0=日,1=月,…6=土
const todayGP = () => {
  const d = new Date();
  // ローカル時間でOK（JSTで閲覧ならJST基準）
  let wd = d.getDay(); // 0=Sun
  return wd;
};

// 現在時刻（分）
const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// periods から「今日」に該当する時間帯（分単位[start,end]）配列を作る
function buildTodayIntervals(periods) {
  const today = todayGP();            // 0..6 (日..土)
  const prev = (today + 6) % 7;
  const intervals = [];

  for (const p of periods) {
    if (!p.open || !p.close) continue;

    const od = p.open.day;
    const cd = p.close.day;
    const ot = HHMM_to_min(p.open.time);
    const ct = HHMM_to_min(p.close.time);

    // 1) 今日開店→今日閉店
    if (od === today && cd === today) {
      intervals.push([ot, ct]);
      continue;
    }

    // 2) 今日開店→翌日閉店（24:00跨ぎ）
    if (od === today && cd === (today + 1) % 7) {
      intervals.push([ot, 24 * 60]); // 24:00まで
      continue;
    }

    // 3) 昨日開店→今日閉店（深夜営業で今日の0:00〜）
    if (od === prev && cd === today) {
      intervals.push([0, ct]); // 0:00からctまで
      continue;
    }
  }

  // ソート & つながる帯はマージ（保険）
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const itv of intervals) {
    if (!merged.length || merged[merged.length - 1][1] < itv[0]) {
      merged.push([...itv]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], itv[1]);
    }
  }
  return merged;
}

// UI更新
function render(statusOpen, label, bandsText) {
  const $status = document.getElementById('status');
  const $hours  = document.getElementById('hours');

  if (!$status || !$hours) return;

  $status.innerHTML = statusOpen
    ? `✅ ただいま、営業しております <span class="icon">▶</span>`
    : `❌ 営業時間外です <span class="icon">▶</span>`;

  $hours.textContent = `営業時間　${bandsText}`;
}

// メイン
async function main() {
  try {
    const res = await fetch(JSON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const opening = data?.result?.opening_hours;
    const periods = opening?.periods;
    const weekday_text = opening?.weekday_text;

    if (!Array.isArray(periods)) {
      render(false, '', '営業時間情報が取得できませんでした');
      return;
    }

    // 今日の営業帯（分）を作る
    const intervals = buildTodayIntervals(periods);

    // 画面に出す「11:00-14:30 / 17:00-19:30」的な文字列を組み立て
    const bandsText = intervals.length
      ? intervals.map(([s, e]) => `${min_to_HHMM(s)}-${min_to_HHMM(e)}`).join(' / ')
      : // intervalsが空でもweekday_textがあればfallback
        (() => {
          if (Array.isArray(weekday_text)) {
            const t = todayGP(); // 0..6 日..土
            // weekday_text は「月曜日: 10時00分～18時00分」形式（順番が月〜日のことが多い）
            // 万一順が違っても、見た目のテキストをまるごと表示する fallback
            const line = weekday_text[t === 0 ? 6 : t - 1] || weekday_text[0];
            return (line || '').replace(/^[^:：]+[:：]\s*/, '').replace(/、/g, ' / ');
          }
          return '—';
        })();

    // 初回表示
    let current = nowMinutes();
    let openNow = intervals.some(([s, e]) => current >= s && current < e);
    render(openNow, '', bandsText);

    // 以後は1分ごとに判定だけ更新（JSONは再取得しない＝無料）
    setInterval(() => {
      current = nowMinutes();
      openNow = intervals.some(([s, e]) => current >= s && current < e);
      render(openNow, '', bandsText);
    }, 60 * 1000);
  } catch (e) {
    render(false, '', '営業時間情報の取得に失敗しました');
    console.error(e);
  }
}

main();