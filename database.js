const Database = require('better-sqlite3');
const path = require('path');

// Створюємо або підключаємось до файлу бази даних
const db = new Database(path.join(__dirname, 'ceo_bank.db'));

/**
 * Проста функція хешування пароля.
 * !!! УВАГА: Це НЕБЕЗПЕЧНО для реальних проєктів. Використовуйте bcrypt. !!!
 * @param {string} str - Рядок для хешування.
 * @returns {string} - Хеш.
 */
const simpleHash = (str) => {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash.toString();
};


/**
 * Ініціалізує базу даних, створюючи необхідні таблиці та користувачів за замовчуванням.
 */
function initializeDb() {
  console.log('Initializing database schema...');

  // Таблиця для користувачів
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      dob TEXT,
      balance REAL DEFAULT 100,
      is_admin INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      team_id INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE SET NULL
    );
  `);

  // Таблиця для команд (груп)
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
  `);

  // Таблиця для транзакцій
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      counterparty TEXT,
      comment TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);

  // Таблиця для товарів у магазині
  db.exec(`
    CREATE TABLE IF NOT EXISTS shop_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      discount_price REAL,
      quantity INTEGER NOT NULL,
      category TEXT,
      description TEXT,
      image TEXT,
      popularity INTEGER DEFAULT 0
    );
  `);
  
  // --- Створення користувачів за замовчуванням ---
  const usersToCreate = [
    { fullName: 'Алєксєєв Назарій', password: 'NazarA_7@gT9' },
    { fullName: 'Алєксєєва Валерія', password: 'Valeriia#2sPq' },
    { fullName: 'Баштанна Єлізавета', password: 'YelizaB$8cV1' },
    { fullName: 'Волошина Аріна', password: 'ArinaV!6hFp' },
    { fullName: 'Воронін Іван', password: 'IvanV@9zXb' },
    { fullName: 'Воровченко Мірра', password: 'MirraV#4jKm' },
    { fullName: 'Гаспарян Лідія', password: 'LidiiaG$2dRq' },
    { fullName: 'Глухенька Марія', password: 'MariiaH!7vYn' },
    { fullName: 'Гонтар Вероніка', password: 'VeronikaG@3fLp' },
    { fullName: 'Гуйван Іван', password: 'IvanH#8sWc' },
    { fullName: 'Дадушко Даниїл', password: 'DanyilD$5bZm' },
    { fullName: 'Дідовець Дмітрій', password: 'DmitriiD!9qXr' },
    { fullName: 'Жовнер Анна', password: 'AnnaZ@4gVj' },
    { fullName: 'Климчук Марія', password: 'MariiaK#1nPs' },
    { fullName: 'Корчемлюк Анастасія', password: 'AnastasiiaK$6cHt' },
    { fullName: 'Кот Єлизавета', password: 'YelyzavetaK!3mFw' },
    { fullName: 'Куропʼятник Мілана', password: 'MilanaK@8zQb' },
    { fullName: 'Куценко Кіра', password: 'KiraK#5dPj' },
    { fullName: 'Лисков Роман', password: 'RomanL$7vYx' },
    { fullName: 'Лискова Марія', password: 'MariiaL!2hGn' },
    { fullName: 'Лобачев Ілля', password: 'IlliaL@9sWp' },
    { fullName: 'Лозинська Олександрина', password: 'OleksandrynaL#4cZm' },
    { fullName: 'Лукʼянов Тимофій', password: 'TymofiiL$1qXr' },
    { fullName: 'Лутова Марина', password: 'MarynaL!6gVj' },
    { fullName: 'Мартинюк Влада', password: 'VladaM@3nPs' },
    { fullName: 'Михалюк Поліна', password: 'PolinaM#8cHt' },
    { fullName: 'Миронець Анна', password: 'AnnaM$5mFw' },
    { fullName: 'Мірошник Вікторія', password: 'ViktoriiaM!9zQb' },
    { fullName: 'Молчанов Арсен', password: 'ArsenM@2dPj' },
    { fullName: 'Нагиба Кирил', password: 'KyrylN#7vYx' },
    { fullName: 'Рижа Злата', password: 'ZlataR$4hGn' },
    { fullName: 'Сабіло Тимофій', password: 'TymofiiS!1sWp' },
    { fullName: 'Секісова Дарина', password: 'DarynaS@6cZm' },
    { fullName: 'Селіна Марія', password: 'MariiaS#3qXr' },
    { fullName: 'Сидоренко Дар\'я', password: 'DariaS$8gVj' },
    { fullName: 'Сорузька Марія', password: 'MariiaS!5nPs' },
    { fullName: 'Софієнко Софія', password: 'SofiiaS@2cHt' },
    { fullName: 'Стельмащук Назар', password: 'NazarS#7mFw' },
    { fullName: 'Тимофеєв Володимир', password: 'VolodymyrT$4zQb' },
    { fullName: 'Трипільський Владислав', password: 'VladyslavT!1dPj' },
    { fullName: 'Троценко Артем', password: 'ArtemT@9vYx' },
    { fullName: 'Троценко Тимур', password: 'TymurT#6hGn' },
    { fullName: 'Хоменко Олександра', password: 'OleksandraK$3sWp' },
    { fullName: 'Шпигунов Ілья', password: 'IlliaS!8cZm' },
    { fullName: 'Янченко Ілья', password: 'IlliaY@5qXr' },
    { fullName: 'Янченко Надія', password: 'NadiiaY#2gVj' }
  ];

  const insertUser = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, is_admin) VALUES (?, ?, ?, ?)'
  );
  const findUser = db.prepare('SELECT id FROM users WHERE username = ?');

  // Додавання адміна
  if (!findUser.get('admin')) {
      insertUser.run('admin', simpleHash('admin123'), 'Головний Адміністратор', 1);
      db.prepare('UPDATE users SET balance = 999999 WHERE username = ?').run('admin');
  }

  // Додавання звичайних користувачів з логінами user1, user2, ...
  usersToCreate.forEach((user, index) => {
      const username = `user${index + 1}`; // <--- ЗМІНЕНО: тепер логін user1, user2 і т.д.
      if (!findUser.get(username)) {
          insertUser.run(username, simpleHash(user.password), user.fullName, 0);
      }
  });

  console.log('Database initialized successfully with new usernames.');
}

