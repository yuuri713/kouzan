const axios = require("axios");
const fs = require("fs");

const API_KEY = "AIzaSyBVWzaFYKXwdjOcCvcD81WgOZoXVmJLXT0";
const placeId = "ChIJ5aItaCPLA2ARI-sQQVyBvQs";

const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${API_KEY}&language=ja`;

async function fetchHours() {
  try {
    const response = await axios.get(url);
    console.log("✅ APIレスポンス確認:", response.data);

    const openingHours = response.data.result?.opening_hours;

    if (!openingHours) {
      console.error("🚨 opening_hours が見つかりませんでした！");
      process.exit(1);
    }

    const jsonData = {
      result: {
        opening_hours: openingHours,
      },
    };

    fs.writeFileSync("opening-hours.json", JSON.stringify(jsonData, null, 2), "utf-8");
    console.log("✅ 書き出し成功！");
  } catch (error) {
    console.error("❌ エラー:", error.message);
    process.exit(1); // エラーがあったらGitHub Actionsも失敗させる
  }
}

fetchHours();