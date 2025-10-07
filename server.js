const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const dbModule = require('./database');

// --- Налаштування ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'your_super_secret_key_for_ceo_bank_project'; // Змініть на щось складне

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));


// --- WebSocket Logic ---
const clients = new Map(); // { userId: WebSocket }

// Функція для розсилки оновлень певним користувачам або всім
function broadcastUpdate(updateMessage, userIds = null) {
  const dataString = JSON.stringify(updateMessage);
  
  if (userIds && Array.isArray(userIds)) {
    // Відправити конкретним користувачам
    userIds.forEach(id => {
      const clientWs = clients.get(id);
      if (clientWs && clientWs.readyState === clientWs.OPEN) {
        clientWs.send(dataString);
      }
    });
  } else {
    // Відправити всім
    for (const clientWs of wss.clients) {
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(dataString);
      }
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      if (parsedMessage.type === 'register') {
        jwt.verify(parsedMessage.payload.token, JWT_SECRET, (err, decoded) => {
          if (err) {
            ws.terminate();
            return;
          }
          ws.userId = decoded.id;
          clients.set(ws.userId, ws);
          console.log(`User ${decoded.id} registered for WebSocket updates.`);
        });
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  ws.on('close', () => {
    if (ws.userId) {
      clients.delete(ws.userId);
      console.log(`User ${ws.userId} disconnected.`);
    }
  });
});


// --- Authorization Middleware ---
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401); // Unauthorized

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.sendStatus(403); // Forbidden
    req.user = dbModule.findUserById(decoded.id);
    if (!req.user) return res.sendStatus(404); // User not found
    next();
  });
}

// Ця функція більше не використовується, але залишена для довідки
function isAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ message: 'Доступ заборонено. Потрібні права адміністратора.' });
    }
    next();
}


// --- API Routes ---

// ## Authentication ##
app.post('/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ message: 'Введіть логін та пароль.' });
  }

  const user = dbModule.findUserByLogin(login);
  const hashedPassword = dbModule.simpleHash(password);

  if (user && user.password_hash === hashedPassword) {
    if (user.is_blocked) {
      return res.status(403).json({ message: 'Ваш акаунт заблоковано.' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token, isAdmin: !!user.is_admin });
  } else {
    res.status(401).json({ message: 'Неправильний логін або пароль.' });
  }
});

// ## User Routes ##
app.get('/api/app-data', verifyToken, (req, res) => {
    const data = dbModule.getAppData(req.user.id);
    res.json(data);
});

app.post('/api/transfer', verifyToken, (req, res) => {
    const { recipientFullName, amount, comment } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!recipientFullName || isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ message: 'Некоректні дані для переказу.' });
    }

    const recipient = dbModule.findUserByLogin(recipientFullName);
    if (!recipient) {
        return res.status(404).json({ message: 'Отримувача не знайдено.' });
    }
    if (recipient.id === req.user.id) {
        return res.status(400).json({ message: 'Неможливо переказати кошти самому собі.' });
    }

    const result = dbModule.performTransfer(req.user.id, recipient.id, parsedAmount, comment || 'Приватний переказ');
    if (result.success) {
        // Повідомляємо обох користувачів про оновлення
        broadcastUpdate({ type: 'full_update_required' }, [req.user.id, recipient.id]);
        res.json({ success: true, message: 'Переказ успішно виконано.' });
    } else {
        res.status(400).json({ message: result.message });
    }
});

