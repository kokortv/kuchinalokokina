// Конфигурация
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwnYgcqblQvBndki0gHKblM2LFdV658QqekE7f3BkRkmUI8oUX7KK4emtwWhfs8Cw/exec';
const STORAGE_KEY_MAGAZINS = 'kl_shops';
const STORAGE_KEY_QUEUE = 'kl_queue';
const MAX_DISTANCE_METERS = 50; // радиус, в котором считаем, что это тот же магазин

// DOM элементы
const statusDiv = document.getElementById('status');
const detectedShopDiv = document.getElementById('detectedShop');
const shopInput = document.getElementById('shopInput');
const changeShopBtn = document.getElementById('changeShopBtn');
const photo = document.getElementById('photo');
const photoInput = document.getElementById('photoInput');
const takePhotoBtn = document.getElementById('takePhotoBtn');
const originalName = document.getElementById('originalName');
const translatedName = document.getElementById('translatedName');
const currency = document.getElementById('currency');
const price = document.getElementById('price');
const discount = document.getElementById('discount');
const barcode = document.getElementById('barcode');
const saveBtn = document.getElementById('saveBtn');
const loadHistoryBtn = document.getElementById('loadHistoryBtn');
const historyList = document.getElementById('historyList');

let currentPhotoData = null; // base64
let currentShop = { name: '', lat: null, lng: null };

// Вспомогательные функции
function setStatus(msg, type = 'info') {
    statusDiv.innerHTML = `<div class="status ${type}">${msg}</div>`;
    setTimeout(() => statusDiv.innerHTML = '', 4000);
}

function getShops() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_MAGAZINS) || '[]');
}
function saveShops(shops) {
    localStorage.setItem(STORAGE_KEY_MAGAZINS, JSON.stringify(shops));
}

// Определение магазина по координатам
function findNearestShop(lat, lng) {
    const shops = getShops();
    let minDist = Infinity, best = null;
    shops.forEach(shop => {
        const d = Math.sqrt(Math.pow(lat - shop.lat, 2) + Math.pow(lng - shop.lng, 2)) * 111000; // грубо в метрах
        if (d < minDist && d < MAX_DISTANCE_METERS) {
            minDist = d;
            best = shop;
        }
    });
    return best;
}

// Инициализация геолокации
function initLocation() {
    if (!navigator.geolocation) {
        setStatus('Геолокация не поддерживается', 'error');
        detectedShopDiv.textContent = 'Включи геолокацию или введи вручную';
        return;
    }
    navigator.geolocation.getCurrentPosition(
        pos => {
            currentShop.lat = pos.coords.latitude;
            currentShop.lng = pos.coords.longitude;
            const known = findNearestShop(currentShop.lat, currentShop.lng);
            if (known) {
                currentShop.name = known.name;
                detectedShopDiv.textContent = known.name;
                shopInput.style.display = 'none';
            } else {
                detectedShopDiv.textContent = 'Новый магазин';
                shopInput.style.display = 'block';
                shopInput.placeholder = 'Введи название';
                shopInput.value = '';
                currentShop.name = '';
            }
        },
        err => {
            setStatus('Не удалось получить геолокацию: ' + err.message, 'error');
            shopInput.style.display = 'block';
        }
    );
}

changeShopBtn.addEventListener('click', () => {
    shopInput.style.display = 'block';
    shopInput.value = currentShop.name || '';
    shopInput.focus();
});

shopInput.addEventListener('change', () => {
    currentShop.name = shopInput.value.trim();
    if (currentShop.name && currentShop.lat && currentShop.lng) {
        const shops = getShops();
        // обновим или добавим
        const idx = shops.findIndex(s => s.lat === currentShop.lat && s.lng === currentShop.lng);
        if (idx >= 0) shops[idx].name = currentShop.name;
        else shops.push({ name: currentShop.name, lat: currentShop.lat, lng: currentShop.lng });
        saveShops(shops);
        detectedShopDiv.textContent = currentShop.name;
        shopInput.style.display = 'none';
        setStatus('Магазин сохранён', 'success');
    }
});

// Работа с камерой
takePhotoBtn.addEventListener('click', () => {
    photoInput.click();
});

photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        photo.src = reader.result;
        photo.style.display = 'block';
        currentPhotoData = reader.result.split(',')[1]; // только base64 часть
    };
    reader.readAsDataURL(file);
});

// Сохранение записи
saveBtn.addEventListener('click', async () => {
    if (!currentShop.name) {
        alert('Укажи магазин!');
        return;
    }
    if (!originalName.value.trim() || !price.value) {
        alert('Введи хотя бы название и цену!');
        return;
    }

    const entry = {
        shop: currentShop.name,
        lat: currentShop.lat,
        lng: currentShop.lng,
        originalName: originalName.value.trim(),
        translatedName: translatedName.value.trim(),
        currency: currency.value,
        price: parseFloat(price.value),
        discount: discount.value.trim(),
        barcode: barcode.value.trim(),
        photo: currentPhotoData,
        timestamp: new Date().toISOString()
    };

    try {
        await sendEntry(entry);
        // очистка формы (кроме магазина)
        originalName.value = '';
        translatedName.value = '';
        price.value = '';
        discount.value = '';
        barcode.value = '';
        photo.style.display = 'none';
        currentPhotoData = null;
        setStatus('Улитка запомнила цену 🐌', 'success');
    } catch (e) {
        // офлайн – сохраняем в очередь
        const queue = JSON.parse(localStorage.getItem(STORAGE_KEY_QUEUE) || '[]');
        queue.push(entry);
        localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(queue));
        setStatus('Нет интернета. Сохранено локально, отправим при подключении.', 'info');
    }
});

async function sendEntry(entry, retry = true) {
    const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify(entry),
        headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Ошибка отправки');
    return response.json();
}

// Офлайн-синхронизация
async function syncQueue() {
    const queue = JSON.parse(localStorage.getItem(STORAGE_KEY_QUEUE) || '[]');
    if (queue.length === 0) return;
    setStatus(`Отправляю ${queue.length} отложенных записей...`, 'info');
    const newQueue = [];
    for (const entry of queue) {
        try {
            await sendEntry(entry, false);
        } catch {
            newQueue.push(entry);
        }
    }
    localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(newQueue));
    setStatus(`Синхронизировано. Осталось: ${newQueue.length}`, 'success');
}

window.addEventListener('online', syncQueue);
// при загрузке тоже пробуем
syncQueue();

// Загрузка истории (пока простой GET, нужно будет добавить в Apps Script)
loadHistoryBtn.addEventListener('click', async () => {
    try {
        const resp = await fetch(APPS_SCRIPT_URL + '?action=history');
        const data = await resp.json();
        historyList.innerHTML = data.map(r => `
            <div style="border-bottom:1px solid #eee; padding:8px 0;">
                <strong>${r.originalName}</strong> ${r.price} ${r.currency} в ${r.shop}<br>
                <small>${new Date(r.timestamp).toLocaleDateString()}</small>
            </div>
        `).join('');
    } catch {
        setStatus('Не удалось загрузить историю', 'error');
    }
});

// Старт
initLocation();
