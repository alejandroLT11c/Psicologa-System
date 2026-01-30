const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const fs = require("fs");

// Ruta a la base de datos: en Render DEBE usar DATABASE_PATH = /var/data (mismo path que el disco persistente)
const dbDir = process.env.DATABASE_PATH || __dirname;

// Asegurar que el directorio existe
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "database.sqlite");
if (process.env.DATABASE_PATH) {
  console.log(`Base de datos en disco persistente: ${dbPath}`);
} else {
  console.log(`Base de datos en ruta local (NO persistente): ${dbPath}`);
}

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

  // Apellidos del perfil (nombre = nombre de pila, apellidos = apellidos)
  db.run("ALTER TABLE users ADD COLUMN apellidos TEXT", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Error al agregar columna apellidos:", err.message);
    }
  });

  // Citas
  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,         -- NULL para citas de usuarios anónimos, solo admin tiene user_id
      device_id TEXT,          -- ID del dispositivo (localStorage) para usuarios anónimos
      patient_name TEXT NOT NULL, -- Nombre completo del paciente
      patient_phone TEXT NOT NULL, -- Teléfono del paciente
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
  
  // Agregar nuevas columnas si la tabla ya existe (migración)
  db.run("ALTER TABLE appointments ADD COLUMN device_id TEXT", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Error al agregar columna device_id:", err.message);
    }
  });
  db.run("ALTER TABLE appointments ADD COLUMN patient_name TEXT", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Error al agregar columna patient_name:", err.message);
    }
  });
  db.run("ALTER TABLE appointments ADD COLUMN patient_phone TEXT", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Error al agregar columna patient_phone:", err.message);
    }
  });

  // Migración: permitir user_id NULL (citas de usuarios anónimos desde la página pública)
  db.all("PRAGMA table_info(appointments)", (err, rows) => {
    const done = () => {
      db.run("SELECT 1", (e) => {
        if (e) console.error("DB init:", e);
        else console.log("Base de datos inicializada.");
        if (dbReadyResolve) dbReadyResolve();
      });
    };
    if (err) {
      done();
      return;
    }
    const userIdCol = rows && rows.find((r) => r.name === "user_id");
    if (!userIdCol || userIdCol.notnull !== 1) {
      done();
      return;
    }
    db.run(
      `CREATE TABLE appointments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        device_id TEXT,
        patient_name TEXT NOT NULL,
        patient_phone TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        status TEXT NOT NULL,
        user_note TEXT,
        admin_note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      (err2) => {
        if (err2) {
          console.error("Migración appointments (create):", err2.message);
          done();
          return;
        }
        db.run(
          `INSERT INTO appointments_new (id, user_id, device_id, patient_name, patient_phone, date, time, status, user_note, admin_note, created_at, updated_at)
           SELECT id, user_id, device_id, patient_name, patient_phone, date, time, status, user_note, admin_note, created_at, updated_at FROM appointments`,
          (err3) => {
            if (err3) {
              console.error("Migración appointments (copy):", err3.message);
              done();
              return;
            }
            db.run("DROP TABLE appointments", (err4) => {
              if (err4) {
                console.error("Migración appointments (drop):", err4.message);
                done();
                return;
              }
              db.run("ALTER TABLE appointments_new RENAME TO appointments", (err5) => {
                if (err5) console.error("Migración appointments (rename):", err5.message);
                else console.log("Migración: appointments.user_id ahora permite NULL.");
                done();
              });
            });
          }
        );
      }
    );
  });

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

  // dbReady se resuelve desde la migración de appointments (db.all más arriba)
});

let dbReadyResolve;
const dbReady = new Promise((resolve) => { dbReadyResolve = resolve; });

module.exports = db;
module.exports.dbReady = dbReady;


