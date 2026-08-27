const map = L.map("map").setView([34.6937, 135.5022], 13);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);
let allRawData = [];

// ==========================================
// カテゴリと色の設定
// ==========================================
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

// 距離計算
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ==========================================
// ★ 新機能：軌跡をアイロンがけする関数（スムージング）
// ==========================================
function smoothLine(points) {
  if (!points || points.length < 3) return points;
  let smoothed = [];
  // 前後2つの点の平均を取って、飛び出し（建物へのめり込み）をマイルドにする
  for (let i = 0; i < points.length; i++) {
    let start = Math.max(0, i - 2);
    let end = Math.min(points.length - 1, i + 2);
    let sumLat = 0, sumLng = 0;
    let count = end - start + 1;
    for (let j = start; j <= end; j++) {
      sumLat += points[j][0];
      sumLng += points[j][1];
    }
    smoothed.push([sumLat / count, sumLng / count]);
  }
  return smoothed;
}

// ==========================================
// 地図にデータと写真を描画する処理
// ==========================================
function renderPublicMap() {
  routeLayer.clearLayers();
  
  const checkboxes = document.querySelectorAll(".filter-cb");
  const visibleCats = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

  // 取得したデータを1件ずつ処理していくループ
  allRawData.forEach((row) => {
    const cat = getCategory(row.wheelchair, row.assistance);
    const isVisible = visibleCats.includes(cat);
    if (!isVisible) return;

    const points = row.positions; 
    if (!points || points.length === 0) return;

    // ★ ここで先ほどのスムージング関数を使って、線を綺麗にする！
    const beautifulPoints = smoothLine(points);

    const color = getCategoryColor(cat);

    // 軌跡（青い線など）を地図に描く（※綺麗な方の点を使う）
    const polyline = L.polyline(beautifulPoints, {
      color: color,
      weight: 5,
      opacity: 0.8,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(routeLayer);

    // 軌跡をタップした時の処理
    polyline.on("click", () => {
      document.querySelector("#empty-message").style.display = "none";
      document.querySelector("#info-filename").textContent = row.fileName || "-";
      document.querySelector("#info-datetime").textContent = row.datetime || "-";
      document.querySelector("#info-weather").textContent = row.weather || "-";
      document.querySelector("#info-wheelchair").textContent = row.wheelchair || "-";
      document.querySelector("#info-assistance").textContent = row.assistance || "-";
      document.querySelector("#info-memo").textContent = row.memo || "クラウド共有データ";

      let totalDist = 0;
      for (let i = 1; i < beautifulPoints.length; i++) {
        totalDist += getDistanceMeters(beautifulPoints[i-1][0], beautifulPoints[i-1][1], beautifulPoints[i][0], beautifulPoints[i][1]);
      }
      document.querySelector("#info-distance").textContent = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${Math.round(totalDist)} m`;
    });

    // ==========================================
    // ★ 写真のピンを立てる処理
    // ==========================================
    if (row.photos && row.photos.length > 0) {
      row.photos.forEach(photo => {
        
        // 古い「uc?」URLを強制的に「lh3」の最強URLに自動変換する
        const safeUrl = photo.url.replace(
          "https://drive.google.com/uc?export=view&id=",
          "https://lh3.googleusercontent.com/d/"
        );

        const marker = L.marker([photo.lat, photo.lng]).addTo(routeLayer);
        
        // ギガ節約！最初はボタンを表示し、押された時だけ画像を読み込む
        marker.bindPopup(`
          <div style="text-align: center;">
            <img
              src="${safeUrl}"
              style="
                max-width: 250px;
                max-height: 300px;
                border-radius: 8px;
                display: block;
                margin: 0 auto;
              "
              onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
            >
            <div style="display:none; color:#666; padding:10px;">
              📷 写真を読み込めませんでした
            </div>
          </div>
        `, {
          maxWidth: 300
        });

      });
    }
  });
}

// ==========================================
// ★ クラウド(GAS)からデータを取ってくる通信処理
// ==========================================
async function loadPublicMapData() {
  const statusMsg = document.querySelector("#status-msg");
  
  // ★★★ 最新のGAS URL（軽量化対応版）★★★
  const gasUrl = "https://script.google.com/macros/s/AKfycbwIuSdqZ5mR57buHEcBx-Mz9HPgG0OLEJAfVSP5ubV9Rk3g6LBVtFyTEXf-9wkU2InE-A/exec";

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
    
    // データが揃ったら地図に描く！
    renderPublicMap();

    // 地図のズームを自動調整する処理
    let allBounds = [];
    data.forEach(row => {
      if (row.positions && row.positions.length > 0) {
        row.positions.forEach(pt => allBounds.push(pt));
      }
    });
    if (allBounds.length > 0) {
      map.fitBounds(L.latLngBounds(allBounds), { padding: [40, 40] });
    }

  } catch (err) {
    console.error(err);
    statusMsg.textContent = "❌ 読み込み失敗";
  }
}

// 絞り込みチェックボックスのイベント
document.querySelectorAll(".filter-cb").forEach(cb => cb.addEventListener("change", renderPublicMap));

document.querySelector("#btn-select-all").addEventListener("click", () => {
  document.querySelectorAll(".filter-cb").forEach(cb => cb.checked = true);
  renderPublicMap();
});
document.querySelector("#btn-reset-filter").addEventListener("click", () => {
  document.querySelectorAll(".filter-cb").forEach(cb => cb.checked = false);
  renderPublicMap();
});

// 起動時にデータを読み込む
loadPublicMapData();
