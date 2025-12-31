const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Utilidad para ejecutar consultas con promesas
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function runExecute(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

async function createNotification(userId, type, message) {
  if (!userId || !type || !message) return;
  await runExecute(
    `
    INSERT INTO notifications (user_id, type, message)
    VALUES (?, ?, ?)
  `,
    [userId, type, message]
  );
}

// ---- Autenticación ----

// Crear usuario (solo para admin/psicóloga)
app.post("/api/users", async (req, res) => {
  const { name, idNumber, phone } = req.body;

  if (!name || !idNumber || !phone) {
    return res
      .status(400)
      .json({ error: "Nombre completo, número de identificación y teléfono son obligatorios." });
  }

  try {
    const idNumberClean = String(idNumber).trim();
    const phoneClean = String(phone).trim();

    const existing = await runQuery(
      "SELECT id FROM users WHERE id_number = ?",
      [idNumberClean]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "Ya existe un usuario con ese número de identificación." });
    }

    const result = await runExecute(
      `
      INSERT INTO users (name, id_number, phone, role)
      VALUES (?, ?, ?, 'user')
    `,
      [name.trim(), idNumberClean, phoneClean]
    );

    const user = {
      id: result.id,
      name: name.trim(),
      idNumber: idNumberClean,
      phone: phoneClean,
      role: "user",
    };

    res.status(201).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear el usuario." });
  }
});

// Obtener todos los usuarios (solo para admin/psicóloga)
app.get("/api/users", async (req, res) => {
  try {
    const rows = await runQuery(
      "SELECT id, name, id_number, phone, role FROM users WHERE role = 'user' ORDER BY name ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener usuarios." });
  }
});

// Eliminar usuario (solo para admin/psicóloga)
app.delete("/api/users/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  
  if (!userId) {
    return res.status(400).json({ error: "ID de usuario inválido." });
  }

  try {
    // Verificar que el usuario existe
    const users = await runQuery("SELECT id, role FROM users WHERE id = ?", [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const user = users[0];
    // No permitir eliminar al admin
    if (user.role === "admin") {
      return res.status(403).json({ error: "No se puede eliminar al administrador." });
    }

    // Eliminar citas del usuario
    await runExecute("DELETE FROM appointments WHERE user_id = ?", [userId]);
    // Eliminar notificaciones del usuario
    await runExecute("DELETE FROM notifications WHERE user_id = ?", [userId]);
    // Eliminar el usuario
    await runExecute("DELETE FROM users WHERE id = ?", [userId]);

    res.json({ ok: true, message: "Usuario eliminado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el usuario." });
  }
});

// Registro de usuario (rol paciente) - REMOVIDO, solo admin puede crear usuarios
// El endpoint /api/auth/register ha sido removido. Los usuarios ahora se crean
// a través de /api/users (solo accesible para admin/psicóloga)

// Actualizar datos básicos de un usuario
app.put("/api/users/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const { name, idNumber, phone } = req.body;

  if (!userId || !name || !idNumber || !phone) {
    return res
      .status(400)
      .json({ error: "Nombre completo, número de identificación y teléfono son obligatorios." });
  }

  try {
    const idNumberClean = String(idNumber).trim();
    const phoneClean = String(phone).trim();

    // Verificar que el número de identificación no esté siendo usado por otro usuario
    const existing = await runQuery(
      "SELECT id FROM users WHERE id_number = ? AND id <> ?",
      [idNumberClean, userId]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "Ya existe un usuario con ese número de identificación." });
    }

    await runExecute(
      `
      UPDATE users
      SET name = ?, id_number = ?, phone = ?
      WHERE id = ?
    `,
      [name.trim(), idNumberClean, phoneClean, userId]
    );

    const rows = await runQuery(
      "SELECT id, name, id_number, phone, role FROM users WHERE id = ?",
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el perfil." });
  }
});

// Cambiar contraseña de un usuario
app.put("/api/users/:userId/password", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: "La contraseña actual y la nueva contraseña son obligatorias." });
  }

  if (newPassword.length < 6) {
    return res
      .status(400)
      .json({ error: "La nueva contraseña debe tener al menos 6 caracteres." });
  }

  try {
    // Obtener el usuario y su contraseña actual
    const users = await runQuery(
      "SELECT id, password_hash FROM users WHERE id = ?",
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const user = users[0];
    
    if (!user.password_hash) {
      return res.status(400).json({ error: "Este usuario no tiene contraseña configurada." });
    }

    // Verificar la contraseña actual
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: "La contraseña actual es incorrecta." });
    }

    // Hashear la nueva contraseña
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Actualizar la contraseña
    await runExecute(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [newPasswordHash, userId]
    );

    res.json({ ok: true, message: "Contraseña actualizada correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar la contraseña." });
  }
});

