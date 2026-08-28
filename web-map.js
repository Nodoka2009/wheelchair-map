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

function getVibrationColor(vibValue) {
  if (vibValue >= 5.0) return "#ef4444"; 
  if (vibValue >= 2.0) return "#f59e0b"; 
  return "#22c55e";                      
}

// ★ 生テキストから座標と振動を"ペア"で抽出する最強関数
function parseNmeaWithVib(rawText) {
  const points = [];
  const vibs = [];
  if (!rawText) return { points, vibs };

  const lines = rawText.split('\n');
  lines.forEach(line => {
    if (line.includes("VIB:") && (line.includes("GGA,") || line.includes("GNS,"))) {
      const parts = line.split(",");
      if (parts.length > 5 && parts[2].length > 3 && parts[4].length > 4) {
        const latDeg = parseFloat(parts[2].substring(0, 2));
        const latMin = parseFloat(parts[2].substring(2));
        const lngDeg = parseFloat(parts[4].substring(0, 3));
        const lngMin = parseFloat(parts[4].substring(3));
        let lat = latDeg + (latMin / 60);
        let lng = lngDeg + (lngMin / 60);
        if (parts[3] === 'S') lat = -lat;
        if (parts[5] === 'W') lng = -lng;
        
        const vibPart = line.split("VIB:")[1];
        const vib = parseFloat(vibPart) || 0;
        
        points.push([lat, lng]);
        vibs.push(vib);
      }
    }
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
    const vibrations = row.vibrations;
    if (!points || points.length < 2) return;

    if (colorMode === "wheelchair" || vibrations.length !== points.length) {
      const color = getCategoryColor(cat);
      const polyline = L.polyline(points, {
        color: color, weight: 6, opacity: 0.7, lineCap: "round", lineJoin: "round"
      }).addTo(routeLayer);
      setupRouteClickEvent(polyline, row);
      return;
    }

    // 振動モード：地点ごとに色分け
    for (let i = 0; i < points.length - 1; i++) {
      const segmentPoints = [points[i], points[i + 1]];
      const vibVal = vibrations[i] || 0;
      const segColor = getVibrationColor(vibVal);

      const segPolyline = L.polyline(segmentPoints, {
        color: segColor, weight: 6, opacity: 0.8, lineCap: "round", lineJoin: "round"
      }).addTo(routeLayer);

      setupRouteClickEvent(segPolyline, row);
    }
  });
}

function setupRouteClickEvent(polyline, row) {
  polyline.on("click", () => {
    // 既存のHTMLパネルに情報を流し込む
    document.getElementById("info-datetime").textContent = row.datetime || "-";
    document.getElementById("info-weather").textContent = row.weather || "-";
    document.getElementById("info-wheelchair").textContent = row.wheelchair || "-";
    document.getElementById("info-assistance").textContent = row.assistance || "-";
    
    const vibs = row.vibrations || [0];
    const maxVib = Math.max(...vibs).toFixed(1);
    const avgVib = (vibs.reduce((a, b) => a + b, 0) / vibs.length).toFixed(1);
    
    const memoText = row.memo ? row.memo + " / " : "";
    document.getElementById("info-memo").textContent = `${memoText}最大揺れ: ${maxVib} (平均: ${avgVib})`;
  });
}

async function loadPublicMapData() {
  const gasUrl = "https://script.google.com/macros/s/AKfycbwIuSdqZ5mR57buHEcBx-Mz9HPgG0OLEJAfVSP5ubV9Rk3g6LBVtFyTEXf-9wkU2InE-A/exec";

  try {
    const response = await fetch(gasUrl);
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return;

    allRawData = data.map(row => {
      // 生データがあれば、JS側で確実にペアを作り直す！
      if (row.rawText) {
        const parsed = parseNmeaWithVib(row.rawText);
        if (parsed.points.length > 0) {
          row.positions = parsed.points;
          row.vibrations = parsed.vibs;
        }
      }
      if (!row.vibrations) row.vibrations = [];
      return row;
    });

    renderPublicMap();

    let allBounds = [];
    allRawData.forEach(row => {
      if (row.positions) row.positions.forEach(pt => allBounds.push(pt));
    });
    if (allBounds.length > 0) {
      map.fitBounds(L.latLngBounds(allBounds), { padding: [40, 40] });
    }

  } catch (err) {
    console.error("データ読み込みエラー:", err);
  }
}

document.querySelectorAll(".filter-cb").forEach(cb => cb.addEventListener("change", renderPublicMap));

const colorModeSelect = document.getElementById("color-mode-select");
if (colorModeSelect) {
  colorModeSelect.addEventListener("change", renderPublicMap);
}

loadPublicMapData();
