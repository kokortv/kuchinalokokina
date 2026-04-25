// Вставь сюда URL своего веб-приложения (заканчивается на /exec)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwnYgcqblQvBndki0gHKblM2LFdV658QqekE7f3BkRkmUI8oUX7KK4emtwWhfs8Cw/exec';

// Локальное хранилище
const STORAGE_KEY_SHOPS = 'kl_shops';
const STORAGE_KEY_QUEUE = 'kl_queue';
const SHOP_RADIUS = 50; // метров

// DOM
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

let currentPhotoData = null; // base64, пока не используется в GET, но оставим
let currentShop = { name: '', lat: null, lng: null };

// Уведомления
function setStatus(msg, type = 'info') {
  statusDiv.innerHTML = `<div class="status ${type}">${msg}</div>`;
  setTimeout(() => { statusDiv.innerHTML = ''; }, 4000);
}

// Работа с магазинами
function loadShops() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY_SHOPS) || '[]');
}
function saveShops(shops) {
  localStorage.setItem(STORAGE_KEY_SHOPS, JSON.stringify(shops));
}

function findNearestShop(lat, lng) {
  const shops = loadShops();
  let minDist = Infinity, best = null;
  shops.forEach(shop => {
    // грубое расстояние в метрах
    const d = Math.sqrt(Math.pow(lat - shop.lat, 2) + Math.pow(lng - shop.lng, 2)) * 111000;
    if (d < minDist && d < SHOP_RADIUS) {
      minDist = d;
      best = shop;
    }
  });
  return best;
}

// Инициализация геолокации
function initLocation() {
  if (!navigator.geolocation) {
    detectedShopDiv.textContent = 'Геолокация не поддерживается';
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
    const shops = loadShops();
    const idx = shops.findIndex(s => s.lat === currentShop.lat && s.lng === currentShop.lng);
    if (idx >= 0) shops[idx].name = currentShop.name;
    else shops.push({ name: currentShop.name, lat: currentShop.lat, lng: currentShop.lng });
    saveShops(shops);
    detectedShopDiv.textContent = currentShop.name;
    shopInput.style.display = 'none';
    setStatus('Магазин сохранен', 'success');
  }
});

// Фото
takePhotoBtn.addEventListener('click', () => { photoInput.click(); });
photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    photo.src = reader.result;
    photo.style.display = 'block';
    currentPhotoData = reader.result.split(',')[1]; // base64 для будущего использования
  };
  reader.readAsDataURL(file);
});

// Отправка записи через GET (без CORS-блокировки)
async function sendEntry(entry) {
  const params = new URLSearchParams({
    action: 'save',
    shop: entry.shop,
    lat: entry.lat,
    lng: entry.lng,
    originalName: entry.originalName,
    translatedName: entry.translatedName,
    currency: entry.currency,
    price: entry.price,
    discount: entry.discount,
    barcode: entry.barcode,
    // фото пока не передаём, чтобы не перегружать URL
  });
  const url = APPS_SCRIPT_URL + '?' + params.toString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Сервер ответил с ошибкой: ' + response.status);
  }
  const data = await response.json();
  if (data.status === 'error') {
    throw new Error(data.message);
  }
  return data; // {status: 'ok'}
}

// Очередь для офлайна
function queueEntry(entry) {
  const queue = JSON.parse(localStorage.getItem(STORAGE_KEY_QUEUE) || '[]');
  queue.push(entry);
  localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(queue));
}

// Синхронизация очереди
async function syncQueue() {
  const queue = JSON.parse(localStorage.getItem(STORAGE_KEY_QUEUE) || '[]');
  if (queue.length === 0) return;
  setStatus(`Отправляю ${queue.length} записей...`, 'info');
  const remaining = [];
  for (const entry of queue) {
    try {
      await sendEntry(entry);
      // успешно – не добавляем в remaining
    } catch (e) {
      remaining.push(entry);
    }
  }
  localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(remaining));
  if (remaining.length === 0) {
    setStatus('Все данные синхронизированы 👍', 'success');
  } else {
    setStatus(`Не удалось отправить ${remaining.length} записей. Попробуем позже.`, 'info');
  }
}

// Кнопка «Сохранить»
saveBtn.addEventListener('click', async () => {
  if (!currentShop.name) {
    alert('Укажи магазин!');
    return;
  }
  if (!originalName.value.trim() || !price.value) {
    alert('Введи хотя бы название и цену');
    return;
  }

  const entry = {
    shop: currentShop.name,
    lat: currentShop.lat,
    lng: currentShop.lng,
    originalName: originalName.value.trim(),
    translatedName: translatedName.value.trim(),
    currency: currency.value,
    price: price.value,
    discount: discount.value.trim(),
    barcode: barcode.value.trim()
    // photo не включаем в GET-версию
  };

  try {
    await sendEntry(entry);
    // очистка формы
    originalName.value = '';
    translatedName.value = '';
    price.value = '';
    discount.value = '';
    barcode.value = '';
    photo.style.display = 'none';
    currentPhotoData = null;
    setStatus('Улитка запомнила цену 🐌', 'success');
  } catch (e) {
    // Если ошибка (сеть или сервер), ставим в очередь
    queueEntry(entry);
    setStatus('Нет интернета. Сохранено локально, отправим позже.', 'info');
  }
});

// Загрузка истории (GET)
loadHistoryBtn.addEventListener('click', async () => {
  try {
    const resp = await fetch(APPS_SCRIPT_URL + '?action=history');
    const data = await resp.json();
    if (data.status === 'error') {
      historyList.innerHTML = `<p>Ошибка: ${data.message}</p>`;
      return;
    }
    historyList.innerHTML = data.map(r => `
      <div style="border-bottom:1px solid #eee; padding:8px 0;">
        <strong>${r.originalName}</strong> ${r.price} ${r.currency} в ${r.shop}<br>
        <small>${new Date(r.timestamp).toLocaleString()}</small>
      </div>
    `).join('');
  } catch {
    setStatus('Не удалось загрузить историю', 'error');
  }
});

// Автосинхронизация при загрузке и при восстановлении сети
syncQueue();
window.addEventListener('online', syncQueue);

// Старт
initLocation();
