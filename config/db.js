const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Создаем директорию для БД, если она не существует
const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const dbPath = path.join(dbDir, 'tasks.db');

// Получение имени корневой папки проекта
const getRootFolderName = () => {
  // Получаем абсолютный путь к корневой папке проекта
  const rootPath = path.resolve(__dirname, '..');

  // Извлекаем имя последней папки из пути
  const rootFolderName = path.basename(rootPath);

  return rootFolderName;
};

// Инициализация базы данных
const initDb = () => {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error(`Ошибка подключения к БД: ${err.message}`);
        reject(err);
        return;
      }

      console.log('SQLite подключена');

      // Создаем таблицу задач, если она не существует
      db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'ожидает',
        priority INTEGER DEFAULT 3,
        group_name TEXT DEFAULT 'default',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error(`Ошибка создания таблицы: ${err.message}`);
          reject(err);
          return;
        }

        // Создаем таблицу связей между задачами
        db.run(`CREATE TABLE IF NOT EXISTS task_relations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_task_id INTEGER NOT NULL,
          target_task_id INTEGER NOT NULL,
          relation_type TEXT DEFAULT 'связана',
          FOREIGN KEY (source_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
          FOREIGN KEY (target_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
          UNIQUE(source_task_id, target_task_id)
        )`, (err) => {
          if (err) {
            console.error(`Ошибка создания таблицы связей: ${err.message}`);
            reject(err);
            return;
          }

          console.log('Таблицы задач и связей готовы');
          resolve(db);
        });
      });
    });
  });
};

// Получение экземпляра БД
const getDb = () => {
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
      console.error(`Ошибка при открытии БД: ${err.message}`);
    }
  });
};

module.exports = { initDb, getDb, getRootFolderName };