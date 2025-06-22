// fetch-hours.js
const fs = require("fs");
const fetch = require("node-fetch");

const apiKey = process.env.API_KEY;
const placeId = process.env.PLACE_ID;

const url = `https://maps.googleapis.com/maps/api/place/details/json?placeid=${placeId}&key=${apiKey}&fields=opening_hours`;

fetch(url)
  .then((res) => res.json())
  .then((data) => {
    const hours = data.result.opening_hours;
    fs.writeFileSync("public/opening-hours.json", JSON.stringify(hours, null, 2));
    console.log("✅ 営業時間データを更新しました！");
  })
  .catch(console.error);