// ========================================
// 1. スタイル（CSS）の安全な追加
// ========================================
if (!document.getElementById("custom-map-styles")) {
  const style = document.createElement('style');
  style.id = "custom-map-styles";
  style.innerHTML = `
    .record-card { cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; }
    .record-card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    /* 枠線によるサイズ変化（レイアウトのズレ）を防ぐため、内側の影として青枠を描画 */
    .record-card.highlighted { box-shadow: inset 0 0 0 2px #3b82f6 !important; background-color: #eff6ff !important; border: none !important; }
    
    #route-cards-wrapper { max-height: 290px; overflow-y: auto; padding-right: 6px; }
    #route-cards-wrapper::-webkit-scrollbar { width: 6px; }
    #route-cards-wrapper::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    #info-panel.minimized #route-info-container { display: none !important; }
    
    .bottom-left-panel.minimized > div { display: none !important; }
    .bottom-left-panel.minimized h2 { margin-bottom: 0 !important; border-bottom: none !important; padding-bottom: 0 !important; }
  `;
  document.head.appendChild(style);
}

// ========================================
// 2. グローバル変数の安全な初期化
// ========================================
window.allRawData = window.allRawData || [];
window.currentHighlightedId = window.currentHighlightedId || null;
window.routeLayers = window.routeLayers || {};

if (!window.michiMap) {
  window.michiMap = L.map("map", { zoomControl: false }).setView([34.6937, 135.5022], 13);
  const stdMap = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 20, attribution: '© OpenStreetMap contributors © CARTO' });
  const satelliteMap = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, maxNativeZoom: 19, attribution: 'Tiles © Esri' });
  
  stdMap.addTo(window.michiMap);
  
  const baseMaps = { "🗺️ 標準マップ": stdMap, "🛰️ 航空写真": satelliteMap };
  L.control.zoom({ position: 'bottomright' }).addTo(window.michiMap);
  L.control.layers(baseMaps, null, { position: 'bottomright' }).addTo(window.michiMap);
}

if (!window.routeLayer) window.routeLayer = L.layerGroup().addTo(window.michiMap);
if (!window.glowLayer) window.glowLayer = L.layerGroup().addTo(window.michiMap);

// ========================================
// 3. 検索機能
// ========================================
if (!window.searchEventAdded) {
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
          window.michiMap.flyTo([data[0].lat, data[0].lon], 16, { duration: 1.5 });
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
    searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') doSearch(); });
    window.searchEventAdded = true;
  }
}

// ========================================
// 4. データ解析ツール群
// ========================================
function getCategory(wheelchair, assistance) {
  if (!wheelchair) return "cat_unknown";
  if (wheelchair.includes("電動")) return "cat_electric";
  if (wheelchair.includes("自走")) return (assistance && assistance.includes("あり")) ? "cat_manual_assist" : "cat_manual_no_assist";
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
  } catch(e) { return datetimeStr; }
}

