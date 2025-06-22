// fetch-hours.js
const fs = require('fs');
const axios = require('axios');

const placeId = "ChIJt3vY_7erGWARmfhnxfJbUnI"; // ←ここに本当に取得したいplaceIDを！

const apiKey = process.env.GOOGLE_API_KEY;
const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours&key=${apiKey}`;

axios.get(url)
  .then(response => {
    const hours = response.data.result.opening_hours;
    fs.writeFileSync('opening-hours.json', JSON.stringify(hours, null, 2));
  })
  .catch(error => {
    console.error(error);
  });