app.post('/api/purchase', verifyToken, (req, res) => {
    const { cart } = req.body; // cart is an array of {id, quantity}
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
        return res.status(400).json({ message: 'Кошик порожній.' });
    }
    
    const purchaseTransaction = dbModule.db.transaction(() => {
        const getItemStmt = dbModule.db.prepare('SELECT * FROM shop_items WHERE id = ?');
        const updateUserBalanceStmt = dbModule.db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?');
        const updateItemQtyStmt = dbModule.db.prepare('UPDATE shop_items SET quantity = quantity - ?, popularity = popularity + ? WHERE id = ?');
        const insertTransactionStmt = dbModule.db.prepare('INSERT INTO transactions (user_id, type, amount, counterparty, comment) VALUES (?, ?, ?, ?, ?)');

        let totalCost = 0;
        for (const item of cart) {
            const dbItem = getItemStmt.get(item.id);
            if (!dbItem || dbItem.quantity < item.quantity) {
                throw new Error(`Недостатня кількість товару: ${dbItem ? dbItem.name : 'невідомий товар'}.`);
            }
            const price = dbItem.discount_price || dbItem.price;
            totalCost += price * item.quantity;
        }

        const user = dbModule.findUserById(req.user.id);
        if (user.balance < totalCost) {
            throw new Error('Недостатньо коштів на балансі.');
        }

        // All checks passed, now execute
        updateUserBalanceStmt.run(totalCost, req.user.id);

        for (const item of cart) {
            updateItemQtyStmt.run(item.quantity, item.quantity, item.id);
        }

        insertTransactionStmt.run(req.user.id, 'purchase', -totalCost, 'Магазин', `Покупка ${cart.length} товарів`);
        
        return { totalCost };
    });

    try {
        const { totalCost } = purchaseTransaction();
        broadcastUpdate({ type: 'full_update_required' }, [req.user.id]);
        broadcastUpdate({ type: 'shop_update_required' }); // Inform everyone about shop changes
        res.json({ success: true, message: `Покупку на суму ${totalCost.toFixed(2)} грн успішно оформлено.` });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});


// ## Admin Routes ##
const adminRouter = express.Router();
// ЗМІНЕНО: видалено 'isAdmin' для зняття обмежень доступу
adminRouter.use(verifyToken);

// Users
adminRouter.get('/users', (req, res) => {
    const users = dbModule.db.prepare(`
        SELECT u.id, u.username, u.full_name, u.dob, u.balance, u.is_blocked, u.team_id, t.name as team_name
        FROM users u
        LEFT JOIN teams t ON u.team_id = t.id
        WHERE u.is_admin = 0
        ORDER BY u.full_name
    `).all();
    res.json(users);
});

adminRouter.post('/users', (req, res) => {
    const { username, password, fullName, dob, balance } = req.body;
    if (!username || !password || !fullName) {
        return res.status(400).json({ message: "Ім'я користувача, пароль та ПІБ є обов'язковими." });
    }
    try {
        const info = dbModule.db.prepare('INSERT INTO users (username, password_hash, full_name, dob, balance) VALUES (?, ?, ?, ?, ?)')
            .run(username, dbModule.simpleHash(password), fullName, dob, parseFloat(balance) || 0);
        broadcastUpdate({ type: 'admin_panel_update_required' });
        res.status(201).json({ id: info.lastInsertRowid });
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ message: 'Користувач з таким логіном вже існує.' });
        }
        res.status(500).json({ message: 'Помилка сервера при створенні користувача.' });
    }
});

adminRouter.put('/users/:id', (req, res) => {
    const { id } = req.params;
    const { username, fullName, dob, balance, is_blocked, team_id, password } = req.body;
    
    let sql = 'UPDATE users SET username = ?, full_name = ?, dob = ?, balance = ?, is_blocked = ?, team_id = ?';
    const params = [username, fullName, dob, parseFloat(balance), is_blocked ? 1 : 0, team_id || null];
    
    if (password) {
        sql += ', password_hash = ?';
        params.push(dbModule.simpleHash(password));
    }
    
    sql += ' WHERE id = ?';
    params.push(id);

    try {
        dbModule.db.prepare(sql).run(params);
        broadcastUpdate({ type: 'admin_panel_update_required' });
        broadcastUpdate({ type: 'full_update_required' }, [parseInt(id, 10)]); // Update the user
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ message: 'Помилка оновлення користувача.' });
    }
});

