const fs = require("fs");
const https = require("https");

// 本番の Firebase Functions のURL（後で実際のURLに差し替えてOK！）
const API_URL = "https://asia-northeast1-<your-project-id>.cloudfunctions.net/getOpeningHours";

https.get(API_URL, (res) => {
  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });
  res.on("end", () => {
    const openingHours = JSON.parse(data);
    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: sans-serif; padding: 1em; }
            ul { list-style: none; padding: 0; }
            li { margin: 4px 0; }
          </style>
        </head>
        <body>
          <h2>営業時間</h2>
          <ul>
            ${Object.entries(openingHours).map(([day, time]) => `<li>${day}: ${time}</li>`).join("")}
          </ul>
        </body>
      </html>
    `;
    fs.writeFileSync("public/index.html", html, "utf-8");
  });
}).on("error", (err) => {
  console.error("Error fetching opening hours:", err);
});