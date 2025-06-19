const fs = require("fs");
const fetch = require("node-fetch");

const API_KEY = "AIzaSyBVWzaFYKXwdjOcCvcD81WgOZoXVmJLXT0"; // ← あなたのAPIキー
const PLACE_ID = "ChIJt3vY_7erGWARmfhnxfJbUnI"; // ← あなたのお店のPlace ID

const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours&key=${apiKey}`;

fetch(url)
  .then((res) => res.json())
  .then((data) => {
    const periods = data.result?.opening_hours?.weekday_text;
    if (!periods) throw new Error("営業時間データが見つかりません");

    // 変換して保存
    const formatted = {};
    periods.forEach((line) => {
      const [day, hours] = line.split(/:\s(.+)/);
      formatted[day] = hours;
    });

    fs.writeFileSync("opening-hours.json", JSON.stringify(formatted, null, 2));
    console.log("✅ 営業時間を更新しました");
  })
  .catch((err) => {
    console.error("❌ 営業時間の取得に失敗しました:", err);
  });