adminRouter.post('/users/adjust-balance', (req, res) => {
    const { userId, amount, comment } = req.body;
    dbModule.adjustBalance(userId, amount, comment, req.user.full_name);
    broadcastUpdate({ type: 'admin_panel_update_required' });
    broadcastUpdate({ type: 'full_update_required' }, [userId]);
    res.json({ success: true });
});

// Teams
adminRouter.get('/teams', (req, res) => {
    const teams = dbModule.db.prepare('SELECT * FROM teams').all();
    res.json(teams);
});

adminRouter.post('/teams', (req, res) => {
    const { name, members } = req.body; // members is an array of user IDs
    try {
        const info = dbModule.db.prepare('INSERT INTO teams (name) VALUES (?)').run(name);
        const teamId = info.lastInsertRowid;
        if (members && members.length > 0) {
            const stmt = dbModule.db.prepare('UPDATE users SET team_id = ? WHERE id = ?');
            members.forEach(userId => stmt.run(teamId, userId));
        }
        broadcastUpdate({ type: 'admin_panel_update_required' });
        res.status(201).json({ id: teamId });
    } catch (e) {
        res.status(409).json({ message: 'Команда з такою назвою вже існує.' });
    }
});

adminRouter.post('/teams/bulk-adjust', (req, res) => {
    const { teamId, amount, comment, action } = req.body;
    const finalAmount = action === 'add' ? parseFloat(amount) : -parseFloat(amount);

    const bulkAdjust = dbModule.db.transaction(() => {
        const usersInTeam = dbModule.db.prepare('SELECT id FROM users WHERE team_id = ?').all(teamId);
        if (usersInTeam.length === 0) {
            throw new Error('В команді немає учасників.');
        }
        usersInTeam.forEach(user => {
            dbModule.adjustBalance(user.id, finalAmount, comment, `Масова операція (${req.user.full_name})`);
        });
        return usersInTeam.map(u => u.id);
    });

    try {
        const updatedUserIds = bulkAdjust();
        broadcastUpdate({ type: 'admin_panel_update_required' });
        broadcastUpdate({ type: 'full_update_required' }, updatedUserIds);
        res.json({ success: true, message: `Баланс ${updatedUserIds.length} учасників оновлено.` });
    } catch (e) {
        res.status(400).json({ message: e.message });
    }
});

// Shop Items (basic CRUD)
adminRouter.get('/shop-items', (req, res) => {
    const items = dbModule.db.prepare('SELECT * FROM shop_items ORDER BY name').all();
    res.json(items);
});

adminRouter.post('/shop-items', (req, res) => {
    const { name, price, discountPrice, quantity, category, description, image } = req.body;
    const info = dbModule.db.prepare(`
        INSERT INTO shop_items (name, price, discount_price, quantity, category, description, image)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, price, discountPrice || null, quantity, category, description, image);
    broadcastUpdate({ type: 'shop_update_required' });
    res.status(201).json({ id: info.lastInsertRowid });
});

adminRouter.put('/shop-items/:id', (req, res) => {
    const { id } = req.params;
    const { name, price, discountPrice, quantity, category, description, image } = req.body;
    dbModule.db.prepare(`
        UPDATE shop_items SET
        name = ?, price = ?, discount_price = ?, quantity = ?, category = ?, description = ?, image = ?
        WHERE id = ?
    `).run(name, price, discountPrice || null, quantity, category, description, image, id);
    broadcastUpdate({ type: 'shop_update_required' });
    res.json({ success: true });
});

adminRouter.delete('/shop-items/:id', (req, res) => {
    const { id } = req.params;
    dbModule.db.prepare('DELETE FROM shop_items WHERE id = ?').run(id);
    broadcastUpdate({ type: 'shop_update_required' });
    res.json({ success: true });
});


app.use('/api/admin', adminRouter);


// --- Запуск сервера ---
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});