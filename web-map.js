const map = L.map("map").setView([34.6937, 135.5022], 13);

// ==========================================
// 背景地図の設定（標準マップと航空写真の切り替え）
// ==========================================
const stdMap = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
});

const satelliteMap = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 20,
  maxNativeZoom: 19,
  attribution: 'Tiles &copy; Esri'
});

stdMap.addTo(map);

const baseMaps = {
  "🗺️ 標準マップ": stdMap,
  "🛰️ 航空写真": satelliteMap
};
L.control.layers(baseMaps).addTo(map);

// ==========================================
// HTMLに移動した検索バーを動かす処理
// ==========================================
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');

if (searchInput && searchBtn) {
  const doSearch = async () => {
    const query = searchInput.value.trim();
    if (!query) return;
    
    searchBtn.innerHTML = '⏳';
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (data && data.length > 0) {
        map.flyTo([data[0].lat, data[0].lon], 16, { duration: 1.5 });
      } else {
        alert(`「${query}」が見つかりませんでした。別のキーワードを試してください。`);
      }
    } catch (err) {
      alert("検索エラーが発生しました。");
    } finally {
      searchBtn.innerHTML = '🔍';
    }
  };

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

const routeLayer = L.layerGroup().addTo(map);
let allRawData = [];

// カテゴリと色の設定
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
    case "cat_electric": return "#3b82f6";
    case "cat_manual_no_assist": return "#22c55e";
    case "cat_manual_assist": return "#eab308";
    case "cat_caregiver": return "#a855f7";
    default: return "#94a3b8";
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

// 軌跡をアイロンがけする関数（スムージング）
function smoothLine(points) {
  if (!points || points.length < 3) return points;
  let smoothed = [];
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

  allRawData.forEach((row) => {
    const cat = getCategory(row.wheelchair, row.assistance);
    const isVisible = visibleCats.includes(cat);
    if (!isVisible) return;

    const points = row.positions; 
    if (!points || points.length === 0) return;

    const beautifulPoints = smoothLine(points);
    const color = getCategoryColor(cat);

    // ★ 透明度を0.3にして重ねて濃くする処理
    const polyline = L.polyline(beautifulPoints, {
      color: color,
      weight: 6,
      opacity: 0.3,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(routeLayer);

    // ★ クリック時に周辺の軌跡をすべて探して新しい順に並べる処理
    polyline.on("click", (e) => {
      const clickLat = e.latlng.lat;
      const clickLng = e.latlng.lng;
      
      let hitTracks = [];

      // 半径40m以内にある表示中の軌跡を探す
      allRawData.forEach(searchRow => {
        const searchCat = getCategory(searchRow.wheelchair, searchRow.assistance);
        if (!visibleCats.includes(searchCat)) return;
        if (!searchRow.positions || searchRow.positions.length === 0) return;

        let isHit = false;
        for (let p of searchRow.positions) {
          if (getDistanceMeters(clickLat, clickLng, p[0], p[1]) < 40) {
            isHit = true;
            break;
          }
        }
        if (isHit) hitTracks.push(searchRow);
      });

      // 日時が「新しい順（降順）」になるように並び替え
      hitTracks.sort((a, b) => {
        const timeA = new Date(a.datetime || 0).getTime();
        const timeB = new Date(b.datetime || 0).getTime();
        return timeB - timeA;
      });

      // サイドバーに結果を表示
      const container = document.querySelector("#route-info-container");
      if (!container) return;

      let html = `<div style="margin-bottom: 12px; font-size: 13px; color: #3b82f6; font-weight: bold;">✅ この周辺の記録：${hitTracks.length}件</div>`;
      
      hitTracks.forEach((hitRow, index) => {
        let totalDist = 0;
        let bPoints = smoothLine(hitRow.positions);
        for (let i = 1; i < bPoints.length; i++) {
          totalDist += getDistanceMeters(bPoints[i-1][0], bPoints[i-1][1], bPoints[i][0], bPoints[i][1]);
        }
        const distStr = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${Math.round(totalDist)} m`;

        const isLatest = index === 0;
        html += `
         <div style="font-size: 12px; color: #64748b; font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
  ${index + 1}件目の記録
</div>
            </div>
            <div class="info-item"><div class="info-label">日時</div><div class="info-value">${hitRow.datetime || "-"}</div></div>
            <div class="info-item"><div class="info-label">距離</div><div class="info-value">${distStr}</div></div>
            <div class="info-item"><div class="info-label">天気</div><div class="info-value">${hitRow.weather || "-"}</div></div>
            <div class="info-item"><div class="info-label">車いすの種類</div><div class="info-value">${hitRow.wheelchair || "-"}</div></div>
            <div class="info-item"><div class="info-label">介助の有無</div><div class="info-value">${hitRow.assistance || "-"}</div></div>
            <div class="info-item"><div class="info-label">メモ</div><div class="info-value">${hitRow.memo || "-"}</div></div>
          </div>
        `;
      });
      container.innerHTML = html;
    });

    if (row.photos && row.photos.length > 0) {
      row.photos.forEach(photo => {
        const safeUrl = photo.url.replace(
          "https://drive.google.com/uc?export=view&id=",
          "https://lh3.googleusercontent.com/d/"
        );
        const marker = L.marker([photo.lat, photo.lng]).addTo(routeLayer);
        marker.bindPopup(`
          <div style="text-align: center;">
            <img src="${safeUrl}" style="max-width: 250px; max-height: 300px; border-radius: 8px; display: block; margin: 0 auto;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
            <div style="display:none; color:#666; padding:10px;">📷 写真を読み込めませんでした</div>
          </div>
        `, { maxWidth: 300 });
      });
    }
  });
}

// クラウド(GAS)からデータを取ってくる通信処理
async function loadPublicMapData() {
  const statusMsg = document.querySelector("#status-msg");
  
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
    
    renderPublicMap();

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

loadPublicMapData();