function parseNmeaWithVib(rawText) {
  const points = [];
  const vibs = [];
  if (!rawText) return { points, vibs };
  const lines = rawText.split(/\r?\n/);
  lines.forEach(line => {
    if (!line.includes("$GPGGA,") || !line.includes("VIB:")) return;
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

// ========================================
// 5. ハイライト（光彩）処理
// ========================================
window.highlightRouteAndCard = function(routeId) {
  if (window.currentHighlightedId) {
    const prevCard = document.getElementById(`record-card-${window.currentHighlightedId}`);
    if (prevCard) prevCard.classList.remove('highlighted');
    if (window.routeLayers[window.currentHighlightedId]) {
      window.routeLayers[window.currentHighlightedId].forEach(layer => layer.setStyle({ weight: 6, opacity: 0.8 }));
    }
  }

  window.glowLayer.clearLayers();
  window.currentHighlightedId = routeId;

  const newCard = document.getElementById(`record-card-${routeId}`);
  if (newCard) {
    newCard.classList.add('highlighted');
    newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const targetRow = window.allRawData.find(r => r.id === routeId);
  if (targetRow && targetRow.positions && targetRow.positions.length >= 2) {
    const points = smoothLine(targetRow.positions);
    L.polyline(points, {
      color: '#3b82f6',
      weight: 22,
      opacity: 0.25,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false 
    }).addTo(window.glowLayer);
  }

  if (window.routeLayers[routeId]) {
    window.routeLayers[routeId].forEach(layer => {
      layer.setStyle({ weight: 8, opacity: 1.0 }); 
      layer.bringToFront();
    });
  }
};

// ========================================
// 6. 地図描画処理
// ========================================
function renderPublicMap() {
  window.routeLayer.clearLayers();
  window.glowLayer.clearLayers();
  for (let key in window.routeLayers) delete window.routeLayers[key];

  const colorModeSelect = document.getElementById("color-mode-select");
  const colorMode = colorModeSelect ? colorModeSelect.value : "wheelchair";
  const checkboxes = document.querySelectorAll(".filter-cb");
  const visibleCats = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

  window.allRawData.forEach((row) => {
    const cat = getCategory(row.wheelchair, row.assistance);
    if (!visibleCats.includes(cat)) return;

    const rawPoints = row.positions; 
    const vibrations = row.vibrations || [];
    if (!rawPoints || rawPoints.length < 2) return;

    const points = smoothLine(rawPoints);
    window.routeLayers[row.id] = []; 

    // 軌跡（線）の描画
    if (colorMode === "wheelchair" || vibrations.length < points.length) {
      const color = getCategoryColor(cat);
      const polyline = L.polyline(points, { color: color, weight: 6, opacity: 0.7, lineCap: "round", lineJoin: "round" }).addTo(window.routeLayer);
      window.routeLayers[row.id].push(polyline); 
      setupRouteClickEvent(polyline, points, row, visibleCats);
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        const segmentPoints = [points[i], points[i + 1]];
        const vibVal = vibrations[i] || 0;
        const segColor = getVibrationColor(vibVal);
        const segPolyline = L.polyline(segmentPoints, { color: segColor, weight: 6, opacity: 0.8, lineCap: "round", lineJoin: "round" }).addTo(window.routeLayer);
        window.routeLayers[row.id].push(segPolyline); 
        setupRouteClickEvent(segPolyline, points, row, visibleCats);
      }
    }

    // ==========================================
    // ★ 写真のピンを立てる処理（新しい形式のみ！）
    // ==========================================
    if (row.photos && row.photos.length > 0) {
      row.photos.forEach(photo => {
        // 新しい写真データ (image) が無いものは無視
        if (!photo.image) return;

        const marker = L.marker([photo.lat, photo.lng]).addTo(window.routeLayer);
        
        let popupContent = `<div style="text-align: center;">`;
        
        popupContent += `
          <img
            src="${photo.image}"
            style="max-width: 250px; max-height: 300px; border-radius: 8px; display: block; margin: 0 auto 8px;"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
          >
          <div style="display:none; color:#666; padding:10px;">📷 写真を読み込めませんでした</div>
        `;

        // メモがあれば表示
        if (photo.memo) {
          popupContent += `<div style="font-weight: bold; font-size: 14px; margin-bottom: 4px; text-align: left;">📝 ${photo.memo}</div>`;
        }
        // 日付があれば表示
        if (photo.date) {
          popupContent += `<div style="font-size: 11px; color: #64748b; text-align: right;">📅 ${photo.date}</div>`;
        }
        
        popupContent += `</div>`;
        marker.bindPopup(popupContent, { maxWidth: 300 });
      });
    }
  });
}

// ========================================
// 7. クリックイベント処理
// ========================================
function setupRouteClickEvent(polyline, points, row, visibleCats) {
  polyline.on("click", (e) => {
    const infoPanel = document.getElementById("info-panel");
    if (!infoPanel) return;

    infoPanel.style.display = "flex";
    infoPanel.classList.remove("minimized");

    let minBtn = document.getElementById("minimize-panel-btn");
    if (!minBtn) {
      const buttons = infoPanel.querySelectorAll("button");
      const closeBtn = buttons.length > 0 ? buttons[0] : null;
      minBtn = document.createElement("button");
      minBtn.id = "minimize-panel-btn";
      minBtn.style.cssText = "background: transparent !important; border: none !important; font-size: 16px !important; cursor: pointer; color: #64748b; margin-right: 12px; padding: 4px;";
      minBtn.innerHTML = "➖";
      minBtn.title = "最小化 / 展開";
      minBtn.onclick = (event) => {
        event.stopPropagation();
        infoPanel.classList.toggle("minimized");
        minBtn.innerHTML = infoPanel.classList.contains("minimized") ? "＋" : "➖";
      };
      if (closeBtn && closeBtn.parentNode) {
        closeBtn.parentNode.insertBefore(minBtn, closeBtn);
        closeBtn.style.display = "none";
      } else {
        infoPanel.insertBefore(minBtn, infoPanel.firstChild);
      }
    } else {
      minBtn.innerHTML = "➖"; 
    }

    const clickLat = e.latlng.lat;
    const clickLng = e.latlng.lng;
    let hitTracks = [];

    window.allRawData.forEach(searchRow => {
      const searchCat = getCategory(searchRow.wheelchair, searchRow.assistance);
      if (!visibleCats.includes(searchCat)) return;
      if (!searchRow.positions || searchRow.positions.length === 0) return;
      let isHit = false;
      for (const p of searchRow.positions) {
        if (getDistanceMeters(clickLat, clickLng, p[0], p[1]) < 40) {
          isHit = true; break;
        }
      }
      if (isHit) hitTracks.push(searchRow);
    });

    hitTracks.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));

    const container = document.querySelector("#route-info-container");
    if (!container) return;

    let html = `
      <div id="nearby-records-header" style="margin-bottom: 12px; font-size: 13px; color: #3b82f6; font-weight: bold; background: #eff6ff; padding: 8px 12px; border-radius: 6px;">
        <span>✅ この周辺の記録：${hitTracks.length}件</span>
      </div>
      <div id="route-cards-wrapper">
    `;

    hitTracks.forEach((hitRow, index) => {
      const vibs = hitRow.vibrations || [0];
      const maxVib = Math.max(...vibs).toFixed(1);
      const avgVib = (vibs.reduce((a, b) => a + b, 0) / vibs.length).toFixed(1);
      const timeStr = formatTimeOfDay(hitRow.datetime);
      html += `
        <div id="record-card-${hitRow.id}" class="record-card" data-route-id="${hitRow.id}" style="background: #f8fafc; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
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

    html += `</div>`;
    container.innerHTML = html;

    container.querySelectorAll(".record-card").forEach(card => {
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        window.highlightRouteAndCard(card.dataset.routeId);
      });
    });

    setTimeout(() => { window.highlightRouteAndCard(row.id); }, 50);
  });
}

// ========================================
// 8. データ取得と初期化
// ========================================
async function loadPublicMapData() {
  const statusMsg = document.querySelector("#status-msg");
  const gasUrl = "https://script.google.com/macros/s/AKfycbwIuSdqZ5mR57buHEcBx-Mz9HPgG0OLEJAfVSP5ubV9Rk3g6LBVtFyTEXf-9wkU2InE-A/exec";
  
  try {
    if(statusMsg) statusMsg.textContent = "⏳ データを読み込み中...";
    const response = await fetch(gasUrl);
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      if(statusMsg) statusMsg.textContent = "📭 データがありません";
      return;
    }
    
    window.allRawData = data.map((row, index) => {
      let positions = row.positions || [];
      let vibrations = [];
      const rawNmea = row.nmeaText || row.rawText;
      if (rawNmea) {
        const parsed = parseNmeaWithVib(rawNmea);
        if (parsed.points.length > 0) { positions = parsed.points; vibrations = parsed.vibs; }
      }
      if (vibrations.length === 0) vibrations = positions.map(() => 0.0);
      return { ...row, id: "route_" + index, positions: positions, vibrations: vibrations };
    });
    
    if(statusMsg) statusMsg.textContent = `✅ ${data.length}件のデータをロードしました`;
    renderPublicMap();
    
    let allBounds = [];
    window.allRawData.forEach(row => { if (row.positions) row.positions.forEach(pt => allBounds.push(pt)); });
    
    if (allBounds.length > 0) { window.michiMap.fitBounds(L.latLngBounds(allBounds), { padding: [40, 40] }); } 
  } catch (err) {
    console.error(err);
    if(statusMsg) statusMsg.textContent = "❌ 読み込み失敗";
  }
}

document.querySelectorAll(".filter-cb").forEach(cb => cb.addEventListener("change", renderPublicMap));
const colorModeSelect = document.getElementById("color-mode-select");
if (colorModeSelect) colorModeSelect.addEventListener("change", renderPublicMap);

loadPublicMapData();

// ========================================
// 9. 左パネル（表示設定）の完全無欠な折りたたみ機能
// ========================================
function setupLeftPanel() {
  let panel = document.querySelector(".bottom-left-panel"); 
  if (!panel) {
    const colorSelect = document.getElementById("color-mode-select");
    if (colorSelect) panel = colorSelect.closest('.bottom-left-panel, div[style*="border"], div[style*="shadow"], .leaflet-control');
  }

  if (panel && !panel.dataset.setupDone) {
    const titleEl = panel.firstElementChild;
    
    if (titleEl) {
      titleEl.style.display = "flex";
      titleEl.style.justifyContent = "space-between";
      titleEl.style.alignItems = "center";
      
      const minBtn = document.createElement("button");
      minBtn.innerHTML = "➖";
      minBtn.style.cssText = "background: transparent !important; border: none !important; font-size: 16px !important; cursor: pointer; color: #64748b; margin-left: 10px; padding: 4px;";
      minBtn.title = "最小化 / 展開";
      
      minBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        panel.classList.toggle("minimized");
        const isMin = panel.classList.contains("minimized");
        minBtn.innerHTML = isMin ? "＋" : "➖";
        
        Array.from(panel.children).forEach(child => {
          if (child !== titleEl) {
            child.style.display = isMin ? "none" : "";
          }
        });
      });
      
      titleEl.appendChild(minBtn);
      panel.dataset.setupDone = "true"; 
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupLeftPanel);
} else {
  setupLeftPanel();
}
setTimeout(setupLeftPanel, 500);
setTimeout(setupLeftPanel, 1500);
