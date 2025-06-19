const fs = require("fs");

// fetch風に非同期で読み込む（Node.js版）
const openingHours = JSON.parse(fs.readFileSync("public/opening-hours.json", "utf-8"));

// HTMLを生成
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
      ${openingHours.map(day => `<li>${day}</li>`).join("")}
    </ul>
  </body>
</html>
`;

// HTMLファイルとして保存
fs.writeFileSync("public/hours.html", html, "utf-8");