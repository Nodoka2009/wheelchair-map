// ========================================
// みんなのバリアフリーマップ
// ========================================


// ========================================
// ① 地図を作る
// ========================================

const map = L.map("map").setView(
    [34.6937, 135.5022],
    13
);


// 地図タイル
L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
        maxZoom: 20,
        attribution:
            '&copy; OpenStreetMap contributors &copy; CARTO'
    }
).addTo(map);


// ルートを入れるレイヤー
const routeLayer = L.layerGroup().addTo(map);


// ========================================
// ② 距離を計算
// ========================================

function getDistanceMeters(lat1, lon1, lat2, lon2) {

    const R = 6371000;

    const dLat =
        (lat2 - lat1) * Math.PI / 180;

    const dLon =
        (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    return R *
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );
}


// ========================================
// ③ NMEA → 緯度経度
// ========================================

function nmeaToDecimal(value, direction) {

    if (!value || value.indexOf(".") < 2) {
        return null;
    }

    const dotIndex = value.indexOf(".");

    const degrees =
        Number(value.slice(0, dotIndex - 2));

    const minutes =
        Number(value.slice(dotIndex - 2));

    if (
        Number.isNaN(degrees) ||
        Number.isNaN(minutes)
    ) {
        return null;
    }

    let decimal =
        degrees + minutes / 60;

    if (
        direction === "S" ||
        direction === "W"
    ) {
        decimal *= -1;
    }

    return decimal;
}


// ========================================
// ④ GGAを解析
// ========================================

function parseGgaLines(text) {

    if (!text) {
        return {
            points: [],
            lineCount: 0
        };
    }

    const lines =
        text.trim().split(/\r?\n/);

    const points = [];

    let firstUtcTime = "";


    for (const line of lines) {

        const trimmed = line.trim();

        // GGAだけを見る
        if (!trimmed.includes("GGA")) {
            continue;
        }

        const fields =
            trimmed.split(",");


        /*
         * GGA
         *
         * [1] UTC
         * [2] 緯度
         * [3] N/S
         * [4] 経度
         * [5] E/W
         * [6] 測位品質
         */

        const rawLat = fields[2];
        const latDir = fields[3];

        const rawLng = fields[4];
        const lngDir = fields[5];

        const fixQuality = fields[6];


        // 測位できていないデータは無視
        if (
            !rawLat ||
            !rawLng ||
            !latDir ||
            !lngDir ||
            fixQuality === undefined ||
            fixQuality === "0"
        ) {
            continue;
        }


        const lat =
            nmeaToDecimal(
                rawLat,
                latDir
            );

        const lng =
            nmeaToDecimal(
                rawLng,
                lngDir
            );


        if (
            lat === null ||
            lng === null
        ) {
            continue;
        }


        // 日本周辺だけ採用
        if (
            lat < 20 ||
            lat > 46 ||
            lng < 122 ||
            lng > 154
        ) {
            continue;
        }


        if (!firstUtcTime) {
            firstUtcTime = fields[1] || "";
        }


        points.push([
            lat,
            lng
        ]);
    }


    return {
        points,
        lineCount: lines.length,
        firstUtcTime
    };
}


// ========================================
// ⑤ ルート情報を右側に表示
// ========================================

function showRouteInfo(row, points) {

    document.querySelector("#empty-message").style.display =
        "none";


    document.querySelector("#info-filename").textContent =
        row.fileName || "-";


    document.querySelector("#info-datetime").textContent =
        row.datetime || "-";


    document.querySelector("#info-weather").textContent =
        row.weather || "-";


    document.querySelector("#info-wheelchair").textContent =
        row.wheelchair || "-";


    document.querySelector("#info-assistance").textContent =
        row.assistance || "-";


    document.querySelector("#info-memo").textContent =
        row.memo || "クラウド共有データ";


    // 距離計算
    let totalDistance = 0;


    for (
        let i = 1;
        i < points.length;
        i++
    ) {

        totalDistance +=
            getDistanceMeters(
                points[i - 1][0],
                points[i - 1][1],
                points[i][0],
                points[i][1]
            );
    }


    let distanceText;


    if (totalDistance >= 1000) {

        distanceText =
            (totalDistance / 1000).toFixed(2)
            + " km";

    } else {

        distanceText =
            Math.round(totalDistance)
            + " m";
    }


    document.querySelector("#info-distance").textContent =
        distanceText;
}


// ========================================
// ⑥ 車いすの種類で色を変える
// ========================================

