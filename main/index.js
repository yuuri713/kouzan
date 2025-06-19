const functions = require("firebase-functions");

exports.getOpeningHours = functions.https.onRequest((req, res) => {
  const hours = {
    月: "定休日",
    火: "11:00〜15:00",
    水: "11:00〜15:00",
    木: "11:00〜15:00",
    金: "11:00〜15:00",
    土: "11:00〜15:00",
    日: "11:00〜15:00",
  };

  res.set('Access-Control-Allow-Origin', '*'); // CORS対策
  res.status(200).json(hours);
});
