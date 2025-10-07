// --- Global Settings ---
const PROD_URL = 'ceo-production.up.railway.app'; // Залиште, якщо використовуєте Railway
const API_BASE_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : `https://${PROD_URL}`;
const WS_BASE_URL = window.location.hostname === 'localhost' ? 'ws://localhost:3001' : `wss://${PROD_URL}`;

// --- Global State ---
let appData = {
  currentUser: null,
  transactions: [],
  shopItems: [],
};
let cart = [];
let ws = null;
let html5QrCode = null;
let confirmedActionCallback = null;
let currentEditUserId = null;
let currentEditShopItemId = null;


// --- Helper Functions ---

/**
 * Perform a fetch request with JWT authorization.
 * @param {string} url - The URL to fetch.
 * @param {object} options - Fetch options (method, headers, body).
 * @returns {Promise<Response>} The fetch response.
 */
async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${API_BASE_URL}${url}`, { ...options, headers });
}

// --- WebSocket Logic ---

function initializeWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const token = localStorage.getItem('authToken');
  if (!token) return;

  ws = new WebSocket(WS_BASE_URL);

  ws.onopen = () => {
    console.log('WebSocket connected.');
    ws.send(JSON.stringify({ type: 'register', payload: { token } }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('WebSocket message received:', message);
    
    switch (message.type) {
        case 'full_update_required':
            // Server requests a full data refresh for this client
            if (document.getElementById('app-content')?.style.display === 'block') {
                loadInitialData();
            }
            break;
        case 'shop_update_required':
            // A global shop update happened
            if (document.getElementById('shopModal')?.style.display === 'flex') {
                loadInitialData(); // Reload all data which includes shop items
            }
            break;
        case 'admin_panel_update_required':
            // Admin panel data changed, refresh it
            if (document.getElementById('adminPanel')?.style.display === 'flex') {
                const activeSection = document.querySelector('.main-content .section.active');
                if (activeSection) showSection(activeSection.id);
            }
            break;
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected. Reconnecting...');
    setTimeout(initializeWebSocket, 5000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    ws.close();
  };
}

// --- Authentication ---

async function login() {
  const loginInput = document.getElementById('username').value.trim();
  const passwordInput = document.getElementById('password').value;
  
  try {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginInput, password: passwordInput })
    });
    const result = await response.json();

    if (response.ok && result.success && !result.isAdmin) {
      localStorage.setItem('authToken', result.token);
      await loadInitialData(); // Load data after successful login
      document.getElementById('login').style.display = 'none';
      document.getElementById('app-content').style.display = 'block';
      document.getElementById('menu').style.display = 'flex';
      document.getElementById('bottom-bar').style.display = 'flex';
      initializeWebSocket();
    } else {
      alert(result.message || 'Помилка входу. Перевірте дані.');
    }
  } catch (error) {
    alert('Не вдалося підключитися до сервера.');
  }
}

async function adminLogin() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: username, password })
        });
        const result = await response.json();
        if (response.ok && result.success && result.isAdmin) {
            localStorage.setItem('authToken', result.token);
            document.getElementById('login').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'flex';
            showSection('users');
            initializeWebSocket();
        } else {
            alert(result.message || 'Неправильні дані для входу або відсутні права адміністратора.');
        }
    } catch (error) {
        alert('Помилка підключення до сервера.');
    }
}

function logout() {
  localStorage.removeItem('authToken');
  if (ws) ws.close();
  window.location.reload();
}

function adminLogout() {
  logout();
}

// --- Initial Data Loading ---

async function loadInitialData() {
  try {
    const response = await fetchWithAuth('/api/app-data');
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) logout();
        return;
    }
    const data = await response.json();
    appData = data;
    cart = JSON.parse(localStorage.getItem(`cart_${appData.currentUser.id}`)) || [];
    updateAllDisplays();
  } catch (error) {
    console.error('Failed to load initial data:', error);
  }
}

// --- User Panel - UI Updates ---

function updateAllDisplays(){
  if (!appData.currentUser) return;
  const user = appData.currentUser;
  
  document.getElementById('greeting').textContent = `Вітаємо, ${user.full_name.split(' ')[1] || user.username}!`;
  document.getElementById('userName').textContent = user.full_name;
  
  const balanceValue = (user.balance || 0).toFixed(2);
  ['balance', 'balanceSendMoney', 'balanceShop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = balanceValue;
  });

  document.getElementById('cvvCode').textContent = "123"; // Static CVV
  updateTransactionHistoryDisplay();
  updateCartModalItemCount();
}

function updateTransactionHistoryDisplay() {
  const listDiv = document.getElementById('transactionList');
  if (!appData.transactions || appData.transactions.length === 0) {
    listDiv.innerHTML = '<p class="no-transactions">Транзакцій ще немає.</p>';
    return;
  }
  
  const grouped = appData.transactions.reduce((acc, t) => {
    const date = new Date(t.timestamp);
    const dateKey = date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(t);
    return acc;
  }, {});

  listDiv.innerHTML = Object.keys(grouped).map(dateKey => `
    <div class="transaction-date-group">${dateKey}</div>
    ${grouped[dateKey].map(t => {
        const isPositive = t.amount > 0;
        return `
            <div class="transaction-item">
                <div class="transaction-icon">${getTransactionIconByType(t.type)}</div>
                <div class="transaction-info">
                    <span class="transaction-action">${getTransactionTitle(t)}</span>
                    <span class="transaction-comment">${t.comment}</span>
                    <span class="transaction-time">${new Date(t.timestamp).toLocaleTimeString('uk-UA')}</span>
                </div>
                <span class="transaction-amount ${isPositive ? 'positive' : 'negative'}">
                    ${isPositive ? '+' : ''}${parseFloat(t.amount).toFixed(2)}
                </span>
            </div>
        `}).join('')}
  `).join('');
}

function getTransactionIconByType(type) {
    if (type.includes('transfer')) return '💸';
    if (type.includes('purchase')) return '🛍️';
    if (type.includes('admin')) return '⚙️';
    return '💳';
}

function getTransactionTitle(t) {
    if (t.type === 'transfer') return t.amount > 0 ? `Отримано від ${t.counterparty}` : `Переказ до ${t.counterparty}`;
    if (t.type === 'purchase') return 'Покупка в магазині';
    if (t.type === 'admin_adjustment') return t.amount > 0 ? 'Поповнення (адмін)' : 'Зняття (адмін)';
    return 'Операція';
}

// --- User Panel - Modals & Actions ---

const openModal = modalId => document.getElementById(modalId).style.display = 'flex';
const closeModal = modalId => document.getElementById(modalId).style.display = 'none';

function showSendMoney() {
    openModal('sendMoneyModal');
    document.getElementById('sendAmount').value = '';
    document.getElementById('sendTo').value = '';
    document.getElementById('qr-reader-results').style.display = 'none';
}

async function confirmSendMoney() {
    const amount = parseFloat(document.getElementById('sendAmount').value);
    const recipientFullName = document.getElementById('sendTo').value.trim();
    if (isNaN(amount) || amount <= 0) return alert('Введіть коректну суму.');
    if (!recipientFullName) return alert('Введіть ПІБ або логін отримувача.');

    document.getElementById('confirmMessage').textContent = `Надіслати ${amount.toFixed(2)} грн до ${recipientFullName}?`;
    confirmedActionCallback = async () => {
        try {
            const response = await fetchWithAuth('/api/transfer', {
                method: 'POST',
                body: JSON.stringify({ recipientFullName, amount, comment: 'Приватний переказ' }),
            });
            const result = await response.json();
            alert(result.message);
            if(response.ok) closeModal('sendMoneyModal');
        } catch (e) {
            alert('Помилка переказу.');
        }
    };
    openModal('confirmModal');
}

function showShop() {
    populateShopItems();
    openModal('shopModal');
    updateActiveNavButton('shop');
}

function populateShopItems(sortBy = 'default') {
    const shopGrid = document.getElementById('shopItems');
    let items = [...appData.shopItems];
    items.sort((a, b) => {
        if (sortBy === 'price-low') return (a.discount_price || a.price) - (b.discount_price || b.price);
        if (sortBy === 'price-high') return (b.discount_price || b.price) - (a.discount_price || a.price);
        return b.popularity - a.popularity;
    });

    shopGrid.innerHTML = items.length ? items.map(item => {
        const hasDiscount = item.discount_price && item.discount_price < item.price;
        const price = hasDiscount ? item.discount_price : item.price;
        return `
            <div class="shop-item-card" onclick="addItemToCart(${item.id}, 1)">
                <img src="${item.image || './logo.png'}" alt="${item.name}" class="shop-item-image">
                <h4 class="shop-item-name">${item.name}</h4>
                <div class="shop-item-price-container">
                    ${hasDiscount ? `<span class="shop-item-price-original">${item.price.toFixed(2)} грн</span>` : ''}
                    <span class="shop-item-price">${price.toFixed(2)} грн</span>
                </div>
                <button class="action-button add-to-cart-button">Додати</button>
            </div>`;
    }).join('') : '<p class="no-transactions">Товарів у магазині ще немає.</p>';
}

function sortShopItems() {
    populateShopItems(document.getElementById('shopSort').value);
}

function addItemToCart(id, quantity) {
    const itemData = appData.shopItems.find(i => i.id == id);
    if (itemData.quantity < quantity) return alert('Товар закінчився.');
    const existing = cart.find(i => i.id === id);
    if (existing) existing.quantity += quantity;
    else cart.push({ id, quantity });
    
    localStorage.setItem(`cart_${appData.currentUser.id}`, JSON.stringify(cart));
    updateCartModalItemCount();
    alert(`${itemData.name} додано до кошика!`);
}

function updateCartModalItemCount() {
    document.getElementById('cartCountModal').textContent = cart.reduce((s, i) => s + i.quantity, 0);
}

function showCart() {
    const cartDiv = document.getElementById('cartItems');
    if (cart.length === 0) {
        cartDiv.innerHTML = '<p class="no-transactions">Кошик порожній.</p>';
        document.querySelector('#cartModal .cart-summary').style.display = 'none';
        document.querySelector('#cartModal .form-group').style.display = 'none';
    } else {
        document.querySelector('#cartModal .cart-summary').style.display = 'block';
        document.querySelector('#cartModal .form-group').style.display = 'flex';
        let subtotal = 0;
        cartDiv.innerHTML = cart.map((cartItem, index) => {
            const itemData = appData.shopItems.find(i => i.id == cartItem.id);
            const price = itemData.discount_price || itemData.price;
            const itemTotal = price * cartItem.quantity;
            subtotal += itemTotal;
            return `<div class="cart-item-display">
                <img src="${itemData.image || './logo.png'}" class="cart-item-image">
                <div class="cart-item-info"><h4>${itemData.name}</h4><p>${cartItem.quantity} x ${price.toFixed(2)} = ${itemTotal.toFixed(2)} грн</p></div>
                <button class="action-button danger-button" onclick="removeCartItem(${index})">X</button>
            </div>`;
        }).join('');
        document.getElementById('cartSubtotal').textContent = subtotal.toFixed(2);
        document.getElementById('cartTotal').textContent = `Всього: ${subtotal.toFixed(2)} грн`;
    }
    openModal('cartModal');
}

function removeCartItem(index) {
    cart.splice(index, 1);
    localStorage.setItem(`cart_${appData.currentUser.id}`, JSON.stringify(cart));
    showCart(); // Re-render the cart
    updateCartModalItemCount();
}

function checkoutCart() {
    document.getElementById('confirmMessage').textContent = 'Підтвердити покупку?';
    confirmedActionCallback = async () => {
        try {
            const response = await fetchWithAuth('/api/purchase', {
                method: 'POST',
                body: JSON.stringify({ cart }),
            });
            const result = await response.json();
            alert(result.message);
            if (response.ok) {
                cart = [];
                localStorage.removeItem(`cart_${appData.currentUser.id}`);
                closeModal('cartModal');
            }
        } catch (e) {
            alert('Помилка покупки.');
        }
    };
    openModal('confirmModal');
}

function showPersonalInfo() {
    const user = appData.currentUser;
    document.getElementById('passportName').textContent = user.full_name;
    document.getElementById('passportDOB').textContent = user.dob || 'Не вказано';
    document.getElementById('passportTeam').textContent = user.team_name || 'Без команди';
    openModal('personalModal');
    updateActiveNavButton('personal');
}

function showEventHistoryModal() {
    const list = document.getElementById('eventHistoryList');
    const events = appData.transactions.filter(t => t.type === 'purchase' || t.type === 'transfer');
    if (events.length === 0) {
        list.innerHTML = '<p class="no-transactions">Історія порожня.</p>';
    } else {
        list.innerHTML = events.map(t => `
        <div class="event-item ${t.type}">
            <h4>${getTransactionTitle(t)}</h4>
            <p><strong>Сума:</strong> ${parseFloat(t.amount).toFixed(2)} грн</p>
            <p><strong>Дата:</strong> ${new Date(t.timestamp).toLocaleString('uk-UA')}</p>
        </div>
        `).join('');
    }
    openModal('eventHistoryModal');
}

function showQrCodeModal() {
    const qrContainer = document.getElementById('qrcode-display');
    qrContainer.innerHTML = '';
    const qr = qrcode(0, 'L');
    qr.addData(appData.currentUser.username); // ЗМІНЕНО з full_name на username
    qr.make();
    qrContainer.innerHTML = qr.createImgTag(6, 8);
    openModal('qrCodeModal');
}

function startQrScanner() {
    if (!html5QrCode) html5QrCode = new Html5Qrcode("qr-reader");
    stopQrScanner();
    document.getElementById('qr-reader-results').style.display = 'none';
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            stopQrScanner();
            document.getElementById('sendTo').value = decodedText;
            const resultsDiv = document.getElementById('qr-reader-results');
            resultsDiv.textContent = `✅ Знайдено: ${decodedText}.`;
            resultsDiv.style.display = 'block';
        },
        (errorMessage) => { /* ignore errors */ }
    ).catch(err => console.log('QR Scanner Error:', err));
}

function stopQrScanner() {
    if (html5QrCode && html5QrCode.getState() === 2) { // 2 is SCANNING state
        html5QrCode.stop().catch(err => console.log('Error stopping scanner', err));
    }
}

function executeConfirmedAction() {
    if (typeof confirmedActionCallback === 'function') {
        confirmedActionCallback();
    }
    closeModal('confirmModal');
}

function updateActiveNavButton(screenName) {
    const mapping = { 'main': 1, 'shop': 2, 'personal': 3 };
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.bottom-nav .nav-btn:nth-child(${mapping[screenName] || 1})`);
    if(btn) btn.classList.add('active');
}