function getRouteColor(wheelchair) {

    // 電動
    if (
        wheelchair &&
        wheelchair.includes("電動")
    ) {
        return "#3b82f6";
    }


    // 自走式
    if (
        wheelchair &&
        wheelchair.includes("自走")
    ) {
        return "#22c55e";
    }


    // 介助用
    if (
        wheelchair &&
        wheelchair.includes("介助")
    ) {
        return "#a855f7";
    }


    // その他
    return "#64748b";
}


// ========================================
// ⑦ GASからデータを取得
// ========================================

async function loadPublicMapData() {

    const statusMsg =
        document.querySelector("#status-msg");


    // ★ あなたのGAS URL
    const gasUrl =
        "https://script.google.com/macros/s/AKfycbx9HpFMSgmfeNU8A-MQM50LaJqEcubPo0w7G0lX-5iLAxjKYK5CNSeRnLeqACQkcgrzwQ/exec";


    try {

        statusMsg.textContent =
            "⏳ クラウドからデータを読み込み中...";


        const response =
            await fetch(gasUrl);


        // HTTPエラー
        if (!response.ok) {

            throw new Error(
                "HTTP error: " +
                response.status
            );
        }


        const data =
            await response.json();


        console.log(
            "GASから取得したデータ:",
            data
        );


        // GAS側でエラーが返された場合
        if (
            data &&
            !Array.isArray(data) &&
            data.error
        ) {

            throw new Error(
                data.error
            );
        }


        // 配列じゃない場合
        if (!Array.isArray(data)) {

            throw new Error(
                "GASから配列形式のJSONが返ってきていません"
            );
        }


        // データ0件
        if (data.length === 0) {

            statusMsg.textContent =
                "📭 まだ投稿されたデータがありません";

            return;
        }


        statusMsg.textContent =
            `✅ ${data.length}件のデータをロードしました`;


        routeLayer.clearLayers();


        const allBounds = [];


        // ========================================
        // 全データを処理
        // ========================================

        data.forEach((row, index) => {

            console.log(
                `データ ${index + 1}:`,
                row
            );


            if (!row.nmeaText) {

                console.warn(
                    "NMEAデータがありません:",
                    row
                );

                return;
            }


            const parsed =
                parseGgaLines(
                    row.nmeaText
                );


            console.log(
                `データ ${index + 1} の解析結果:`,
                parsed
            );


            // 座標がなければスキップ
            if (
                parsed.points.length === 0
            ) {

                console.warn(
                    "有効なGPS座標がありません:",
                    row.fileName
                );

                return;
            }


            // 色
            const color =
                getRouteColor(
                    row.wheelchair
                );


            // ルート
            const polyline =
                L.polyline(
                    parsed.points,
                    {
                        color: color,
                        weight: 5,
                        opacity: 0.8,
                        lineCap: "round",
                        lineJoin: "round"
                    }
                ).addTo(routeLayer);


            // ========================================
            // ルートクリック
            // ========================================

            polyline.on(
                "click",
                function () {

                    showRouteInfo(
                        row,
                        parsed.points
                    );


                    // 選択したルートを少し強調
                    routeLayer.eachLayer(
                        layer => {

                            if (
                                layer.setStyle
                            ) {

                                layer.setStyle({
                                    weight: 5,
                                    opacity: 0.8
                                });
                            }
                        }
                    );


                    polyline.setStyle({
                        weight: 8,
                        opacity: 1
                    });
                }
            );


            // 全体表示用
            parsed.points.forEach(
                point => {

                    allBounds.push(point);
                }
            );
        });


        // ========================================
        // 全ルートを画面に収める
        // ========================================

        if (allBounds.length > 0) {

            map.fitBounds(
                L.latLngBounds(allBounds),
                {
                    padding: [40, 40]
                }
            );

        } else {

            statusMsg.textContent =
                "⚠️ GPS座標を持つデータがありません";
        }

    } catch (error) {

        console.error(
            "データ取得エラー:",
            error
        );


        statusMsg.textContent =
            "❌ データの読み込みに失敗しました";


        // エラーを画面にも表示
        const errorMessage =
            document.createElement("div");


        errorMessage.style.cssText =
            `
            position: fixed;
            bottom: 20px;
            left: 20px;
            right: 20px;
            max-width: 700px;
            margin: auto;
            padding: 14px 18px;
            background: white;
            border: 1px solid #fecaca;
            border-radius: 10px;
            color: #991b1b;
            font-size: 13px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            z-index: 9999;
            `;


        errorMessage.textContent =
            "エラー: " +
            error.message;


        document.body.appendChild(
            errorMessage
        );
    }
}


// ========================================
// ⑧ 起動
// ========================================

loadPublicMapData();
