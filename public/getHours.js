const apiKey = "AIzaSyBVWzaFYKXwdjOcCvcD81WgOZoXVmJLXT0";
const placeId = "ChIJt3vY_7erGWARmfhnxfJbUnI";

// 📡 Google Places API のURLを作成
const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours&key=${apiKey}`;

fetch(url)
  .then(response => response.json())
  .then(data => {
    const hours = data.result?.opening_hours?.weekday_text;

    if (!hours || hours.length === 0) {
      throw new Error("営業時間情報が見つかりませんでした");
    }

    const ul = document.createElement("ul");
    hours.forEach(line => {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    });

    const wrapper = document.createElement("div");
    wrapper.innerHTML = "<h2>営業時間</h2>";
    wrapper.appendChild(ul);
    document.body.appendChild(wrapper);
  })
  .catch(error => {
    console.error("営業時間の取得に失敗しました:", error);
  });