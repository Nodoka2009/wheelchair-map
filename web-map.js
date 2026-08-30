// ★ 追加：カードがクリックされた時などの強調（ハイライト）用CSSを自動適用
const style = document.createElement('style');
style.innerHTML = `
  .record-card { border: 2px solid transparent; cursor: pointer; transition: all 0.2s ease; }
  .record-card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
  .record-card.highlighted { border-color: #3b82f6 !important; background-color: #eff6ff !important; box-shadow: 0 0 0 2px rgba(59,130,246,0.3); }
`;
document.head.appendChild(style);

const map = L.map("map", { zoomControl: false }).setView([34.6937, 135.5022], 13);

const stdMap = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: '© OpenStreetMap contributors © CARTO',
});

const satelliteMap = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 20,
  maxNativeZoom: 19,
  attribution: 'Tiles © Esri'
});

stdMap.addTo(map);

const baseMaps = {
  "🗺️ 標準マップ": stdMap,
  "🛰️ 航空写真": satelliteMap
};

L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.layers(baseMaps, null, { position: 'bottomright' }).addTo(map);

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
        alert(`「${query}」が見つかりませんでした。`);
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

// ★ 追加：ハイライト状態を管理する変数
let currentHighlightedId = null;
const routeLayers = {}; // 各ルートの線（Polyline）を保存する箱

function getCategory(wheelchair, assistance) {
  if (!wheelchair) return "cat_unknown";
  if (wheelchair.includes("電動")) return "cat_electric";
  if (wheelchair.includes("自走")) {
    return (assistance && assistance.includes("あり")) ? "cat_manual_assist" : "cat_manual_no_assist";
  }
  if (wheelchair.includes("介助")) return "cat_caregiver";
  if (wheelchair.includes("その他") || wheelchair.includes("ベビーカー")) return "cat_other";
  return "cat_unknown";
}

function getCategoryColor(category) {
  switch(category) {
    case "cat_electric": return "#3b82f6";
    case "cat_manual_no_assist": return "#22c55e";
    case "cat_manual_assist": return "#eab308";
    case "cat_caregiver": return "#a855f7";
    case "cat_other": return "#64748b";
    default: return "#94a3b8";
  }
}