// Запускаємо ініціалізацію
initializeDb();


// --- Експортовані функції ---
module.exports = {
  // Змінено, щоб логін шукався в полі username. Повне ім'я більше не використовується для входу/переказів.
  findUserByLogin: (login) => {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(login);
  },
  
  findUserById: (id) => {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
  },
  
  getAppData: (userId) => {
    const userStmt = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.dob, u.balance, t.name as team_name
      FROM users u
      LEFT JOIN teams t ON u.team_id = t.id
      WHERE u.id = ?
    `);
    const currentUser = userStmt.get(userId);

    const transactionsStmt = db.prepare(`
      SELECT id, type, amount, counterparty, comment, timestamp 
      FROM transactions 
      WHERE user_id = ? 
      ORDER BY timestamp DESC
    `);
    const transactions = transactionsStmt.all(userId);

    const shopItemsStmt = db.prepare('SELECT * FROM shop_items ORDER BY popularity DESC, name');
    const shopItems = shopItemsStmt.all();

    return { currentUser, transactions, shopItems };
  },

  performTransfer: db.transaction((fromUserId, toUserId, amount, comment) => {
    const fromUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(fromUserId);
    if (fromUser.balance < amount) {
      return { success: false, message: 'Недостатньо коштів.' };
    }

    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, fromUserId);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, toUserId);

    const fromUserName = db.prepare('SELECT full_name FROM users WHERE id = ?').get(fromUserId).full_name;
    const toUserName = db.prepare('SELECT full_name FROM users WHERE id = ?').get(toUserId).full_name;
    
    const stmt = db.prepare('INSERT INTO transactions (user_id, type, amount, counterparty, comment) VALUES (?, ?, ?, ?, ?)');
    stmt.run(fromUserId, 'transfer', -amount, toUserName, comment);
    stmt.run(toUserId, 'transfer', amount, fromUserName, comment);

    return { success: true, message: 'Переказ успішний' };
  }),

  adjustBalance: (userId, amount, comment, adminName) => {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, counterparty, comment) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'admin_adjustment', amount, adminName, comment);
    return { success: true };
  },
  
  db,
  simpleHash,
};