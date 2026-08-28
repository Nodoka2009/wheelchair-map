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

const routeLayer = L.layerGroup().addTo(map);
let allRawData = [];

// ★ 追加：ベビーカー等を「cat_other」として判定
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

// ★ 追加：その他を「灰色」に設定
function getCategoryColor(category) {
  switch(category) {
    case "cat_electric": return "#3b82f6";
    case "cat_manual_no_assist": return "#22c55e";
    case "cat_manual_assist": return "#eab308";
    case "cat_caregiver": return "#a855f7";
    case "cat_other": return "#64748b"; // ★ 濃いめの灰色
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

// ★ 追加：時間を「朝・昼・晩」に変換する機能
function formatTimeOfDay(datetimeStr) {
  if (!datetimeStr || datetimeStr === "-") return "-";
  try {
    const parts = datetimeStr.split(" ");
    const datePart = parts[0].replace(/-/g, "/"); 
    const timePart = parts[1] || "";
    
    let hour = 12;
    if (timePart.includes(":")) {
      hour = parseInt(timePart.split(":")[0], 10);
    }

    let timeOfDay = "晩";
    if (hour >= 4 && hour < 11) timeOfDay = "朝";
    else if (hour >= 11 && hour < 16) timeOfDay = "昼";
    
    return `${datePart} ${timeOfDay}`;
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

function renderPublicMap() {
  routeLayer.clearLayers();

  const colorModeSelect = document.getElementById("color-mode-select");
  const colorMode = colorModeSelect ? colorModeSelect.value : "wheelchair";

  const checkboxes = document.querySelectorAll(".filter-cb");
  const visibleCats = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

  allRawData.forEach((row) => {
    const cat = getCategory(row.wheelchair, row.assistance);
    if (!visibleCats.includes(cat)) return;

    const points = row.positions; 
    const vibrations = row.vibrations || [];
    if (!points || points.length === 0) return;

    if (colorMode === "wheelchair" || vibrations.length < points.length) {
      const color = getCategoryColor(cat);
      const polyline = L.polyline(points, {
        color: color, weight: 6, opacity: 0.7, lineCap: "round", lineJoin: "round"
      }).addTo(routeLayer);
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
      
      // ★ 変更：日時の表示を朝・昼・晩に変換
      const timeStr = formatTimeOfDay(hitRow.datetime);

      html += `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
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

    allRawData = data.map(row => {
      let positions = row.positions || [];
      let vibrations = [];

      if (row.rawText) {
        const parsed = parseNmeaWithVib(row.rawText);
        if (parsed.points.length > 0) {
          positions = parsed.points;
          vibrations = parsed.vibs;
        }
      }

      if (vibrations.length === 0) vibrations = positions.map(() => 0.0);

      return {
        ...row,
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