function flipCard() { document.querySelector('.card').classList.toggle('flipped'); }
const showMainScreen = () => { document.querySelectorAll('.modal').forEach(m => closeModal(m.id)); updateActiveNavButton('main'); };

// --- Admin Panel ---

let adminData = { users: [], teams: [], shop: [] };

async function showSection(sectionId) {
    document.querySelectorAll('.main-content .section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.toggle('active', item.getAttribute('onclick').includes(sectionId)));
    
    switch (sectionId) {
        case 'users': await loadAdminUsers(); break;
        case 'teams': await loadAdminTeamsAndUsers(); break;
        case 'shop': await loadAdminShop(); break;
    }
}

async function loadAdminUsers() {
    const response = await fetchWithAuth('/api/admin/users');
    adminData.users = await response.json();
    const listDiv = document.getElementById('userList');
    listDiv.innerHTML = adminData.users.map(u => `
        <div class="data-item">
            <span>${u.full_name} (${u.username}) | Баланс: ${u.balance.toFixed(2)} грн | ${u.team_name || 'Без команди'} | ${u.is_blocked ? '🔴' : '🟢'}</span>
            <div class="button-group"><button onclick="openEditUserModal(${u.id})" class="styled-button action-btn warning">Редагувати</button></div>
        </div>`).join('');
}

async function createUser() {
    const user = {
        fullName: document.getElementById('newFullName').value,
        username: document.getElementById('newUsername').value,
        password: document.getElementById('newPassword').value,
        balance: document.getElementById('newBalance').value,
        dob: document.getElementById('newDob').value,
    };
    const response = await fetchWithAuth('/api/admin/users', { method: 'POST', body: JSON.stringify(user) });
    if (response.ok) {
        alert('Користувача створено!');
        showSection('users');
    } else {
        const result = await response.json();
        alert(`Помилка: ${result.message}`);
    }
}

async function openEditUserModal(userId) {
    currentEditUserId = userId;
    const user = adminData.users.find(u => u.id === userId);
    if (!user) return;
    
    await loadAdminTeamsAndUsers();
    const teamSelect = document.getElementById('editTeam');
    teamSelect.innerHTML = '<option value="">Без команди</option>' + adminData.teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

    document.getElementById('editUserModalTitle').textContent = `Редагувати: ${user.full_name}`;
    document.getElementById('editFullName').value = user.full_name;
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editDob').value = user.dob || '';
    document.getElementById('editBalance').value = user.balance.toFixed(2);
    document.getElementById('editBlocked').checked = user.is_blocked;
    teamSelect.value = adminData.users.find(u => u.id === userId)?.team_id || '';
    document.getElementById('editPassword').value = '';
    openModal('editUserModal');
}

async function saveUserChanges() {
    const updatedUser = {
        fullName: document.getElementById('editFullName').value,
        username: document.getElementById('editUsername').value,
        dob: document.getElementById('editDob').value,
        balance: document.getElementById('editBalance').value,
        is_blocked: document.getElementById('editBlocked').checked,
        team_id: document.getElementById('editTeam').value,
        password: document.getElementById('editPassword').value,
    };
    if (!updatedUser.password) delete updatedUser.password;
    
    const response = await fetchWithAuth(`/api/admin/users/${currentEditUserId}`, { method: 'PUT', body: JSON.stringify(updatedUser) });
    if (response.ok) {
        alert('Збережено!');
        closeModal('editUserModal');
        showSection('users');
    } else {
        alert('Помилка збереження.');
    }
}

async function adjustBalance() {
    const data = {
        userId: currentEditUserId,
        amount: parseFloat(document.getElementById('adjustAmount').value),
        comment: document.getElementById('adjustComment').value
    };
    if (isNaN(data.amount) || !data.comment) return alert('Введіть суму та коментар.');
    
    const response = await fetchWithAuth('/api/admin/users/adjust-balance', { method: 'POST', body: JSON.stringify(data) });
    if (response.ok) {
        alert('Баланс оновлено!');
        document.getElementById('adjustAmount').value = '';
        document.getElementById('adjustComment').value = '';
        closeModal('editUserModal');
        showSection('users');
    } else {
        alert('Помилка оновлення балансу.');
    }
}


async function loadAdminTeamsAndUsers() {
    const [usersRes, teamsRes] = await Promise.all([
        fetchWithAuth('/api/admin/users'),
        fetchWithAuth('/api/admin/teams')
    ]);
    adminData.users = await usersRes.json();
    adminData.teams = await teamsRes.json();
    
    document.getElementById('teamMembers').innerHTML = adminData.users
        .filter(u => !u.team_name)
        .map(u => `<option value="${u.id}">${u.full_name}</option>`).join('');
        
    document.getElementById('bulkTeamSelect').innerHTML = '<option value="">Оберіть команду</option>' + adminData.teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

    document.getElementById('teamList').innerHTML = adminData.teams.map(t => `
        <div class="data-item">
            <span>${t.name}</span>
        </div>`).join('');
}

async function createTeam() {
    const data = {
        name: document.getElementById('teamName').value,
        members: Array.from(document.getElementById('teamMembers').selectedOptions).map(opt => opt.value)
    };
    if (!data.name) return alert('Введіть назву команди.');
    
    const response = await fetchWithAuth('/api/admin/teams', { method: 'POST', body: JSON.stringify(data) });
    if (response.ok) {
        alert('Команду створено!');
        showSection('teams');
    } else {
        alert('Помилка: команда з такою назвою вже існує.');
    }
}

async function bulkAdjustBalance() {
    const data = {
        teamId: document.getElementById('bulkTeamSelect').value,
        amount: document.getElementById('bulkAmount').value,
        comment: document.getElementById('bulkComment').value,
        action: document.getElementById('bulkAction').value
    };
    if (!data.teamId || !data.amount || !data.comment) return alert('Заповніть усі поля.');
    
    const response = await fetchWithAuth('/api/admin/teams/bulk-adjust', { method: 'POST', body: JSON.stringify(data) });
    const result = await response.json();
    alert(result.message);
    if(response.ok) showSection('teams');
}


async function loadAdminShop() {
    const response = await fetchWithAuth('/api/admin/shop-items');
    adminData.shop = await response.json();
    document.getElementById('shopList').innerHTML = adminData.shop.map(item => `
        <div class="data-item">
            <span>${item.name} | Ціна: ${item.price} грн | К-сть: ${item.quantity}</span>
            <div class="button-group">
                <button onclick="editShopItem(${item.id})" class="styled-button action-btn warning">Редагувати</button>
                <button onclick="deleteShopItem(${item.id})" class="styled-button action-btn danger">Видалити</button>
            </div>
        </div>`).join('');
}

async function addShopItem() {
    const item = {
        name: document.getElementById('itemName').value,
        price: parseFloat(document.getElementById('itemPrice').value),
        discountPrice: parseFloat(document.getElementById('itemDiscountPrice').value) || null,
        quantity: parseInt(document.getElementById('itemQuantity').value),
        category: document.getElementById('itemCategory').value,
        description: document.getElementById('itemDescription').value,
        image: document.getElementById('itemImage').value,
    };
    
    const url = currentEditShopItemId ? `/api/admin/shop-items/${currentEditShopItemId}` : '/api/admin/shop-items';
    const method = currentEditShopItemId ? 'PUT' : 'POST';
    
    const response = await fetchWithAuth(url, { method, body: JSON.stringify(item) });
    if (response.ok) {
        alert('Товар збережено!');
        clearShopForm();
        showSection('shop');
    } else {
        alert('Помилка збереження товару.');
    }
}

function editShopItem(id) {
    const item = adminData.shop.find(i => i.id === id);
    if (!item) return;
    currentEditShopItemId = id;
    document.getElementById('itemName').value = item.name;
    document.getElementById('itemPrice').value = item.price;
    document.getElementById('itemDiscountPrice').value = item.discount_price || '';
    document.getElementById('itemQuantity').value = item.quantity;
    document.getElementById('itemCategory').value = item.category;
    document.getElementById('itemDescription').value = item.description;
    document.getElementById('itemImage').value = item.image;
    document.getElementById('addShopItemBtn').textContent = 'Оновити товар';
    document.getElementById('clearShopFormBtn').style.display = 'inline-flex';
}

async function deleteShopItem(id) {
    if (!confirm('Видалити цей товар?')) return;
    await fetchWithAuth(`/api/admin/shop-items/${id}`, { method: 'DELETE' });
    showSection('shop');
}

function clearShopForm() {
    currentEditShopItemId = null;
    const form = document.querySelector('#shop .form-group');
    form.querySelectorAll('input, textarea').forEach(el => el.value = '');
    document.getElementById('addShopItemBtn').textContent = 'Зберегти товар';
    document.getElementById('clearShopFormBtn').style.display = 'none';
}

// --- Auto-init on page load ---
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('authToken');
    if (token) {
        // Attempt to determine if it's an admin or user panel
        if (document.getElementById('adminPanel')) {
            // This is admin.html
            document.getElementById('login').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'flex';
            showSection('users');
            initializeWebSocket();
        } else if(document.getElementById('app-content')) {
            // This is index.html
            document.getElementById('login').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            document.getElementById('menu').style.display = 'flex';
            document.getElementById('bottom-bar').style.display = 'flex';
            loadInitialData();
            initializeWebSocket();
        }
    } else {
        // Show login form if no token
        const loginForm = document.getElementById('login');
        if (loginForm) loginForm.style.display = 'flex';
    }
});