// Login (pacientes y psicóloga)
app.post("/api/auth/login", async (req, res) => {
  const { name, idNumber } = req.body;

  if (!name || !idNumber) {
    return res.status(400).json({ error: "Nombre completo y número de identificación son obligatorios." });
  }

  try {
    const nameClean = String(name).trim();
    const idNumberClean = String(idNumber).trim();

    const users = await runQuery(
      "SELECT id, name, id_number, phone, role FROM users WHERE name = ? AND id_number = ?",
      [nameClean, idNumberClean]
    );
    const user = users[0];

    if (!user) {
      return res.status(400).json({ error: "Credenciales inválidas. Verifica tu nombre completo y número de identificación." });
    }

    res.json({
      id: user.id,
      name: user.name,
      idNumber: user.id_number,
      phone: user.phone,
      role: user.role,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar sesión." });
  }
});

// ---- Rutas principales ----

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API de psicóloga funcionando" });
});

// Obtener citas de un usuario
app.get("/api/users/:userId/appointments", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  try {
    const rows = await runQuery(
      `
      SELECT a.*
      FROM appointments a
      WHERE a.user_id = ?
      ORDER BY a.date ASC, a.time ASC
    `,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener citas del usuario" });
  }
});

// Obtener notificaciones de un usuario
app.get("/api/users/:userId/notifications", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  try {
    // Limpieza automática de notificaciones muy antiguas (más de 90 días)
    await runExecute(
      `
      DELETE FROM notifications
      WHERE datetime(created_at) < datetime('now', '-90 days')
    `
    );

    const rows = await runQuery(
      `
      SELECT *
      FROM notifications
      WHERE user_id = ?
        AND datetime(created_at) >= datetime('now', '-7 days')
      ORDER BY datetime(created_at) DESC
    `,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener notificaciones" });
  }
});

// Obtener citas por día
app.get("/api/appointments", async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: "Falta el parámetro date (YYYY-MM-DD)" });
  }
  try {
    const rows = await runQuery(
      `
      SELECT a.*, u.name as userName, u.id_number as userIdNumber, u.phone as userPhone
      FROM appointments a
      JOIN users u ON u.id = a.user_id
      WHERE a.date = ?
      ORDER BY a.time ASC
    `,
      [date]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener citas del día" });
  }
});

// Obtener todas las citas (para la psicóloga / vista admin)
app.get("/api/appointments-all", async (req, res) => {
  try {
    const rows = await runQuery(
      `
      SELECT a.*, u.name AS userName, u.id_number AS userIdNumber, u.phone AS userPhone
      FROM appointments a
      JOIN users u ON u.id = a.user_id
      ORDER BY a.date ASC, a.time ASC
    `
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener todas las citas" });
  }
});

// Crear cita
app.post("/api/appointments", async (req, res) => {
  const { userId, date, time, userNote } = req.body;
  if (!userId || !date || !time) {
    return res
      .status(400)
      .json({ error: "userId, date y time son obligatorios para crear una cita" });
  }

  try {
    // Verificar día y hora deshabilitados
    const disabledDay = await runQuery(
      "SELECT id FROM disabled_days WHERE date = ?",
      [date]
    );
    if (disabledDay.length > 0) {
      return res.status(400).json({ error: "Ese día está deshabilitado" });
    }

    const disabledHour = await runQuery(
      "SELECT id FROM disabled_hours WHERE date = ? AND time = ?",
      [date, time]
    );
    if (disabledHour.length > 0) {
      return res.status(400).json({ error: "Esa hora está deshabilitada" });
    }

    // Evitar que dos usuarios (reales) tomen el mismo horario
    const existing = await runQuery(
      `
      SELECT id FROM appointments
      WHERE date = ?
        AND time = ?
        AND status IN ('pending', 'confirmed')
        AND user_id <> 1 -- ignorar citas del usuario de ejemplo
    `,
      [date, time]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: "Ese horario ya está ocupado" });
    }

    // Evitar que un mismo usuario tenga más de una cita el mismo día
    const existingSameDay = await runQuery(
      `
      SELECT id FROM appointments
      WHERE date = ?
        AND user_id = ?
        AND status IN ('pending', 'confirmed')
    `,
      [date, userId]
    );
    if (existingSameDay.length > 0) {
      return res.status(400).json({
        error: "Ya tienes una cita para ese día. Cancela o modifica la existente antes de agendar otra.",
      });
    }

    const result = await runExecute(
      `
      INSERT INTO appointments (user_id, date, time, status, user_note)
      VALUES (?, ?, ?, 'pending', ?)
    `,
      [userId, date, time, userNote || null]
    );

    const rows = await runQuery("SELECT * FROM appointments WHERE id = ?", [
      result.id,
    ]);
    const newAppointment = rows[0];

    // Crear notificación para la administradora (id=2) cuando se crea una cita pendiente
    if (newAppointment) {
      const user = await runQuery("SELECT name FROM users WHERE id = ?", [userId]);
      const userName = user.length > 0 ? user[0].name : "Un paciente";
      const message = `${userName} ha solicitado una cita para el ${newAppointment.date} a las ${newAppointment.time}.`;
      await createNotification(2, "nueva-cita", message);
    }

    res.status(201).json(newAppointment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear la cita" });
  }
});