function getVibrationColor(vibValue) {
  if (vibValue >= 5.0) return "#ef4444"; 
  if (vibValue >= 2.0) return "#f59e0b"; 
  return "#22c55e";                      
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatTimeOfDay(datetimeStr) {
  if (!datetimeStr || datetimeStr === "-") return "-";
  try {
    const d = new Date(datetimeStr);
    if (isNaN(d.getTime())) return datetimeStr;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hour = d.getHours();

    let timeOfDay = "晩";
    if (hour >= 4 && hour < 11) timeOfDay = "朝";
    else if (hour >= 11 && hour < 16) timeOfDay = "昼";
    
    return `${yyyy}/${mm}/${dd} ${timeOfDay}`;
  } catch(e) {
    return datetimeStr;
  }
}

function parseNmeaWithVib(rawText) {
  const points = [];
  const vibs = [];

  if (!rawText) return { points, vibs };

  const lines = rawText.split(/\r?\n/);

  lines.forEach(line => {
    if (!line.includes("$GPGGA,")) return;
    if (!line.includes("VIB:")) return;

    const parts = line.split(",");
    if (parts.length < 7) return;

    const fixQuality = parseInt(parts[6], 10);
    if (isNaN(fixQuality) || fixQuality === 0) return;
    if (!parts[2] || !parts[3] || !parts[4] || !parts[5]) return;

    const latDeg = parseFloat(parts[2].substring(0, 2));
    const latMin = parseFloat(parts[2].substring(2));
    const lngDeg = parseFloat(parts[4].substring(0, 3));
    const lngMin = parseFloat(parts[4].substring(3));

    if (isNaN(latDeg) || isNaN(latMin) || isNaN(lngDeg) || isNaN(lngMin)) return;

    let lat = latDeg + latMin / 60;
    let lng = lngDeg + lngMin / 60;

    if (parts[3] === "S") lat = -lat;
    if (parts[5] === "W") lng = -lng;

    const vibMatch = line.match(/VIB:([-+]?\d*\.?\d+)/);
    if (!vibMatch) return;

    const vib = parseFloat(vibMatch[1]);
    if (isNaN(vib)) return;

    points.push([lat, lng]);
    vibs.push(vib);
  });

  return { points, vibs };
}

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

// ★ 追加：線とカードのハイライト（強調）を連動させる関数
window.highlightRouteAndCard = function(routeId) {
  // 前に強調されていたものを元に戻す
  if (currentHighlightedId) {
    const prevCard = document.getElementById(`record-card-${currentHighlightedId}`);
    if (prevCard) prevCard.classList.remove('highlighted');
    
    if (routeLayers[currentHighlightedId]) {
      routeLayers[currentHighlightedId].forEach(layer => layer.setStyle({ weight: 6, opacity: 0.8 }));
    }
  }

  currentHighlightedId = routeId;

  // クリックされたカードを強調する
  const newCard = document.getElementById(`record-card-${routeId}`);
  if (newCard) {
    newCard.classList.add('highlighted');
    newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // スクロールして見える位置に移動
  }

  // クリックされた線を太くして最前面に出す
  if (routeLayers[routeId]) {
    routeLayers[routeId].forEach(layer => {
      layer.setStyle({ weight: 12, opacity: 1.0 }); // 線を太くする
      layer.bringToFront();
    });
  }
};

function renderPublicMap() {
  routeLayer.clearLayers();
  
  // ★ 追加：再描画時にルートごとの線の記憶をリセット
  for (let key in routeLayers) delete routeLayers[key];

  const colorModeSelect = document.getElementById("color-mode-select");
  const colorMode = colorModeSelect ? colorModeSelect.value : "wheelchair";

  const checkboxes = document.querySelectorAll(".filter-cb");
  const visibleCats = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

  allRawData.forEach((row) => {
    const cat = getCategory(row.wheelchair, row.assistance);
    if (!visibleCats.includes(cat)) return;

    const rawPoints = row.positions; 
    const vibrations = row.vibrations || [];
    if (!rawPoints || rawPoints.length < 2) return;

    const points = smoothLine(rawPoints);
    routeLayers[row.id] = []; // ★ 追加：このルートの線を格納する配列を準備

    if (colorMode === "wheelchair" || vibrations.length < points.length) {
      const color = getCategoryColor(cat);
      const polyline = L.polyline(points, {
        color: color, weight: 6, opacity: 0.7, lineCap: "round", lineJoin: "round"
      }).addTo(routeLayer);
      
      routeLayers[row.id].push(polyline); // ★ 追加：線を記録
      setupRouteClickEvent(polyline, points, row, visibleCats);
      return;
    }

    for (let i = 0; i < points.length - 1; i++) {
      const segmentPoints = [points[i], points[i + 1]];
      const vibVal = vibrations[i] || 0;
      const segColor = getVibrationColor(vibVal);

      const segPolyline = L.polyline(segmentPoints, {
        color: segColor, weight: 6, opacity: 0.8, lineCap: "round", lineJoin: "round"
      }).addTo(routeLayer);

      routeLayers[row.id].push(segPolyline); // ★ 追加：セグメントの線を記録
      setupRouteClickEvent(segPolyline, points, row, visibleCats);
    }
  });
}

function setupRouteClickEvent(polyline, points, row, visibleCats) {
  polyline.on("click", (e) => {
    document.getElementById("info-panel").style.display = "flex";

    const clickLat = e.latlng.lat;
    const clickLng = e.latlng.lng;
    let hitTracks = [];

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

    hitTracks.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));

    const container = document.querySelector("#route-info-container");
    if (!container) return;

    let html = `<div style="margin-bottom: 12px; font-size: 13px; color: #3b82f6; font-weight: bold;">✅ この周辺の記録：${hitTracks.length}件</div>`;
    
    hitTracks.forEach((hitRow, index) => {
      const vibs = hitRow.vibrations || [0];
      const maxVib = Math.max(...vibs).toFixed(1);
      const avgVib = (vibs.reduce((a, b) => a + b, 0) / vibs.length).toFixed(1);
      const timeStr = formatTimeOfDay(hitRow.datetime);

      // ★ 追加：id="record-card-〇〇", class="record-card", onclick="..." を設定し、クリック連動させる
      html += `
        <div id="record-card-${hitRow.id}" class="record-card" onclick="highlightRouteAndCard('${hitRow.id}')" style="background: #f8fafc; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
          <div style="font-size: 12px; color: #64748b; font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
            <span>${index + 1}件目の記録</span>
            <span style="background: #e2e8f0; padding: 4px 8px; border-radius: 12px; color: #334155;">🦽 ${hitRow.wheelchair || "-"}</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#334155;">
            <div><strong>🗓️ 日時：</strong> ${timeStr}</div>
            <div><strong>📈 最大の揺れ：</strong> ${maxVib} （平均: ${avgVib}）</div>
            <div><strong>☀️ 天気：</strong> ${hitRow.weather || "-"}</div>
            <div><strong>🤝 介助：</strong> ${hitRow.assistance || "-"}</div>
            <div><strong>📝 メモ：</strong> ${hitRow.memo || "-"}</div>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;

    // ★ 追加：パネルが表示された直後に、自分がクリックした線を自動でハイライトする
    setTimeout(() => {
      window.highlightRouteAndCard(row.id);
    }, 50);
  });
}

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

    // ★ 修正：データそれぞれに一意の「ID」を割り振る (indexを利用)
    allRawData = data.map((row, index) => {
      let positions = row.positions || [];
      let vibrations = [];

      const rawNmea = row.nmeaText || row.rawText;
      if (rawNmea) {
        const parsed = parseNmeaWithVib(rawNmea);
        if (parsed.points.length > 0) {
          positions = parsed.points;
          vibrations = parsed.vibs;
        }
      }

      if (vibrations.length === 0) vibrations = positions.map(() => 0.0);

      return {
        ...row,
        id: "route_" + index, // ★ 追加：ルート判別用のID
        positions: positions,
        vibrations: vibrations
      };
    });

    statusMsg.textContent = `✅ ${data.length}件のデータをロードしました`;
    renderPublicMap();

    let allBounds = [];
    allRawData.forEach(row => {
      if (row.positions) row.positions.forEach(pt => allBounds.push(pt));
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

const colorModeSelect = document.getElementById("color-mode-select");
if (colorModeSelect) {
  colorModeSelect.addEventListener("change", renderPublicMap);
}

loadPublicMapData();
