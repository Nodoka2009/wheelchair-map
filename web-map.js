// ========================================
// 1. スタイル（CSS）の追加
// ========================================
// ※ 重複エラーを防ぐため var を使用するか、すでに存在するかチェックします
if (!document.getElementById("custom-map-styles")) {
  const style = document.createElement('style');
  style.id = "custom-map-styles";
  style.innerHTML = `
    .record-card { border: 2px solid transparent; cursor: pointer; transition: all 0.2s ease; }
    .record-card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .record-card.highlighted { border-color: #3b82f6 !important; background-color: #eff6ff !important; box-shadow: 0 0 0 2px rgba(59,130,246,0.3); }
    .route-selected-glow { pointer-events: none; }

    /* ルート詳細のスクロール設定（約2件分の高さ） */
    #route-cards-wrapper { max-height: 290px; overflow-y: auto; padding-right: 6px; }
    #route-cards-wrapper::-webkit-scrollbar { width: 6px; }
    #route-cards-wrapper::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }

    /* 右パネル（ルート詳細）の最小化設定 */
    #info-panel.minimized #route-info-container { display: none !important; }
    #minimize-panel-btn { background: transparent; border: none; font-size: 14px; cursor: pointer; color: #64748b; margin-right: 12px; }
    #minimize-panel-btn:hover { color: #0f172a; }

    /* ★ 修正：左パネル（表示設定）の最小化設定（お友達の提案を反映） */
    .panel-minimize-btn { background: transparent; border: none; font-size: 14px; cursor: pointer; color: #64748b; }
    .panel-minimize-btn:hover { color: #0f172a; }
    .details-panel.minimized > div { display: none !important; }
    .details-panel.minimized h2 { margin-bottom: 0 !important; border-bottom: none !important; padding-bottom: 0 !important; }
  `;
  document.head.appendChild(style);
}

// ========================================
// 2. 地図の初期化（重複エラー回避）
// ========================================
// 既に map が定義されている場合は新しく作らず、既存のものを使う
if (!window.mapInstance) {
  window.mapInstance = L.map("map", { zoomControl: false }).setView([34.6937, 135.5022], 13);

  const stdMap = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: '© OpenStreetMap contributors © CARTO',
  });

  const satelliteMap = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 20,
    maxNativeZoom: 19,
    attribution: 'Tiles © Esri'
  });

  stdMap.addTo(window.mapInstance);

  const baseMaps = {
    "🗺️ 標準マップ": stdMap,
    "🛰️ 航空写真": satelliteMap
  };

  L.control.zoom({ position: 'bottomright' }).addTo(window.mapInstance);
  L.control.layers(baseMaps, null, { position: 'bottomright' }).addTo(window.mapInstance);
}

// ========================================
// 3. 検索機能
// ========================================
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');

if (searchInput && searchBtn && !window.searchEventAdded) {
  const doSearch = async () => {
    const query = searchInput.value.trim();
    if (!query) return;
    
    searchBtn.innerHTML = '⏳';
    try {
      const url = `
