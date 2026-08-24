// Leaflet 地図の初期化（大阪中心）
const map = L.map("map").setView([34.6937, 135.5022], 13);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);

// 距離計算用
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// NMEA解析
function nmeaToDecimal(value, direction) {
  if (!value || value.indexOf(".") < 2) return null;
  const dotIndex = value.indexOf(".");
  const degrees = Number(value.slice(0, dotIndex - 2));
  const minutes = Number(value.slice(dotIndex - 2));
  if (isNaN(degrees) || isNaN(minutes)) return null;
  const decimal = degrees + minutes / 60;
  return (direction === "S" || direction === "W") ? -decimal : decimal;
}

function parseGgaLines(text) {
  if (!text) return { points: [], lineCount: 0 };
  const lines = text.trim().split("\n");
  const points = [];
  let firstUtcTime = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || (!trimmed.includes("GGA") && !trimmed.includes("GNS"))) continue;
    const fields = trimmed.split(",");
    const isGGA = trimmed.includes("GGA");
    const fixQuality = fields[6];
    const rawLat = isGGA ? fields[2] : fields[1];
    const latDir = isGGA ? fields[3] : fields[2];
    const rawLng = isGGA ? fields[4] : fields[3];
    const lngDir = isGGA ? fields[5] : fields[4];

    if (fixQuality && fixQuality !== "0" && fixQuality !== "N" && rawLat && rawLng) {
      const lat = nmeaToDecimal(rawLat, latDir);
      const lng = nmeaToDecimal(rawLng, lngDir);
      if (lat !== null && lng !== null && lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154) {
        if (!firstUtcTime) firstUtcTime = fields[1];
        points.push([lat, lng]);
      }
    }
  }
  return { points, lineCount: lines.length, firstUtcTime };
}

// スプレッドシートからデータを取得して地図に一斉描画！
async function loadPublicMapData() {
  const statusMsg = document.querySelector("#status-msg");
  // あなたのGASのURL
  const gasUrl = "https://script.google.com/macros/s/AKfycbx9HpFMSgmfeNU8A-MQM50LaJqEcubPo0w7G0lX-5iLAxjKYK5CNSeRnLeqACQkcgrzwQ/exec";

  try {
    const response = await fetch(gasUrl);
    const data = await response.json();

    if (data.error) {
      statusMsg.textContent = "❌ データ取得エラー";
      return;
    }

    if (data.length === 0) {
      statusMsg.textContent = "📭 まだ投稿されたデータがありません";
      return;
    }

    statusMsg.textContent = `✅ ${data.length件}件のデータをロードしました`;
    routeLayer.clearLayers();

    let allBounds = [];

    data.forEach((row, index) => {
      const parsed = parseGgaLines(row.nmeaText);
      if (parsed.points.length === 0) return;

      // 車いすの種類に応じた色分け
      let color = "#3b82f6"; // 青（電動）
      if (row.wheelchair === "車いす（自走式）") color = "#22c55e"; // 緑
      if (row.wheelchair === "車いす（介助用）") color = "#a855f7"; // 紫

      const polyline = L.polyline(parsed.points, {
        color: color,
        weight: 5,
        opacity: 0.8
      }).addTo(routeLayer);

      // 路線をクリックしたときに右側のパネルに詳細を表示
      polyline.on("click", () => {
        document.querySelector("#info-filename").textContent = row.fileName || "不明";
        document.querySelector("#info-datetime").textContent = row.datetime || "-";
        document.querySelector("#info-weather").textContent = row.weather || "-";
        document.querySelector("#info-wheelchair").textContent = row.wheelchair || "-";
        document.querySelector("#info-assistance").textContent = row.assistance || "-";
        document.querySelector("#info-memo").textContent = "クラウド共有データ";

        let totalDist = 0;
        for (let i = 1; i < parsed.points.length; i++) {
          totalDist += getDistanceMeters(parsed.points[i-1][0], parsed.points[i-1][1], parsed.points[i][0], parsed.points[i][1]);
        }
        document.querySelector("#info-distance").textContent = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${Math.round(totalDist)} m`;
      });

      parsed.points.forEach(p => allBounds.push(p));
    });

    // 全体のルートが綺麗に収まるようにズーム
    if (allBounds.length > 0) {
      map.fitBounds(L.latLngBounds(allBounds), { padding: [50, 50] });
    }

  } catch (err) {
    console.error(err);
    statusMsg.textContent = "❌ 通信に失敗しました";
  }
}

// ページを開いたら自動で読み込む
loadPublicMapData();
