fetch("https://yuuri713.github.io/kouzan/opening-hours.json")
  .then(response => response.json())
  .then(data => {
    const ul = document.createElement("ul");
    Object.entries(data).forEach(([day, hours]) => {
      const li = document.createElement("li");
      li.textContent = `${day}: ${hours}`;
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