// Actualizar estado de cita
app.put("/api/appointments/:id/status", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status, adminNote, source } = req.body;
  if (!status) {
    return res.status(400).json({ error: "Falta el campo status" });
  }

  try {
    await runExecute(
      `
      UPDATE appointments
      SET status = ?, admin_note = COALESCE(?, admin_note), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [status, adminNote || null, id]
    );

    const rows = await runQuery("SELECT * FROM appointments WHERE id = ?", [id]);
    const appt = rows[0];

    if (appt) {
      const src = source || "admin";
      if (status === "rejected") {
        let message = `Tu cita para el ${appt.date} a las ${appt.time} fue rechazada.`;
        if (adminNote && adminNote.trim()) {
          message += ` Nota de la psicóloga: ${adminNote.trim()}`;
        }
        await createNotification(appt.user_id, "rechazo", message);
      } else if (status === "confirmed") {
        const message = `Tu cita para el ${appt.date} a las ${appt.time} fue confirmada.`;
        await createNotification(appt.user_id, "confirmacion", message);
      } else if (status === "cancelled" && src === "user") {
        const message = `El usuario canceló la cita programada para el ${appt.date} a las ${appt.time}.`;
        // Enviamos notificación a la psicóloga (id=2)
        await createNotification(2, "cancelacion-usuario", message);
      }
    }

    res.json(appt);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la cita" });
  }
});

// Obtener días deshabilitados
app.get("/api/disabled-days", async (req, res) => {
  try {
    const rows = await runQuery("SELECT * FROM disabled_days");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener días deshabilitados" });
  }
});

// Deshabilitar día completo
app.post("/api/disabled-days", async (req, res) => {
  const { date, adminNote } = req.body;
  if (!date) {
    return res.status(400).json({ error: "Falta el campo date" });
  }
  try {
    await runExecute(
      `
      INSERT OR IGNORE INTO disabled_days (date, admin_note)
      VALUES (?, ?)
    `,
      [date, adminNote || null]
    );

    // Cancelar citas de ese día
    await runExecute(
      `
      UPDATE appointments
      SET status = 'cancelled', admin_note = COALESCE(?, admin_note), updated_at = CURRENT_TIMESTAMP
      WHERE date = ? AND status IN ('pending', 'confirmed')
    `,
      [adminNote || null, date]
    );

    // Crear notificaciones para las citas canceladas
    const cancelled = await runQuery(
      `
      SELECT user_id, date, time
      FROM appointments
      WHERE date = ? AND status = 'cancelled'
    `,
      [date]
    );
    for (const row of cancelled) {
      let message = `Tu cita para el ${row.date} a las ${row.time} fue cancelada porque el día fue deshabilitado.`;
      if (adminNote && adminNote.trim()) {
        message += ` Nota de la psicóloga: ${adminNote.trim()}`;
      }
      await createNotification(row.user_id, "dia-deshabilitado", message);
    }

    const rows = await runQuery("SELECT * FROM disabled_days WHERE date = ?", [
      date,
    ]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al deshabilitar el día" });
  }
});

// Habilitar día (eliminar de disabled_days)
app.delete("/api/disabled-days/:date", async (req, res) => {
  const { date } = req.params;
  try {
    await runExecute("DELETE FROM disabled_days WHERE date = ?", [date]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al habilitar el día" });
  }
});

// Obtener horas deshabilitadas de un día
app.get("/api/disabled-hours", async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: "Falta el parámetro date" });
  }
  try {
    const rows = await runQuery(
      "SELECT * FROM disabled_hours WHERE date = ? ORDER BY time ASC",
      [date]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener horas deshabilitadas" });
  }
});

// Deshabilitar una hora
app.post("/api/disabled-hours", async (req, res) => {
  const { date, time } = req.body;
  if (!date || !time) {
    return res.status(400).json({ error: "date y time son obligatorios" });
  }
  try {
    const result = await runExecute(
      `
      INSERT OR IGNORE INTO disabled_hours (date, time)
      VALUES (?, ?)
    `,
      [date, time]
    );
    const rows = await runQuery(
      "SELECT * FROM disabled_hours WHERE id = ?",
      [result.id]
    );
    res.json(rows[0] || { date, time });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al deshabilitar la hora" });
  }
});

// Habilitar una hora (eliminar de disabled_hours)
app.delete("/api/disabled-hours", async (req, res) => {
  const { date, time } = req.body;
  if (!date || !time) {
    return res.status(400).json({ error: "date y time son obligatorios" });
  }
  try {
    await runExecute("DELETE FROM disabled_hours WHERE date = ? AND time = ?", [
      date,
      time,
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al habilitar la hora" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor API escuchando en http://localhost:${PORT}`);
});


