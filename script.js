// 【重要】ここにGASでデプロイしたウェブアプリのURLを貼り付けてください
const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxbIXGAMIaBSBleAhebbp1v7BMg9mLQr_GX7Ri5GbYA-YIhv9Nn4gTqhugjWAvoQcDKhg/exec";

let map = null;
let markersMap = {};        // すべての車両ピンを保持 (A, B, C, D)
let watchId = null;         // GPS監視用ID
let sendIntervalId = null;  // GASへの30秒定期送信タイマー用ID
let fetchIntervalId = null; // 他車の位置情報取得タイマー用ID

// 最新の位置情報を一時保管するグローバル変数
let latestLocation = {
    lat: null,
    lng: null,
    timestamp: null
};

function initLeafletMap() {
    if (map) return;
    const defaultPos = [35.1549, 136.9669]; // 初期中心位置（名古屋大学付近）
    
    map = L.map('map-canvas', {
        zoomControl: false,
        attributionControl: false
    }).setView(defaultPos, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);
}

// 最終更新日時からの相対時間を算出する関数
function getRelativeTimeString(dateString) {
    if (!dateString) return "データなし";
    const past = new Date(dateString);
    const now = new Date();
    const diffMs = now - past;
    
    if (isNaN(diffMs)) return "不明";
    
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}秒前`;
    
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分前`;
    
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}時間前`;
    
    return `${Math.floor(diffHour / 24)}日前`;
}

document.addEventListener('DOMContentLoaded', () => {
    const screenSelect = document.getElementById('screen-select');
    const screenMap = document.getElementById('screen-map');
    const vehicleButtons = document.querySelectorAll('.vehicle-btn');
    const btnBack = document.getElementById('btn-back');
    const btnStop = document.getElementById('btn-stop');
    const btnViewOnly = document.getElementById('btn-view-only');

    const selectedAvatar = document.getElementById('selected-avatar');
    const selectedName = document.getElementById('selected-name');
    const statusInfoArea = document.getElementById('sheet-status-info');
    const bottomSheet = document.getElementById('bottom-sheet');
    const dragHandle = document.getElementById('drag-handle');

    let selectedVehicle = null;
    let isViewMode = false;
    let mySessionId = null; 

    const colorHex = { blue: '#2f3e8f', red: '#a41d37', orange: '#d19520', green: '#0a6b41' };

    // --- 1. 車両選択（運行モード起動） ---
    vehicleButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const vehicleId = button.getAttribute('data-id');
            const vehicleName = button.querySelector('.name').textContent;
            const colorClass = button.getAttribute('data-color');
            
            selectedVehicle = { id: vehicleId, name: vehicleName, color: colorClass };
            isViewMode = false;
            
            mySessionId = Math.random().toString(36).substring(2, 15);

            // GPS一時保管場所を初期化
            latestLocation = { lat: null, lng: null, timestamp: null };

            try {
                const res = await fetch(GAS_WEBAPP_URL, {
                    method: "POST",
                    body: JSON.stringify({
                        type: "login",
                        vehicle_id: selectedVehicle.id,
                        session_id: mySessionId
                    })
                });
                const result = await res.json();
                
                if (result.status === "success") {
                    openMapScreen();
                    
                    // A. 高精度GPS監視をスタート（位置情報を常に最新化）
                    startLocationTracking(); 
                    
                    // B. GASへの【30秒強制定期送信】タイマーを起動
                    sendIntervalId = setInterval(sendLocationToGAS, 30000);
                    
                    // C. 他車の位置を取得・表示するタイマー（30秒ごと）を起動
                    fetchAndDisplayAllVehicles();
                    fetchIntervalId = setInterval(fetchAndDisplayAllVehicles, 30000);
                } else {
                    alert("ログインに失敗しました: " + result.message);
                }
            } catch (err) {
                console.error(err);
                alert("サーバーとの通信に失敗しました。URLを確認してください。");
            }
        });
    });

    // 位置を閲覧（マルチ追跡モード）
    btnViewOnly.addEventListener('click', () => {
        isViewMode = true;
        selectedVehicle = null;
        openMapScreen();
        
        fetchAndDisplayAllVehicles(); // 初回ロード
        // 30秒ごとに他車の位置データを取得・投影
        fetchIntervalId = setInterval(fetchAndDisplayAllVehicles, 30000);
    });

    btnBack.addEventListener('click', () => {
        stopLocationTracking();
        screenMap.classList.remove('active');
        screenSelect.classList.add('active');
    });

    function openMapScreen() {
        screenSelect.classList.remove('active');
        screenMap.classList.add('active');
        bottomSheet.classList.remove('collapsed');

        if (isViewMode) {
            statusInfoArea.style.display = 'none';    
            btnStop.style.display = 'none';           
            dragHandle.style.visibility = 'hidden';   
        } else {
            statusInfoArea.style.display = 'flex';    
            btnStop.style.display = 'block';          
            dragHandle.style.visibility = 'visible';  
            selectedAvatar.textContent = selectedVehicle.id;
            selectedAvatar.className = `avatar ${selectedVehicle.color}`;
            selectedName.textContent = selectedVehicle.name;
        }

        initLeafletMap();
        setTimeout(() => { if (map) map.invalidateSize(); }, 100);
    }

    // --- 2. 運行モード：位置情報の常時監視（保管のみ） ---
    function startLocationTracking() {
        if (!navigator.geolocation) return;

        watchId = navigator.geolocation.watchPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                // メモリに最新座標をプール（送信はここでは行わない）
                latestLocation.lat = lat;
                latestLocation.lng = lng;
                latestLocation.timestamp = new Date();
                
                // 自分のピンのみ地図に即時反映
                updateMyPinOnMap(lat, lng, selectedVehicle.color, selectedVehicle.id);
            },
            (error) => { 
                console.error("位置情報の取得に失敗:", error);
            },
            { 
                enableHighAccuracy: true, // 高精度GPS
                maximumAge: 0,            // キャッシュを利用せず常に最新の生データを要求
                timeout: 10000 
            }
        );
    }

    // --- 3. 運行モード：30秒に1回、強制的にGASへ座標を送る処理 ---
    async function sendLocationToGAS() {
        if (isViewMode || !selectedVehicle) return;

        // GPSデータがまだ一度も取得できていない場合は送信をスキップ
        if (latestLocation.lat === null || latestLocation.lng === null) {
            console.log("GPSデータがまだ取得できていないため、送信をスキップします。");
            return;
        }

        try {
            console.log(`[GAS送信] 座標を送信します: lat=${latestLocation.lat}, lng=${latestLocation.lng}`);
            const res = await fetch(GAS_WEBAPP_URL, {
                method: "POST",
                body: JSON.stringify({
                    type: "update",
                    vehicle_id: selectedVehicle.id,
                    session_id: mySessionId,
                    lat: latestLocation.lat,
                    lng: latestLocation.lng
                })
            });
            const result = await res.json();
            
            if (result.status === "logout") {
                alert(result.message);
                btnBack.click(); 
            }
        } catch (err) {
            console.warn("GASへの30秒定期送信に失敗しました:", err);
        }
    }

    // --- 4. 閲覧/運行モード共通：他車の最新位置情報を一括同期して描画 ---
    async function fetchAndDisplayAllVehicles() {
        try {
            const res = await fetch(GAS_WEBAPP_URL);
            const vehicles = await res.json();
            
            const colorMap = { A: 'blue', B: 'red', C: 'orange', D: 'green' };
            let bounds = []; 

            vehicles.forEach(v => {
                if (!v.lat || !v.lng) return;
                
                // 運行モード中の「自分自身のピン」は、watchPosition側で超高精度（ほぼリアルタイム）に描画するため、ここでの上書き描画をスキップします
                if (!isViewMode && selectedVehicle && v.vehicle_id === selectedVehicle.id) {
                    return; 
                }

                const lat = parseFloat(v.lat);
                const lng = parseFloat(v.lng);
                const newPos = [lat, lng];
                bounds.push(newPos);

                const colorClass = colorMap[v.vehicle_id] || 'blue';
                const relativeTime = getRelativeTimeString(v.updated_at);

                const customIcon = L.divIcon({
                    className: 'custom-map-pin',
                    html: `<div style="width: 34px; height: 34px; background-color: ${colorHex[colorClass]}; border-radius: 50%; border: 2px solid white; color: white; font-weight: bold; display: flex; justify-content: center; align-items: center; box-shadow: 0 2px 5px rgba(0,0,0,0.3); font-size: 14px;">${v.vehicle_id}</div>`,
                    iconSize: [34, 34],
                    iconAnchor: [17, 17]
                });

                if (markersMap[v.vehicle_id]) {
                    markersMap[v.vehicle_id].setLatLng(newPos);
                    markersMap[v.vehicle_id].setTooltipContent(`最終更新: ${relativeTime}`);
                } else {
                    const marker = L.marker(newPos, { icon: customIcon }).addTo(map);
                    marker.bindTooltip(`最終更新: ${relativeTime}`, {
                        permanent: false, 
                        direction: 'top',
                        className: 'custom-tooltip',
                        offset: [0, -10]
                    });
                    markersMap[v.vehicle_id] = marker;
                }
            });

            if (isViewMode && bounds.length > 0 && map) {
                if (bounds.length === 1) {
                    map.panTo(bounds[0]);
                } else {
                    map.fitBounds(bounds, { padding: [50, 50] });
                }
            }
        } catch (err) {
            console.error("全車両位置の取得失敗:", err);
        }
    }

    // 運行モード：自分専用のピン描画（滑らかな更新用）
    function updateMyPinOnMap(lat, lng, colorClass, labelId) {
        if (!map) return;
        const newPos = [lat, lng];
        map.panTo(newPos); 

        const customIcon = L.divIcon({
            className: 'custom-map-pin',
            html: `<div style="width: 38px; height: 38px; background-color: ${colorHex[colorClass]}; border-radius: 50%; border: 3px solid #fff; color: white; font-weight: bold; display: flex; justify-content: center; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.4); font-size: 16px;">${labelId}</div>`,
            iconSize: [38, 38],
            iconAnchor: [19, 19]
        });

        if (markersMap[labelId]) {
            markersMap[labelId].setLatLng(newPos);
            markersMap[labelId].setIcon(customIcon);
            markersMap[labelId].setTooltipContent("あなたの現在地(配信中)");
        } else {
            const marker = L.marker(newPos, { icon: customIcon }).addTo(map);
            marker.bindTooltip("あなたの現在地(配信中)", {
                permanent: false,
                direction: 'top',
                className: 'custom-tooltip',
                offset: [0, -10]
            });
            markersMap[labelId] = marker;
        }
    }

    // すべてのタイマーとお片付け
    function stopLocationTracking() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (sendIntervalId !== null) {
            clearInterval(sendIntervalId);
            sendIntervalId = null;
        }
        if (fetchIntervalId !== null) {
            clearInterval(fetchIntervalId);
            fetchIntervalId = null;
        }
        Object.keys(markersMap).forEach(key => {
            map.removeLayer(markersMap[key]);
        });
        markersMap = {};
    }

    // --- 5. ボトムシートドラッグロジック ---
    let startY = 0; let isDragging = false;
    const startDrag = (e) => { if (isViewMode) return; isDragging = true; startY = e.touches ? e.touches[0].clientY : e.clientY; };
    const onDrag = (e) => {
        if (!isDragging || isViewMode) return;
        const currentY = e.touches ? e.touches[0].clientY : e.clientY;
        const diffY = currentY - startY;
        if (diffY > 50) { bottomSheet.classList.add('collapsed'); isDragging = false; }
        else if (diffY < -50) { bottomSheet.classList.remove('collapsed'); isDragging = false; }
    };
    dragHandle.addEventListener('mousedown', startDrag); window.addEventListener('mousemove', onDrag); window.addEventListener('mouseup', () => isDragging = false);
    dragHandle.addEventListener('touchstart', startDrag, { passive: true }); window.addEventListener('touchmove', onDrag, { passive: true }); window.addEventListener('touchend', () => isDragging = false);
    dragHandle.addEventListener('click', () => { if (!isViewMode) bottomSheet.classList.toggle('collapsed'); });
});