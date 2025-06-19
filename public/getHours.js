const fs = require("fs");

// 仮の営業時間データ（あとでAPI連携に差し替え可）
const openingHours = [
  "月曜日: 定休日",
  "火曜日: 11時00分～14時30分",
  "水曜日: 11時00分～14時30分",
  "木曜日: 11時00分～14時30分",
  "金曜日: 11時00分～14時30分",
  "土曜日: 11時00分～14時30分, 17時00分～19時30分",
  "日曜日: 11時00分～14時30分, 17時00分～19時30分",
];

// HTMLとして出力
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

// 出力先：public/hours.html
fs.writeFileSync("public/hours.html", html, "utf-8");
console.log("✅ 営業時間HTMLを出力しました！");