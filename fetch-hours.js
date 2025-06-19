const fetch = require("node-fetch");

const apiKey = process.env.API_KEY;
const placeId = process.env.PLACE_ID;

const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours&key=${apiKey}`;

fetch(url)
  .then(res => res.json())
  .then(data => {
    // 👇 ここに追加！
    console.log("📦 取得データ:", data);  // ← これ！

    const hours = data.result?.opening_hours?.weekday_text;
    if (!hours || hours.length === 0) {
      throw new Error("営業時間情報が見つかりませんでした");
    }

    const fs = require("fs");
    fs.writeFileSync("opening-hours.json", JSON.stringify(hours, null, 2));
    console.log("✅ 営業時間を書き出しました！");
  })
  .catch(err => {
    console.error("❌ 取得エラー:", err);
  });