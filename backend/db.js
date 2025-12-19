const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

// Ruta a la base de datos (archivo en la carpeta backend)
const dbPath = path.join(__dirname, "database.sqlite");

const db = new sqlite3.Database(dbPath);

// Crear tablas si no existen
db.serialize(() => {
  // Usuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
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

  // Crear usuarios base: ejemplo y psicóloga con contraseña
  const adminPasswordHash = bcrypt.hashSync("valentina123", 10);

  db.run(
    `
    INSERT OR IGNORE INTO users (id, name, email, phone, role, password_hash)
    VALUES
      (1, 'Usuario de ejemplo', 'usuario.ejemplo@correo.com', '3001234567', 'user', NULL),
      (2, 'Psicóloga Valentina', 'valentina@coopurbanospereira.com', '3001234567', 'admin', ?)
  `,
    [adminPasswordHash]
  );

  // Asegurar que la psicóloga tenga contraseña si ya existía sin password_hash
  db.run(
    `
    UPDATE users
    SET password_hash = ?
    WHERE id = 2 AND (password_hash IS NULL OR password_hash = '')
  `,
    [adminPasswordHash]
  );
});

module.exports = db;


