const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const fs = require("fs");

// Ruta a la base de datos: usar variable de entorno o carpeta local
// En Render, configura un disco persistente y usa DATABASE_PATH en variables de entorno
const dbDir = process.env.DATABASE_PATH || __dirname;

// Asegurar que el directorio existe
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "database.sqlite");
console.log(`Base de datos en: ${dbPath}`);

const db = new sqlite3.Database(dbPath);

// Crear tablas si no existen
db.serialize(() => {
  // Usuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      id_number TEXT UNIQUE,
      email TEXT,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'user', -- 'user' o 'admin'
      password_hash TEXT
    )
  `);

  // Asegurar columna password_hash en bases antiguas
  db.run("ALTER TABLE users ADD COLUMN password_hash TEXT", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Error al agregar columna password_hash:", err.message);
    }
  });

  // Asegurar columna id_number en bases antiguas
  db.run("ALTER TABLE users ADD COLUMN id_number TEXT", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Error al agregar columna id_number:", err.message);
    }
  });

  // Citas
  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,      -- 'YYYY-MM-DD'
      time TEXT NOT NULL,      -- 'HH:MM'
      status TEXT NOT NULL,    -- 'pending', 'confirmed', 'rejected', 'cancelled'
      user_note TEXT,
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Días deshabilitados
  db.run(`
    CREATE TABLE IF NOT EXISTS disabled_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL, -- 'YYYY-MM-DD'
      admin_note TEXT
    )
  `);

  // Horas deshabilitadas por día
  db.run(`
    CREATE TABLE IF NOT EXISTS disabled_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,       -- 'YYYY-MM-DD'
      time TEXT NOT NULL,       -- 'HH:MM'
      UNIQUE(date, time)
    )
  `);

  // Notificaciones
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,       -- 'rechazo', 'confirmacion', 'dia-deshabilitado'
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Crear usuarios base: ejemplo y psicóloga
  db.run(
    `
    INSERT OR IGNORE INTO users (id, name, id_number, phone, role)
    VALUES
      (1, 'Usuario de ejemplo', '9999999999', '3001234567', 'user'),
      (2, 'Valentina', '1234567890', '3001234567', 'admin')
  `
  );
  
  // Actualizar el usuario admin si ya existe para asegurar los datos correctos
  db.run(
    `
    UPDATE users
    SET name = 'Valentina', id_number = '1234567890', phone = '3001234567'
    WHERE id = 2 AND role = 'admin'
  `
  );
});

module.exports = db;


