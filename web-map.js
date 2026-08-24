const map = L.map("map").setView([34.6937, 135.5022], 13);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);
let allRawData = [];

function getCategory(wheelchair, assistance) {
  if (!wheelchair) return "cat_unknown";
  if (wheelchair.includes("電動")) return "cat_electric";
  if (wheelchair.includes("自走")) {
    return (assistance && assistance.includes("あり")) ? "cat_manual_assist" : "cat_manual_no_assist";
  }
  if (wheelchair.includes("介助")) return "cat_caregiver";
  return "cat_unknown";
}

function getCategoryColor(category) {
  switch(category) {
    case "cat_electric": return "#3b82f6"; // 青
    case "cat_manual_no_assist": return "#22c55e"; // 緑
    case "cat_manual_assist": return "#eab308"; // 黄
    case "cat_caregiver": return "#a855f7"; // 紫
    default: return "#94a3b8"; // グレー
  }
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function nmeaToDecimal(value, direction) {
  if (!value || value.indexOf(".") < 2) return null;
  const dotIndex = value.indexOf(".");
  const degrees = Number(value.slice(0, dotIndex - 2));
  const minutes = Number(value.slice(dotIndex - 2));
  if (isNaN(degrees) || isNaN(minutes)) return null;
  const decimal = degrees + minutes / 60;
  return (direction === "S" || direction === "W") ? -decimal : decimal;
}

// ★ 改行がなくても "$" を目印にして1行ずつに自動分解する賢い解析関数
function parseGgaLines(text) {
  if (!text) return { points: [] };
  
  // 改行コードだけでなく、"$" マークの前で強制的に分割する
  const normalizedText = text.replace(/\$/g, "\n$");
  const lines = normalizedText.trim().split(/\r?\n/);
  
  const points = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes("GGA")) continue;
    const fields = trimmed.split(",");
    const rawLat = fields[2], latDir = fields[3], rawLng = fields[4], lngDir = fields[5], fixQuality = fields[6];
    if (!rawLat || !rawLng || !latDir || !lngDir || fixQuality === "0") continue;
    const lat = nmeaToDecimal(rawLat, latDir);
    const lng = nmeaToDecimal(rawLng, lngDir);
    if (lat !== null && lng !== null && lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154) {
      points.push([lat, lng]);
    }
  }
  return { points };
}

function renderPublicMap() {
  routeLayer.clearLayers();
  
  const checkboxes = document.querySelectorAll(".filter-cb");
  const visibleCats = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

  allRawData.forEach((row) => {
    const cat = getCategory(row.wheelchair, row.assistance);
    const isVisible = visibleCats.includes(cat);
    if (!isVisible) return;

    const parsed = parseGgaLines(row.nmeaText);
    if (parsed.points.length === 0) return;

    const color = getCategoryColor(cat);

    const polyline = L.polyline(parsed.points, {
      color: color,
      weight: 5,
      opacity: 0.8,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(routeLayer);

    polyline.on("click", () => {
      document.querySelector("#empty-message").style.display = "none";
      document.querySelector("#info-filename").textContent = row.fileName || "-";
      document.querySelector("#info-datetime").textContent = row.datetime || "-";
      document.querySelector("#info-weather").textContent = row.weather || "-";
      document.querySelector("#info-wheelchair").textContent = row.wheelchair || "-";
      document.querySelector("#info-assistance").textContent = row.assistance || "-";
      document.querySelector("#info-memo").textContent = row.memo || "クラウド共有データ";

      let totalDist = 0;
      for (let i = 1; i < parsed.points.length; i++) {
        totalDist += getDistanceMeters(parsed.points[i-1][0], parsed.points[i-1][1], parsed.points[i][0], parsed.points[i][1]);
      }
      document.querySelector("#info-distance").textContent = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${Math.round(totalDist)} m`;
    });
  });
}
// ====== ★これを追加するだけで今までのマップが写真対応になります！ ======
if (record.photos && record.photos.length > 0) {
    record.photos.forEach(photo => {
        // ピンを立てる
        const marker = L.marker([photo.lat, photo.lng]).addTo(routeLayer); // または addTo(map)
        
        // ピンをクリックしたときに写真を表示するポップアップ
        marker.bindPopup(`
            <div style="text-align: center;">
                <img src="${photo.url}" style="max-width: 250px; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                <br><span style="font-size: 12px; color: #666;">現場写真</span>
            </div>
        `, { maxWidth: 300 });
    });
}
// =================================================================
async function loadPublicMapData() {
  const statusMsg = document.querySelector("#status-msg");
  const gasUrl = "https://script.google.com/macros/s/AKfycbx9HpFMSgmfeNU8A-MQM50LaJqEcubPo0w7G0lX-5iLAxjKYK5CNSeRnLeqACQkcgrzwQ/exec";

  try {
    statusMsg.textContent = "⏳ データを読み込み中...";
    const response = await fetch(gasUrl);
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      statusMsg.textContent = "📭 データがありません";
      return;
    }

    allRawData = data;
    statusMsg.textContent = `✅ ${data.length}件のデータをロードしました`;
    
    renderPublicMap();

    let allBounds = [];
    data.forEach(row => {
      const p = parseGgaLines(row.nmeaText);
      p.points.forEach(pt => allBounds.push(pt));
    });
    if (allBounds.length > 0) {
      map.fitBounds(L.latLngBounds(allBounds), { padding: [40, 40] });
    }

  } catch (err) {
    console.error(err);
    statusMsg.textContent = "❌ 読み込み失敗";
  }
}

document.querySelectorAll(".filter-cb").forEach(cb => cb.addEventListener("change", renderPublicMap));

document.querySelector("#btn-select-all").addEventListener("click", () => {
  document.querySelectorAll(".filter-cb").forEach(cb => cb.checked = true);
  renderPublicMap();
});
document.querySelector("#btn-reset-filter").addEventListener("click", () => {
  document.querySelectorAll(".filter-cb").forEach(cb => cb.checked = false);
  renderPublicMap();
});

loadPublicMapData();
