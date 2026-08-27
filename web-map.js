const map = L.map("map").setView([34.6937, 135.5022], 13);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);
let allRawData = [];

// ==========================================
// カテゴリと色の設定（変更なし）
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

// 距離計算（変更なし）
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ==========================================
// ★ 地図にデータと写真を描画する処理（劇的に軽く・賢くなりました！）
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

    // ★ 重い解析処理(parseGgaLines)を全削除！GASから送られてきた数字をそのまま使う！
    const points = row.positions; 
    if (!points || points.length === 0) return;

    const color = getCategoryColor(cat);

    // 軌跡（青い線など）を地図に描く
    const polyline = L.polyline(points, {
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
      for (let i = 1; i < points.length; i++) {
        totalDist += getDistanceMeters(points[i-1][0], points[i-1][1], points[i][0], points[i][1]);
      }
      document.querySelector("#info-distance").textContent = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${Math.round(totalDist)} m`;
    });

 // ==========================================
    // ★ 写真のピンを立てる処理
    // ==========================================
    if (row.photos && row.photos.length > 0) {
      row.photos.forEach(photo => {
        
        // ★ここを追加！古い「uc?」URLを強制的に「lh3」の最強URLに自動変換する！
       const safeUrl = photo.url.replace(
  "https://drive.google.com/uc?export=view&id=",
  "https://lh3.googleusercontent.com/d/"
);

        const marker = L.marker([photo.lat, photo.lng]).addTo(routeLayer);
        const photoId = "photo_" + Math.random().toString(36).substr(2, 9);
        
        // ギガ節約！最初はボタンを表示し、押された時だけ画像を読み込む
        marker.bindPopup(`
            <div style="text-align: center;" id="container_${photoId}">
                <!-- ★ photo.url を safeUrl に変更！ -->
                <button onclick="document.getElementById('container_${photoId}').innerHTML = '<img src=\\'${safeUrl}\\' style=\\'max-width: 250px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);\\'>'" 
                        style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 4px;">
                    📷 写真を読み込む
                </button>
                <br><span style="font-size: 11px; color: #666; display: inline-block; margin-top: 8px;">タップして現場の画像を取得</span>
            </div>
        `, { maxWidth: 300 });
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
