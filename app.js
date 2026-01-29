// Datos de ejemplo y estado global
// Horarios: 8:00 AM - 11:30 AM y 2:00 PM - 4:00 PM
const MORNING_START = 8;
const MORNING_END = 12; // 11:30 AM (última cita 11:00-11:30)
const AFTERNOON_START = 14; // 2:00 PM
const AFTERNOON_END = 16; // 4:00 PM (última cita 3:00-4:00)

// Detectar entorno: si estamos en localhost, usar localhost, sino usar la URL de producción
// Esta URL se actualizará cuando tengas la URL final de tu backend en Render
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalhost 
  ? "http://localhost:4000/api"
  : "https://psicologa-backend.onrender.com/api";

let currentRole = "paciente";
let currentDate = new Date();
let selectedDate = null; // Date o null

// Detectar si es modo admin o usuario basado en parámetro URL
const urlParams = new URLSearchParams(window.location.search);
const isAdminMode = urlParams.get('admin') === 'true';

// Usuario autenticado (solo para admin)
let currentUser = null;

// Device ID para usuarios anónimos (generado y guardado en localStorage)
function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem('psico_device_id');
  if (!deviceId) {
    // Generar un ID único
    deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('psico_device_id', deviceId);
  }
  return deviceId;
}
let deviceId = !isAdminMode ? getOrCreateDeviceId() : null;

// Citas guardadas en memoria
// { id, date: 'YYYY-MM-DD', time: 'HH:MM', userId, userName, status }
const appointments = [];

// Días deshabilitados por la psicóloga (strings 'YYYY-MM-DD')
const disabledDays = new Set();
// Horas deshabilitadas por día: { 'YYYY-MM-DD': Set<'HH:MM'> }
const disabledHoursByDay = {};

// Notificaciones para usuarios: { [userId]: [{ date, message, type }] }
const notifications = {};

// Utilidades de fecha
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isPastDay(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const check = new Date(date);
  check.setHours(0, 0, 0, 0);
  return check < today;
}

function formatDateLong(date) {
  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  return date.toLocaleDateString("es-ES", options);
}

function formatTimeLabel(time) {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "p.m." : "a.m.";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Lógica de citas y notificaciones
function getTimeSlots() {
  const times = [];
  // Mañana: 8:00, 9:00, 10:00, 11:00
  for (let h = MORNING_START; h <= 11; h++) {
    times.push(`${String(h).padStart(2, "0")}:00`);
  }
  // Tarde: 2:00, 3:00
  for (let h = AFTERNOON_START; h < AFTERNOON_END; h++) {
    times.push(`${String(h).padStart(2, "0")}:00`);
  }
  return times;
}

function getAppointmentsForDay(isoDate) {
  return appointments.filter((a) => a.date === isoDate);
}

function isTimeTaken(isoDate, time) {
  // En modo usuario, mostrar como ocupado si CUALQUIERA tiene una cita (no solo el dispositivo)
  // En modo admin, mostrar todas las citas
  return appointments.some(
    (a) =>
      a.date === isoDate &&
      a.time === time &&
      (a.status === "pending" || a.status === "confirmed")
  );
}

function isHourDisabled(isoDate, time) {
  const set = disabledHoursByDay[isoDate];
  return set ? set.has(time) : false;
}

function userHasAppointmentOnDay(isoDate, userIdOrDeviceId) {
  return appointments.some(
    (a) =>
      (a.userId === userIdOrDeviceId || a.deviceId === userIdOrDeviceId) &&
      a.date === isoDate &&
      (a.status === "pending" || a.status === "confirmed")
  );
}

function disableHour(isoDate, time) {
  if (!disabledHoursByDay[isoDate]) {
    disabledHoursByDay[isoDate] = new Set();
  }
  disabledHoursByDay[isoDate].add(time);
}

function enableHour(isoDate, time) {
  const set = disabledHoursByDay[isoDate];
  if (!set) return;
  set.delete(time);
  if (set.size === 0) {
    delete disabledHoursByDay[isoDate];
  }
}

function addNotification(userId, message, type) {
}

async function loadUserAppointments() {
  try {
    let res;
    if (isAdminMode && currentUser) {
      // Modo admin: cargar todas las citas
      res = await fetch(`${API_BASE}/appointments-all`);
    } else if (!isAdminMode && deviceId) {
      // Modo usuario: cargar solo citas del dispositivo
      res = await fetch(`${API_BASE}/appointments-by-device?deviceId=${encodeURIComponent(deviceId)}`);
    } else {
      return; // No hay modo válido
    }
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar citas");

    appointments.length = 0;
    data.forEach((row) => {
      // Ocultar completamente el usuario de ejemplo (id = 1) para todos
      if (row.user_id === 1) {
        return;
      }

      const userName = row.patient_name || row.userName || row.username || row.name || "Paciente";
      const userPhone = row.patient_phone || row.userPhone || row.user_phone || "";
      const userIdNumber = row.userIdNumber || row.idNumber || "";

      appointments.push({
        id: row.id,
        date: row.date,
        time: row.time,
        userId: row.user_id || null,
        deviceId: row.device_id || null,
        userName,
        userIdNumber,
        userPhone,
        userNote: row.user_note || "",
        status: row.status,
      });
    });
  } catch (err) {
    console.error("Error al cargar citas:", err);
  }
}

// Función para cargar todos los datos necesarios según el modo
async function loadAllData() {
  await Promise.all([
    loadDisabledDays(),
    loadUserAppointments(),
  ]);
  // Las notificaciones solo se cargan en modo admin
  if (isAdminMode && currentUser) {
    await loadNotifications();
  }
}

async function loadNotifications() {
  try {
    if (!currentUser) return;

    const [userRes, adminRes] = await Promise.all([
      fetch(`${API_BASE}/users/${currentUser.id}/notifications`),
      fetch(`${API_BASE}/users/2/notifications`),
    ]);

    const userData = await userRes.json();
    const adminData = await adminRes.json();

    if (!userRes.ok) throw new Error(userData.error || "Error al cargar notificaciones");
    if (!adminRes.ok) throw new Error(adminData.error || "Error al cargar notificaciones admin");

    notifications[currentUser.id] = [];
    userData.forEach((row) => {
      notifications[currentUser.id].push({
        date: row.created_at,
        message: row.message,
        type: row.type,
      });
    });

    notifications[2] = [];
    adminData.forEach((row) => {
      notifications[2].push({
        date: row.created_at,
        message: row.message,
        type: row.type,
      });
    });
  } catch (err) {
    console.error(err);
  }
}

async function loadDisabledDays() {
  try {
    const res = await fetch(`${API_BASE}/disabled-days`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar días deshabilitados");

    disabledDays.clear();
    data.forEach((row) => {
      if (row.date) disabledDays.add(row.date);
    });
  } catch (err) {
    console.error(err);
  }
}

async function loadDisabledHoursForDate(isoDate) {
  try {
    const res = await fetch(
      `${API_BASE}/disabled-hours?date=${encodeURIComponent(isoDate)}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar horas deshabilitadas");

    disabledHoursByDay[isoDate] = new Set();
    data.forEach((row) => {
      if (row.time) disabledHoursByDay[isoDate].add(row.time);
    });
  } catch (err) {
    console.error(err);
  }
}

async function scheduleAppointment(isoDate, time, user, userNote, patientName, patientPhone) {
  // Validar según el modo
  if (isAdminMode && !user) {
    showToast("Debes iniciar sesión para agendar una cita.", "error");
    return;
  }
  if (!isAdminMode && (!patientName || !patientPhone)) {
    showToast("Nombre completo y número de celular son obligatorios.", "error");
    return;
  }

  const userIdOrDeviceId = isAdminMode ? user.id : deviceId;
  if (userHasAppointmentOnDay(isoDate, userIdOrDeviceId)) {
    showToast(
      "Ya tienes una cita para ese día. Cancela o modifica la existente antes de agendar otra.",
      "error"
    );
    return;
  }
  if (disabledDays.has(isoDate)) {
    showToast("Ese día está deshabilitado. Por favor elige otra fecha.", "error");
    return;
  }
  if (isTimeTaken(isoDate, time) || isHourDisabled(isoDate, time)) {
    showToast("Ese horario ya fue tomado o está deshabilitado. Por favor elige otro.", "error");
    return;
  }

  try {
    showLoader();
    const body = {
      date: isoDate,
      time,
      userNote: userNote || "",
    };
    
    if (isAdminMode) {
      body.userId = user.id;
    } else {
      body.deviceId = deviceId;
      body.patientName = patientName.trim();
      body.patientPhone = patientPhone.trim();
    }
    
    const res = await fetch(`${API_BASE}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "No se pudo crear la cita.", "error");
      return;
    }

    // Recargar todas las citas
    await loadUserAppointments();
    
    // Solo cargar notificaciones en modo admin
    if (isAdminMode && currentUser) {
      await loadNotifications();
    }
    
    // Si el admin está logueado, seleccionar el día de la cita para que pueda verla
    if (isAdminMode && currentUser && currentUser.role === "admin") {
      selectedDate = fromISODate(isoDate);
      const label = document.getElementById("admin-selected-day-text");
      if (label) label.textContent = formatDateLong(selectedDate);
      updateToggleDayButton();
      await loadDisabledHoursForDate(isoDate);
    }
    
    // Renderizar calendario primero para que muestre el corazón amarillo
    renderCalendar();
    
    // Renderizar paneles según el modo
    if (isAdminMode && currentUser && currentUser.role === "admin") {
      // Si es admin, renderizar sus paneles
      renderAdminAppointments();
      renderAdminNotifications();
      renderAdminTimeSlots();
    } else {
      // Si es usuario, renderizar sus paneles
      renderPatientAppointments();
      renderPatientTimeSlots();
      if (!isAdminMode) {
        // Las notificaciones no se muestran en modo usuario
        const notiContainer = document.getElementById("patient-notifications");
        if (notiContainer) {
          notiContainer.innerHTML = "Aquí verás las novedades de tus citas.";
          notiContainer.classList.add("empty");
        }
      }
    }
    
    showToast("Tu cita se creó y está en revisión de la psicóloga.", "success");
  } catch (err) {
    console.error(err);
    showToast("Ocurrió un error al crear la cita.", "error");
  } finally {
    hideLoader();
  }
}

async function updateAppointmentStatus(id, newStatus, adminNote) {
  const appointment = appointments.find((a) => a.id === id);
  if (!appointment) return;

  try {
    showLoader();
    const res = await fetch(`${API_BASE}/appointments/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, adminNote: adminNote || "" }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "No se pudo actualizar la cita.", "error");
      return;
    }

    // Actualizar citas locales
    await Promise.all([loadUserAppointments(), loadNotifications()]);

    renderCalendar();
    renderPatientAppointments();
    renderPatientTimeSlots();
    renderPatientNotifications();
    renderAdminAppointments();

    if (newStatus === "confirmed") {
      showToast("La cita ha sido confirmada.", "success");
    } else if (newStatus === "rejected") {
      showToast("La cita ha sido rechazada.", "info");
    } else if (newStatus === "cancelled") {
      showToast("La cita ha sido cancelada.", "info");
    }
  } catch (err) {
    console.error(err);
    showToast("Ocurrió un error al actualizar la cita.", "error");
  } finally {
    hideLoader();
  }
}

async function disableDay(isoDate, adminNote) {
  try {
    showLoader();
    const res = await fetch(`${API_BASE}/disabled-days`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: isoDate, adminNote: adminNote || "" }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "No se pudo deshabilitar el día.", "error");
      return;
    }

    await Promise.all([loadDisabledDays(), loadUserAppointments(), loadNotifications()]);

    renderCalendar();
    renderPatientAppointments();
    renderPatientNotifications();
    renderAdminAppointments();
    updateToggleDayButton();
    showToast("El día seleccionado ha sido deshabilitado.", "success");
  } catch (err) {
    console.error(err);
    showToast("Ocurrió un error al deshabilitar el día.", "error");
  } finally {
    hideLoader();
  }
}

async function enableDay(isoDate) {
  try {
    showLoader();
    const res = await fetch(`${API_BASE}/disabled-days/${encodeURIComponent(isoDate)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "No se pudo habilitar el día.", "error");
      return;
    }

    await loadDisabledDays();
    renderCalendar();
    updateToggleDayButton();
    showToast("El día ha sido habilitado nuevamente.", "success");
  } catch (err) {
    console.error(err);
    showToast("Ocurrió un error al habilitar el día.", "error");
  } finally {
    hideLoader();
  }
}

// Render del calendario
function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  if (!grid) return;

  grid.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthLabel = document.getElementById("month-label");
  const monthName = currentDate.toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  monthLabel.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  // Solo mostrar días laborables (Lunes a Viernes)
  const dayNames = ["L", "M", "X", "J", "V"];
  dayNames.forEach((d) => {
    const div = document.createElement("div");
    div.className = "calendar-day-name";
    div.textContent = d;
    grid.appendChild(div);
  });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  // Encontrar el primer día laborable del mes (Lunes a Viernes)
  // y calcular en qué columna debe aparecer (0=L, 1=M, 2=X, 3=J, 4=V)
  let firstWorkdayColumn = -1;
  for (let day = 1; day <= daysInMonth; day++) {
    const testDate = new Date(year, month, day);
    const dayOfWeek = testDate.getDay(); // 0=Domingo, 1=Lunes, 2=Martes, 3=Miércoles, 4=Jueves, 5=Viernes, 6=Sábado
    
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // Es lunes-viernes, calcular la columna correcta
      // Lunes (1) -> columna 0, Martes (2) -> columna 1, Miércoles (3) -> columna 2, Jueves (4) -> columna 3, Viernes (5) -> columna 4
      firstWorkdayColumn = dayOfWeek - 1;
      break;
    }
  }

  // Agregar celdas vacías hasta el primer día laborable para mantener el grid de 5 columnas
  if (firstWorkdayColumn >= 0) {
    for (let i = 0; i < firstWorkdayColumn; i++) {
      const emptyCell = document.createElement("div");
      emptyCell.className = "calendar-cell empty";
      grid.appendChild(emptyCell);
    }
  }

  // Renderizar solo días laborables (Lunes a Viernes)
  // El grid CSS automáticamente creará filas de 5 columnas
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const dayOfWeek = cellDate.getDay(); // 0 = Domingo, 6 = Sábado
    
    // Ocultar completamente sábados (6) y domingos (0) - NO RENDERIZARLOS
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue; // Saltar completamente los fines de semana
    }
    
    const iso = toISODate(cellDate);
    
    const cell = document.createElement("div");
    cell.className = "calendar-cell calendar-heart";

    if (isSameDay(cellDate, today)) {
      cell.classList.add("today");
    }
    if (isPastDay(cellDate)) {
      cell.classList.add("past");
    }
    if (disabledDays.has(iso)) {
      cell.classList.add("disabled");
    }

    const dayNumber = document.createElement("div");
    dayNumber.className = "day-number";
    dayNumber.textContent = day.toString();
    cell.appendChild(dayNumber);

    // Determinar el estado de las citas para cambiar el color del corazón
    const allApps = getAppointmentsForDay(iso);
    let apps;
    if (isAdminMode && currentUser && currentUser.role === "admin") {
      // Modo admin: mostrar todas las citas
      apps = allApps;
    } else if (!isAdminMode && deviceId) {
      // Modo usuario: mostrar solo citas del dispositivo
      apps = allApps.filter((a) => a.deviceId === deviceId);
    } else {
      apps = [];
    }
    
    // Si hay citas, determinar el color según el estado
    if (apps.length > 0) {
      const hasPending = apps.some((a) => a.status === "pending");
      const hasConfirmed = apps.some((a) => a.status === "confirmed");
      const hasCancelled = apps.some((a) => a.status === "cancelled" || a.status === "rejected");
      
      if (hasConfirmed) {
        cell.classList.add("heart-confirmed"); // Verde
      } else if (hasPending) {
        cell.classList.add("heart-pending"); // Amarillo
      } else if (hasCancelled) {
        // Canceladas vuelven a rosa claro (sin clase adicional)
        cell.classList.remove("heart-pending", "heart-confirmed");
      }
    } else {
      // Sin citas = rosa claro (sin clases de color)
      cell.classList.remove("heart-pending", "heart-confirmed");
    }

    cell.addEventListener("click", () => handleDayClick(cellDate));
    grid.appendChild(cell);
  }
}

// Render panel paciente
function renderPatientTimeSlots() {
  const container = document.getElementById("time-slots");
  const selectedText = document.getElementById("selected-day-text");
  container.innerHTML = "";

  if (!selectedDate) {
    selectedText.textContent = "Ningún día seleccionado";
    return;
  }

  const iso = toISODate(selectedDate);
  selectedText.textContent = formatDateLong(selectedDate);

  if (disabledDays.has(iso)) {
    container.innerHTML =
      '<p style="font-size:0.85rem;color:#b71c1c;">Este día ha sido deshabilitado por la psicóloga. Por favor elige otra fecha.</p>';
    return;
  }

  if (isPastDay(selectedDate)) {
    container.innerHTML =
      '<p style="font-size:0.85rem;color:#b71c1c;">No es posible agendar citas en fechas pasadas.</p>';
    return;
  }

  const times = getTimeSlots();
  times.forEach((time) => {
    const btn = document.createElement("button");
    btn.className = "time-slot-btn";
    btn.textContent = formatTimeLabel(time);
    if (isTimeTaken(iso, time) || isHourDisabled(iso, time)) {
      btn.classList.add("disabled");
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        openConfirmModal(iso, time);
      });
    }
    container.appendChild(btn);
  });
}

function renderPatientAppointments() {
  const container = document.getElementById("patient-appointments");
  if (!container) return;

  let userApps = [];
  if (isAdminMode && currentUser) {
    // Modo admin: no mostrar citas de paciente aquí
    userApps = [];
  } else if (!isAdminMode && deviceId) {
    // Modo usuario: mostrar solo citas del dispositivo
    userApps = appointments
      .filter((a) => a.deviceId === deviceId)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  container.innerHTML = "";

  if (userApps.length === 0) {
    container.classList.add("empty");
    container.textContent = "Todavía no has agendado ninguna cita.";
    return;
  }

  container.classList.remove("empty");

  userApps.forEach((a) => {
    const item = document.createElement("div");
    item.className = "appointment-item";

    const main = document.createElement("div");
    main.className = "appointment-main";
    const timeSpan = document.createElement("span");
    timeSpan.className = "appointment-time";
    timeSpan.textContent = formatTimeLabel(a.time);

    const status = document.createElement("span");
    status.className = "appointment-status";
    if (a.status === "pending") status.classList.add("status-pending");
    else if (a.status === "confirmed") status.classList.add("status-confirmed");
    else status.classList.add("status-rejected");
    const statusLabel =
      a.status === "pending"
        ? "Pendiente"
        : a.status === "confirmed"
        ? "Confirmada"
        : a.status === "cancelled"
        ? "Cancelada"
        : "Rechazada";
    status.textContent = statusLabel;

    main.appendChild(timeSpan);
    main.appendChild(status);

    const meta = document.createElement("div");
    meta.className = "appointment-meta";
    const dateObj = fromISODate(a.date);
    meta.textContent = dateObj.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    item.appendChild(main);
    item.appendChild(meta);

    if (a.status === "pending" || a.status === "confirmed") {
      const actions = document.createElement("div");
      actions.className = "appointment-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-reject";
      cancelBtn.textContent = "Cancelar";
      cancelBtn.addEventListener("click", () => openCancelByUserModal(a));

      actions.appendChild(cancelBtn);
      item.appendChild(actions);
    }
    container.appendChild(item);
  });
}

function renderPatientNotifications() {
  const container = document.getElementById("patient-notifications");
  if (!container) return;

  const list = currentUser ? notifications[currentUser.id] || [] : [];
  container.innerHTML = "";

  if (list.length === 0) {
    container.classList.add("empty");
    container.textContent = "Aquí verás las novedades de tus citas.";
    return;
  }

  container.classList.remove("empty");

  list
    .slice()
    .reverse()
    .forEach((n) => {
      const item = document.createElement("div");
      item.className = "notification-item";

      const type = document.createElement("div");
      type.className = "notification-type";
      type.textContent =
        n.type === "rechazo"
          ? "Cita rechazada"
          : n.type === "dia-deshabilitado"
          ? "Día deshabilitado"
          : "Cita confirmada";

      const msg = document.createElement("div");
      msg.className = "notification-message";
      msg.textContent = n.message;

      const dateSpan = document.createElement("div");
      dateSpan.className = "notification-date";
      const d = new Date(n.date);
      dateSpan.textContent = d.toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      item.appendChild(type);
      item.appendChild(msg);
      item.appendChild(dateSpan);
      container.appendChild(item);
    });
}

function renderAdminNotifications() {
  const container = document.getElementById("admin-notifications");
  if (!container) return;

  const list = notifications[2] || [];
  container.innerHTML = "";

  if (list.length === 0) {
    container.classList.add("empty");
    container.textContent = "Aquí verás las novedades de tus pacientes.";
    return;
  }

  container.classList.remove("empty");

  list.forEach((n) => {
    const item = document.createElement("div");
    item.className = "notification-item";

    const type = document.createElement("div");
    type.className = "notification-type";
    type.textContent =
      n.type === "cancelacion-usuario"
        ? "Cita cancelada por usuario"
        : n.type === "rechazo"
        ? "Cita rechazada"
        : n.type === "dia-deshabilitado"
        ? "Día deshabilitado"
        : "Cita confirmada";

    const msg = document.createElement("div");
    msg.className = "notification-message";
    msg.textContent = n.message;

    const dateSpan = document.createElement("div");
    dateSpan.className = "notification-date";
    const d = new Date(n.date);
    dateSpan.textContent = d.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    item.appendChild(type);
    item.appendChild(msg);
    item.appendChild(dateSpan);
    container.appendChild(item);
  });
}

// Render panel admin
function renderAdminAppointments() {
  const container = document.getElementById("admin-appointments");
  if (!container) return;

  container.innerHTML = "";

  if (!selectedDate) {
    container.classList.add("empty");
    container.textContent = "Selecciona un día en el calendario.";
    return;
  }

  const iso = toISODate(selectedDate);
  const list = getAppointmentsForDay(iso).sort((a, b) =>
    a.time.localeCompare(b.time)
  );

  if (list.length === 0) {
    container.classList.add("empty");
    container.textContent = "No hay citas agendadas para este día.";
    return;
  }

  container.classList.remove("empty");

  list.forEach((a) => {
    const item = document.createElement("div");
    item.className = "appointment-item";
    item.addEventListener("click", () => openAppointmentDetailsModal(a));

    const main = document.createElement("div");
    main.className = "appointment-main";

    const timeSpan = document.createElement("span");
    timeSpan.className = "appointment-time";
    timeSpan.textContent = formatTimeLabel(a.time);

    const status = document.createElement("span");
    status.className = "appointment-status";
    if (a.status === "pending") status.classList.add("status-pending");
    else if (a.status === "confirmed") status.classList.add("status-confirmed");
    else status.classList.add("status-rejected");

    const statusLabel =
      a.status === "pending"
        ? "Pendiente"
        : a.status === "confirmed"
        ? "Confirmada"
        : a.status === "cancelled"
        ? "Cancelada"
        : "Rechazada";
    status.textContent = statusLabel;

    main.appendChild(timeSpan);
    main.appendChild(status);

    const meta = document.createElement("div");
    meta.className = "appointment-meta";
    meta.textContent = `${a.userName}`;

    item.appendChild(main);
    item.appendChild(meta);

    if (a.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "appointment-actions";

      const btnConfirm = document.createElement("button");
      btnConfirm.className = "btn btn-confirm";
      btnConfirm.textContent = "Confirmar";
      btnConfirm.addEventListener("click", (event) => {
        event.stopPropagation();
        updateAppointmentStatus(a.id, "confirmed");
      });

      const btnReject = document.createElement("button");
      btnReject.className = "btn btn-reject";
      btnReject.textContent = "Rechazar";
      btnReject.addEventListener("click", (event) => {
        event.stopPropagation();
        openRejectAppointmentModal(a);
      });

      actions.appendChild(btnConfirm);
      actions.appendChild(btnReject);
      item.appendChild(actions);
    }

    container.appendChild(item);
  });
}

function renderAdminTimeSlots() {
  const container = document.getElementById("admin-time-slots");
  if (!container) return;

  container.innerHTML = "";

  if (!selectedDate) {
    container.textContent = "Selecciona un día en el calendario.";
    return;
  }

  const iso = toISODate(selectedDate);
  const times = getTimeSlots();

  times.forEach((time) => {
    const btn = document.createElement("button");
    btn.className = "time-slot-btn";
    btn.textContent = formatTimeLabel(time);

    const taken = isTimeTaken(iso, time);
    const disabledHour = isHourDisabled(iso, time);

    if (taken) {
      btn.classList.add("disabled");
      btn.disabled = true;
      btn.title = "Hay una cita en este horario.";
    } else {
      if (disabledHour) {
        btn.classList.add("disabled-hour");
      }
      btn.addEventListener("click", async () => {
        const currentlyDisabled = isHourDisabled(iso, time);
        try {
          showLoader();
          if (currentlyDisabled) {
            await fetch(`${API_BASE}/disabled-hours`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ date: iso, time }),
            });
            enableHour(iso, time);
          } else {
            await fetch(`${API_BASE}/disabled-hours`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ date: iso, time }),
            });
            disableHour(iso, time);
          }
        } catch (err) {
          console.error(err);
          alert("Ocurrió un error al actualizar la hora.");
        } finally {
          hideLoader();
          renderAdminTimeSlots();
          renderPatientTimeSlots();
        }
      });
    }

    container.appendChild(btn);
  });
}

// Modal
function openAppointmentDetailsModal(appointment) {
  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  title.textContent = "Detalle de la cita";
  body.innerHTML = "";

  const dateObj = fromISODate(appointment.date);

  const pDate = document.createElement("p");
  pDate.innerHTML = `<strong>Fecha:</strong> ${formatDateLong(
    dateObj
  )} a las ${formatTimeLabel(appointment.time)}`;

  const pUser = document.createElement("p");
  pUser.innerHTML = `<strong>Nombre completo:</strong> ${appointment.userName}`;

  const pIdNumber = document.createElement("p");
  pIdNumber.innerHTML = `<strong>Número de identificación:</strong> ${
    appointment.userIdNumber || "No registrado"
  }`;

  const pPhone = document.createElement("p");
  pPhone.innerHTML = `<strong>Teléfono:</strong> ${
    appointment.userPhone || "No registrado"
  }`;

  body.appendChild(pDate);
  body.appendChild(pUser);
  body.appendChild(pIdNumber);
  body.appendChild(pPhone);

  if (appointment.userNote && appointment.userNote.trim()) {
    const pNote = document.createElement("p");
    pNote.innerHTML = `<strong>Nota del usuario:</strong> ${appointment.userNote}`;
    body.appendChild(pNote);
  }

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-confirm";
  closeBtn.textContent = "Cerrar";
  closeBtn.addEventListener("click", closeModal);

  actions.appendChild(closeBtn);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

function openProfileModal() {
  if (!currentUser) return;

  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  title.textContent = "Mi perfil";
  body.innerHTML = "";

  const form = document.createElement("div");
  form.className = "auth-form";

  const nameGroup = document.createElement("div");
  nameGroup.className = "auth-field-group";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Nombre completo";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = currentUser.name || "";
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);

  const idNumberGroup = document.createElement("div");
  idNumberGroup.className = "auth-field-group";
  const idNumberLabel = document.createElement("label");
  idNumberLabel.textContent = "Número de identificación";
  const idNumberInput = document.createElement("input");
  idNumberInput.type = "text";
  idNumberInput.value = currentUser.idNumber || "";
  idNumberGroup.appendChild(idNumberLabel);
  idNumberGroup.appendChild(idNumberInput);

  const phoneGroup = document.createElement("div");
  phoneGroup.className = "auth-field-group";
  const phoneLabel = document.createElement("label");
  phoneLabel.textContent = "Teléfono";
  const phoneInput = document.createElement("input");
  phoneInput.type = "tel";
  phoneInput.value = currentUser.phone || "";
  phoneGroup.appendChild(phoneLabel);
  phoneGroup.appendChild(phoneInput);

  form.appendChild(nameGroup);
  form.appendChild(idNumberGroup);
  form.appendChild(phoneGroup);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-reject";
  cancelBtn.textContent = "Cerrar";
  cancelBtn.addEventListener("click", closeModal);

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-confirm";
  saveBtn.textContent = "Guardar cambios";
  saveBtn.addEventListener("click", () => {
    const newName = nameInput.value.trim();
    const newIdNumber = idNumberInput.value.trim();
    const newPhone = phoneInput.value.trim();
    updateUserProfile(newName, newIdNumber, newPhone);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  body.appendChild(form);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

// Función específica para editar perfil de la psicóloga (solo admin)
function openPsychologistProfileModal() {
  if (!isAdminMode || !currentUser || currentUser.role !== 'admin') return;

  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");
  if (!backdrop || !title || !body) return;

  title.textContent = "Editar Perfil de la Psicóloga";
  body.innerHTML = "";

  const form = document.createElement("div");
  form.className = "auth-form";

  const nameGroup = document.createElement("div");
  nameGroup.className = "auth-field-group";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Nombre completo";
  nameLabel.setAttribute("for", "psychologist-name-input");
  const nameInput = document.createElement("input");
  nameInput.id = "psychologist-name-input";
  nameInput.type = "text";
  nameInput.value = currentUser.name || "";
  nameInput.required = true;
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);

  const phoneGroup = document.createElement("div");
  phoneGroup.className = "auth-field-group";
  const phoneLabel = document.createElement("label");
  phoneLabel.textContent = "Número de teléfono";
  phoneLabel.setAttribute("for", "psychologist-phone-input");
  const phoneInput = document.createElement("input");
  phoneInput.id = "psychologist-phone-input";
  phoneInput.type = "tel";
  phoneInput.value = currentUser.phone || "";
  phoneInput.required = true;
  phoneGroup.appendChild(phoneLabel);
  phoneGroup.appendChild(phoneInput);

  form.appendChild(nameGroup);
  form.appendChild(phoneGroup);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-reject";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", closeModal);

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-confirm";
  saveBtn.textContent = "Guardar cambios";
  saveBtn.addEventListener("click", async () => {
    const newName = nameInput.value.trim();
    const newPhone = phoneInput.value.trim();
    
    if (!newName || !newPhone) {
      showToast("Nombre completo y número de teléfono son obligatorios.", "error");
      return;
    }
    
    await updatePsychologistProfile(newName, newPhone);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  body.appendChild(form);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

async function updatePsychologistProfile(name, phone) {
  if (!currentUser || currentUser.role !== 'admin') return;
  
  try {
    showLoader();
    const res = await fetch(`${API_BASE}/users/${currentUser.id}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone }),
    });
    
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "No se pudo actualizar el perfil.", "error");
      return;
    }

    // Actualizar currentUser con los nuevos datos
    currentUser.name = data.name;
    currentUser.phone = data.phone;
    
    // Actualizar el display del usuario
    updateUserDisplay();
    
    // Actualizar currentUser y el display
    currentUser.name = data.name;
    currentUser.phone = data.phone;
    updatePsychologistDisplay();
    updateUserDisplay();
    
    showToast("Perfil actualizado correctamente.", "success");
    closeModal();
  } catch (err) {
    console.error(err);
    showToast("Ocurrió un error al actualizar el perfil.", "error");
  } finally {
    hideLoader();
  }
}

async function updateUserProfile(name, idNumber) {
  if (!currentUser) return;
  if (!name || !idNumber) {
    showToast("Nombre completo y número de identificación son obligatorios.", "error");
    return;
  }

  try {
    showLoader();
    const res = await fetch(`${API_BASE}/users/${currentUser.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, idNumber, phone }),
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "No se pudo actualizar tu perfil.", "error");
      return;
    }

    currentUser = {
      ...currentUser,
      name: data.name,
      idNumber: data.idNumber,
      phone: data.phone,
    };
    localStorage.setItem("psico_user", JSON.stringify(currentUser));
    updateUserDisplay();

    // Recargar citas para reflejar nombre actualizado
    await loadUserAppointments();
    renderPatientAppointments();
    renderAdminAppointments();

    closeModal();
    showToast("Tu perfil se actualizó correctamente.", "success");
  } catch (err) {
    console.error(err);
    showToast("Ocurrió un error al actualizar tu perfil.", "error");
  } finally {
    hideLoader();
  }
}

function openRejectAppointmentModal(appointment) {
  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  title.textContent = "Rechazar cita";
  body.innerHTML = "";

  const dateObj = fromISODate(appointment.date);

  const p = document.createElement("p");
  p.textContent = `Vas a rechazar la cita de ${appointment.userName} para el ${formatDateLong(
    dateObj
  )} a las ${formatTimeLabel(appointment.time)}.`;

  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Nota para el usuario (opcional)";
  noteLabel.style.display = "block";
  noteLabel.style.marginTop = "0.6rem";
  noteLabel.style.fontSize = "0.85rem";

  const textarea = document.createElement("textarea");
  textarea.className = "note-textarea";

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-reject";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", closeModal);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-confirm";
  confirmBtn.textContent = "Rechazar cita";
  confirmBtn.addEventListener("click", () => {
    const note = textarea.value.trim();
    updateAppointmentStatus(appointment.id, "rejected", note);
    closeModal();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  body.appendChild(p);
  body.appendChild(noteLabel);
  body.appendChild(textarea);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

function openDisableDayModal(isoDate) {
  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  const dateObj = fromISODate(isoDate);

  title.textContent = "Deshabilitar día completo";
  body.innerHTML = "";

  const p = document.createElement("p");
  p.textContent =
    `Al deshabilitar este día, todas las citas agendadas se cancelarán ` +
    `y se notificará a los usuarios.`;

  const pDate = document.createElement("p");
  pDate.innerHTML = `<strong>Día seleccionado:</strong> ${formatDateLong(dateObj)}`;

  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Nota para los usuarios (opcional)";
  noteLabel.style.display = "block";
  noteLabel.style.marginTop = "0.6rem";
  noteLabel.style.fontSize = "0.85rem";

  const textarea = document.createElement("textarea");
  textarea.className = "note-textarea";

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-reject";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", closeModal);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-confirm";
  confirmBtn.textContent = "Deshabilitar día";
  confirmBtn.addEventListener("click", async () => {
    const note = textarea.value.trim();
    await disableDay(isoDate, note);
    closeModal();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  body.appendChild(p);
  body.appendChild(pDate);
  body.appendChild(noteLabel);
  body.appendChild(textarea);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

function openCancelByUserModal(appointment) {
  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  const dateObj = fromISODate(appointment.date);

  title.textContent = "Cancelar mi cita";
  body.innerHTML = "";

  const p = document.createElement("p");
  p.textContent = `Vas a cancelar tu cita del ${formatDateLong(
    dateObj
  )} a las ${formatTimeLabel(appointment.time)}.`;

  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Nota para la psicóloga (opcional)";
  noteLabel.style.display = "block";
  noteLabel.style.marginTop = "0.6rem";
  noteLabel.style.fontSize = "0.85rem";

  const textarea = document.createElement("textarea");
  textarea.className = "note-textarea";

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-reject";
  cancelBtn.textContent = "Volver";
  cancelBtn.addEventListener("click", closeModal);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-confirm";
  confirmBtn.textContent = "Cancelar cita";
  confirmBtn.addEventListener("click", () => {
    const note = textarea.value.trim();
    cancelAppointmentByUser(appointment.id, note);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  body.appendChild(p);
  body.appendChild(noteLabel);
  body.appendChild(textarea);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

function openConfirmModal(isoDate, time) {
  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  title.textContent = "Confirmar cita";

  const dateObj = fromISODate(isoDate);
  body.innerHTML = "";

  const p = document.createElement("p");
  p.textContent = `¿Deseas agendar una cita para el ${formatDateLong(
    dateObj
  )} a las ${formatTimeLabel(time)}?`;

  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Nota para la psicóloga (opcional)";
  noteLabel.style.display = "block";
  noteLabel.style.marginTop = "0.6rem";
  noteLabel.style.fontSize = "0.85rem";

  const textarea = document.createElement("textarea");
  textarea.className = "note-textarea";

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-reject";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", closeModal);

  // En modo usuario, agregar campos de nombre y teléfono
  let nameInput, phoneInput;
  if (!isAdminMode) {
    const nameGroup = document.createElement("div");
    nameGroup.className = "auth-field-group";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Nombre completo";
    nameLabel.setAttribute("for", "appointment-name");
    nameInput = document.createElement("input");
    nameInput.id = "appointment-name";
    nameInput.type = "text";
    nameInput.required = true;
    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(nameInput);
    body.insertBefore(nameGroup, noteLabel);

    const phoneGroup = document.createElement("div");
    phoneGroup.className = "auth-field-group";
    const phoneLabel = document.createElement("label");
    phoneLabel.textContent = "Número de celular";
    phoneLabel.setAttribute("for", "appointment-phone");
    phoneInput = document.createElement("input");
    phoneInput.id = "appointment-phone";
    phoneInput.type = "tel";
    phoneInput.required = true;
    phoneGroup.appendChild(phoneLabel);
    phoneGroup.appendChild(phoneInput);
    body.insertBefore(phoneGroup, nameGroup.nextSibling);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-confirm";
  confirmBtn.textContent = "Confirmar cita";
  confirmBtn.addEventListener("click", () => {
    if (isAdminMode && !currentUser) {
      alert("Debes iniciar sesión para agendar una cita.");
      return;
    }
    
    // Validar campos en modo usuario
    if (!isAdminMode) {
      const patientName = nameInput.value.trim();
      const patientPhone = phoneInput.value.trim();
      if (!patientName || !patientPhone) {
        showToast("Nombre completo y número de celular son obligatorios.", "error");
        return;
      }
      const note = textarea.value.trim();
      scheduleAppointment(isoDate, time, null, note, patientName, patientPhone);
      closeModal();
      return;
    }
    
    // Modo admin: usar currentUser
    const note = textarea.value.trim();
    scheduleAppointment(isoDate, time, currentUser, note);
    closeModal();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  body.appendChild(p);
  body.appendChild(noteLabel);
  body.appendChild(textarea);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

function openDayBookingModal(date) {
  const iso = toISODate(date);
  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  title.textContent = "Agendar cita";
  body.innerHTML = "";

  const dateObj = fromISODate(iso);

  const pDate = document.createElement("p");
  pDate.innerHTML = `<strong>Día seleccionado:</strong> ${formatDateLong(dateObj)}`;

  const helper = document.createElement("p");
  helper.className = "modal-helper-text";
  helper.textContent = "Elige una hora disponible entre 8:00 a.m. - 11:30 a.m. y 2:00 p.m. - 4:00 p.m.";

  const timesContainer = document.createElement("div");
  timesContainer.className = "time-slots";

  const times = getTimeSlots();
  times.forEach((time) => {
    const btn = document.createElement("button");
    btn.className = "time-slot-btn";
    btn.textContent = formatTimeLabel(time);

    const taken = isTimeTaken(iso, time);
    const disabledHour = isHourDisabled(iso, time);

    if (disabledDays.has(iso) || isPastDay(date) || taken || disabledHour) {
      btn.classList.add("disabled");
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        closeModal();
        openConfirmModal(iso, time);
      });
    }

    timesContainer.appendChild(btn);
  });

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-reject";
  closeBtn.textContent = "Cerrar";
  closeBtn.addEventListener("click", closeModal);

  actions.appendChild(closeBtn);

  body.appendChild(pDate);
  body.appendChild(helper);
  body.appendChild(timesContainer);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

function closeModal() {
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.classList.add("hidden");
}

// Gestión de clic en día
function handleDayClick(date) {
  selectedDate = date;

  if (currentRole === "paciente") {
    const label = document.getElementById("selected-day-text");
    if (label) label.textContent = formatDateLong(date);
    const iso = toISODate(date);
    const dayOfWeek = date.getDay(); // 0 = Domingo, 6 = Sábado
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // En móvil usamos modal; si el día está deshabilitado, es fin de semana o es pasado, no abrimos nada
    if (window.innerWidth <= 768) {
      if (disabledDays.has(iso) || isWeekend) {
        showToast("Este día ha sido deshabilitado por la psicóloga.", "error");
        return;
      }
      if (isPastDay(date)) {
        showToast("No es posible agendar citas en fechas pasadas.", "error");
        return;
      }

      loadDisabledHoursForDate(iso).then(() => {
        openDayBookingModal(date);
      });
    } else {
      // En desktop también verificamos si es fin de semana o está deshabilitado
      if (disabledDays.has(iso) || isWeekend) {
        showToast("Este día ha sido deshabilitado por la psicóloga.", "error");
        return;
      }
      if (isPastDay(date)) {
        showToast("No es posible agendar citas en fechas pasadas.", "error");
        return;
      }
      loadDisabledHoursForDate(iso).then(() => {
        renderPatientTimeSlots();
      });
    }
  } else {
    const label = document.getElementById("admin-selected-day-text");
    if (label) label.textContent = formatDateLong(date);
    updateToggleDayButton();
    const iso = toISODate(date);
    loadDisabledHoursForDate(iso).then(() => {
      renderAdminAppointments();
      renderAdminTimeSlots();
    });
  }
}

function updateToggleDayButton() {
  const btn = document.getElementById("toggle-day");
  if (!btn) return;

  if (!selectedDate) {
    btn.disabled = true;
    btn.classList.add("disabled");
    btn.textContent = "Deshabilitar día completo";
    return;
  }

  const iso = toISODate(selectedDate);
  btn.disabled = false;
  btn.classList.remove("disabled");

  if (disabledDays.has(iso)) {
    btn.textContent = "Habilitar este día";
  } else {
    btn.textContent = "Deshabilitar día completo";
  }
}

// Cambio de rol (paciente / admin)
function switchRole(role) {
  currentRole = role;

  const welcomePaciente = document.getElementById("welcome-paciente");
  const welcomeAdmin = document.getElementById("welcome-admin");
  const panelPaciente = document.getElementById("panel-paciente");
  const panelAdmin = document.getElementById("panel-admin");

  // Si el usuario no es admin, forzamos rol paciente
  if (!currentUser || currentUser.role !== "admin") {
    role = "paciente";
  }

  if (role === "paciente") {
    if (welcomePaciente) welcomePaciente.classList.remove("hidden");
    if (welcomeAdmin) welcomeAdmin.classList.add("hidden");
    panelPaciente.classList.remove("hidden");
    panelAdmin.classList.add("hidden");
    renderPatientTimeSlots();
    renderPatientAppointments();
    renderPatientNotifications();
  } else {
    if (welcomePaciente) welcomePaciente.classList.add("hidden");
    if (welcomeAdmin) welcomeAdmin.classList.remove("hidden");
    panelPaciente.classList.add("hidden");
    panelAdmin.classList.remove("hidden");
    updateToggleDayButton();
    renderAdminAppointments();
    renderAdminTimeSlots();
    renderAdminNotifications();
  }

  renderCalendar();
}

// Inicialización
async function init() {
  const prevMonthBtn = document.getElementById("prev-month");
  const nextMonthBtn = document.getElementById("next-month");

  prevMonthBtn.addEventListener("click", () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    renderCalendar();
  });

  nextMonthBtn.addEventListener("click", () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    renderCalendar();
  });

  const profileBtn = document.getElementById("profile-btn");
  if (profileBtn) {
    profileBtn.addEventListener("click", () => {
      if (!currentUser) return;
      openProfileModal();
    });
  }

  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      window.location.reload();
    });
  }

  const modalBackdrop = document.getElementById("modal-backdrop");
  const modalClose = document.getElementById("modal-close");

  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) {
      closeModal();
    }
  });

  const toggleDayBtn = document.getElementById("toggle-day");
  toggleDayBtn.addEventListener("click", () => {
    if (!selectedDate) return;
    const iso = toISODate(selectedDate);
    if (disabledDays.has(iso)) {
      enableDay(iso);
    } else {
      openDisableDayModal(iso);
    }
  });

  const manageUsersBtn = document.getElementById("manage-users-btn");
  if (manageUsersBtn) {
    manageUsersBtn.addEventListener("click", () => {
      if (currentUser?.role === "admin") {
        openManageUsersModal();
      }
    });
  }

  // Tema (claro / oscuro)
  const themeButtons = document.querySelectorAll(".theme-toggle");
  const savedTheme = localStorage.getItem("psico_theme") || "light";
  applyTheme(savedTheme);

  themeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = document.body.classList.contains("dark-theme")
        ? "dark"
        : "light";
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("psico_theme", next);
      applyTheme(next);
    });
  });

  // Autenticación
  setupAuthUI();

  // Configurar evento para editar perfil de la psicóloga (solo en modo admin)
  // Usar setTimeout para asegurar que el DOM esté completamente cargado
  setTimeout(() => {
    setupPsychologistProfileClick();
  }, 1000);

  if (isAdminMode) {
    // Modo admin: requiere login
    const storedLocal = localStorage.getItem("psico_user");
    const storedSession = !storedLocal ? sessionStorage.getItem("psico_user") : null;
    const stored = storedLocal || storedSession;
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.id && parsed.role === 'admin') {
          await onUserAuthenticated(parsed, storedLocal ? "local" : "session");
          return;
        }
      } catch {
        // Ignorar errores de parseo corrupto
        localStorage.removeItem("psico_user");
        sessionStorage.removeItem("psico_user");
      }
    }
    // Si no hay admin autenticado, mostrar overlay de login
    showAuthOverlay();
  } else {
    // Modo usuario: sin login, cargar directamente
    hideAuthOverlay();
    await loadAllData();
  }
  
  renderCalendar();

  // Efecto líquido que sigue el cursor en los banners de bienvenida
  setupLiquidCursorEffect();
}

// Efecto líquido que reacciona al cursor
function setupLiquidCursorEffect() {
  const welcomeSections = document.querySelectorAll('.welcome-section');
  
  welcomeSections.forEach(section => {
    // Evitar agregar listeners múltiples veces
    if (section.dataset.liquidEffectSetup === 'true') {
      return;
    }
    section.dataset.liquidEffectSetup = 'true';
    
    // Solo aplicar en dispositivos con cursor (no móviles)
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      let isActive = false;
      
      section.addEventListener('mouseenter', () => {
        isActive = true;
      });
      
      section.addEventListener('mousemove', (e) => {
        if (!isActive) return;
        
        const rect = section.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Actualizar posición del efecto SOLO en la zona del cursor
        section.style.setProperty('--cursor-x', `${x}px`);
        section.style.setProperty('--cursor-y', `${y}px`);
        
        // Activar el efecto solo en esa zona
        section.classList.add('cursor-active');
      });
      
      section.addEventListener('mouseleave', () => {
        isActive = false;
        section.classList.remove('cursor-active');
      });
    }
  });
}

function showAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) overlay.classList.remove("hidden");
  const rs = document.querySelector(".role-switch");
  if (rs) rs.classList.add("hidden");
}

function hideAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) overlay.classList.add("hidden");
  updateRoleSwitchVisibility();
}

function updateRoleSwitchVisibility() {
  const rs = document.querySelector(".role-switch");
  const profileBtn = document.getElementById("profile-btn");
  const logoutBtn = document.getElementById("logout-btn");
  if (!rs || !profileBtn) return;

  if (!currentUser) {
    rs.classList.add("hidden");
    profileBtn.classList.add("hidden");
    if (logoutBtn) logoutBtn.classList.add("hidden");
    return;
  }

  rs.classList.remove("hidden");
  profileBtn.classList.remove("hidden");
  if (logoutBtn) logoutBtn.classList.remove("hidden");
}

function saveUserToStorage(user, storage) {
  if (storage === "session") {
    sessionStorage.setItem("psico_user", JSON.stringify(user));
    localStorage.removeItem("psico_user");
  } else {
    localStorage.setItem("psico_user", JSON.stringify(user));
    sessionStorage.removeItem("psico_user");
  }
}

function updatePsychologistDisplay() {
  // Actualizar el nombre en la sección de perfil si es admin
  if (isAdminMode && currentUser && currentUser.role === 'admin') {
    const psychologistNameEl = document.getElementById("psychologist-name");
    if (psychologistNameEl) {
      const currentText = psychologistNameEl.textContent;
      const newText = `Psicóloga ${currentUser.name}`;
      if (currentText !== newText) {
        psychologistNameEl.textContent = newText;
      }
      // Reconfigurar el evento después de actualizar el texto (con delay para asegurar que el DOM se actualizó)
      setTimeout(() => {
        setupPsychologistProfileClick();
      }, 100);
    }
    
    // Actualizar el teléfono en la sección de perfil
    const profileContact = document.querySelector(".profile-contact");
    if (profileContact && currentUser.phone) {
      const phoneFormatted = currentUser.phone.replace(/\s/g, '');
      profileContact.innerHTML = `Teléfono: <a href="tel:${phoneFormatted}">${currentUser.phone}</a>`;
    }
  }
}

async function onUserAuthenticated(user, storage = "local") {
  currentUser = user;
  saveUserToStorage(user, storage);
  hideAuthOverlay();
  updateUserDisplay();
  updatePsychologistDisplay();

  try {
    showLoader();
    await Promise.all([loadUserAppointments(), loadDisabledDays(), loadNotifications()]);

    const initialRole = currentUser.role === "admin" ? "admin" : "paciente";
    try {
      switchRole(initialRole);
      renderCalendar();
      
      // Si es admin, configurar el click en el nombre de la psicóloga
      if (isAdminMode && currentUser.role === 'admin') {
        setupPsychologistProfileClick();
      }
    } catch (uiErr) {
      console.error("Error al actualizar la interfaz después de autenticarse:", uiErr);
    }
  } catch (err) {
    console.error("Error al cargar datos después de autenticarse:", err);
  } finally {
    hideLoader();
  }

  // Inicializar el efecto líquido del cursor después de que la UI esté lista
  setupLiquidCursorEffect();
}

// Delegación de eventos: un solo listener en document para el nombre de la psicóloga
function setupPsychologistProfileClick() {
  // Remover listener anterior si existe (evitar duplicados)
  document.removeEventListener("click", onDocumentClickPsychologistName);
  document.addEventListener("click", onDocumentClickPsychologistName);

  // Actualizar estilos del elemento si existe
  const psychologistNameEl = document.getElementById("psychologist-name");
  if (psychologistNameEl) {
    if (isAdminMode && currentUser && currentUser.role === 'admin') {
      psychologistNameEl.style.cursor = 'pointer';
      psychologistNameEl.style.textDecoration = 'underline';
      psychologistNameEl.style.textDecorationStyle = 'dotted';
      psychologistNameEl.style.color = '#22c55e';
      psychologistNameEl.title = 'Click para editar perfil';
    } else {
      psychologistNameEl.style.cursor = 'default';
      psychologistNameEl.style.textDecoration = 'none';
      psychologistNameEl.style.color = '';
      psychologistNameEl.title = '';
    }
  }
}

function onDocumentClickPsychologistName(e) {
  // Solo en modo admin y con usuario admin
  if (!isAdminMode || !currentUser || currentUser.role !== 'admin') return;
  // Verificar si el click fue en el h2 con id psychologist-name (el de la tarjeta de perfil, no el del header)
  const target = e.target;
  const psychologistNameEl = document.getElementById("psychologist-name");
  if (!psychologistNameEl) return;
  // Asegurarnos de que el click sea en el nombre de la SECCIÓN DE PERFIL (profile-section), no en el user-display del header
  const profileSection = document.querySelector(".profile-section");
  if (!profileSection || !profileSection.contains(target)) return;
  if (target.id === "psychologist-name" || target.closest("#psychologist-name")) {
    e.preventDefault();
    e.stopPropagation();
    openPsychologistProfileModal();
  }
}

function setupAuthUI() {
  const loginForm = document.getElementById("login-form");
  const logoutBtn = document.getElementById("logout-btn");
  const privacyCheckbox = document.getElementById("login-privacy");
  const privacyLabel = privacyCheckbox ? privacyCheckbox.closest('.auth-privacy') : null;

  if (!loginForm) return;

  // En modo usuario, ocultar el formulario de login completamente
  if (!isAdminMode) {
    const authOverlay = document.getElementById("auth-overlay");
    if (authOverlay) authOverlay.classList.add("hidden");
    if (privacyLabel) privacyLabel.style.display = 'none';
    return;
  }

  // En modo admin, mostrar solo campos de usuario y contraseña
  if (privacyLabel) privacyLabel.style.display = 'none';
  
  // Modificar el formulario para tener solo usuario y contraseña
  const nameInput = document.getElementById("login-name");
  const idNumberInput = document.getElementById("login-id-number");
  const authSubtitle = document.querySelector(".auth-subtitle");
  
  if (isAdminMode) {
    if (authSubtitle) {
      authSubtitle.textContent = "Inicia sesión como administrador para gestionar las citas.";
    }
    if (nameInput) {
      nameInput.placeholder = "Usuario";
      const label = nameInput.previousElementSibling;
      if (label && label.tagName === 'LABEL') {
        label.textContent = "Usuario";
      }
    }
    if (idNumberInput) {
      idNumberInput.type = "password";
      idNumberInput.placeholder = "Contraseña";
      const label = idNumberInput.previousElementSibling;
      if (label && label.tagName === 'LABEL') {
        label.textContent = "Contraseña";
      }
    }
  } else {
    // En modo usuario, ocultar completamente el overlay
    const authOverlay = document.getElementById("auth-overlay");
    if (authOverlay) authOverlay.classList.add("hidden");
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-name").value.trim();
    const password = document.getElementById("login-id-number").value.trim();

    if (!username || !password) {
      showToast("Usuario y contraseña son obligatorios.", "error");
      return;
    }

    try {
      showLoader();
      const res = await fetch(`${API_BASE}/auth/admin-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "No se pudo iniciar sesión.", "error");
        return;
      }
      // Verificar que sea admin
      if (data.role !== 'admin') {
        showToast("Solo los administradores pueden acceder a esta vista.", "error");
        return;
      }
      // Siempre guardar sesión automáticamente (localStorage)
      await onUserAuthenticated(data, "local");
    } catch (err) {
      console.error(err);
      showToast("Ocurrió un error al iniciar sesión.", "error");
    } finally {
      hideLoader();
    }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      logout();
    });
  }
}

function setupPasswordToggle(passwordInputId, toggleButton) {
  // Si toggleButton es un string (ID), obtener el elemento
  if (typeof toggleButton === 'string') {
    toggleButton = document.getElementById(toggleButton);
  }
  
  const passwordInput = document.getElementById(passwordInputId);

  if (!passwordInput || !toggleButton) return;

  // Remover listeners anteriores si existen
  const newToggleButton = toggleButton.cloneNode(true);
  toggleButton.parentNode.replaceChild(newToggleButton, toggleButton);

  newToggleButton.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    newToggleButton.classList.toggle("active", isPassword);
  });
}

function logout() {
  currentUser = null;
  localStorage.removeItem("psico_user");
  sessionStorage.removeItem("psico_user");

  appointments.length = 0;
  disabledDays.clear();
  Object.keys(disabledHoursByDay).forEach((k) => delete disabledHoursByDay[k]);
  Object.keys(notifications).forEach((k) => delete notifications[k]);
  selectedDate = null;

  // Limpiar paneles principales
  const patientApps = document.getElementById("patient-appointments");
  if (patientApps) {
    patientApps.innerHTML = "Todavía no has agendado ninguna cita.";
    patientApps.classList.add("empty");
  }
  const patientNoti = document.getElementById("patient-notifications");
  if (patientNoti) {
    patientNoti.innerHTML = "Aquí verás las novedades de tus citas.";
    patientNoti.classList.add("empty");
  }

  const adminApps = document.getElementById("admin-appointments");
  if (adminApps) {
    adminApps.innerHTML = "Selecciona un día en el calendario.";
    adminApps.classList.add("empty");
  }
  const adminNoti = document.getElementById("admin-notifications");
  if (adminNoti) {
    adminNoti.innerHTML = "Aquí verás las novedades de tus pacientes.";
    adminNoti.classList.add("empty");
  }

  showAuthOverlay();
  renderCalendar();
}

function updateUserDisplay() {
  const el = document.getElementById("user-display");
  if (!el) return;

  // En modo usuario, siempre ocultar el display de usuario
  if (!isAdminMode || !currentUser) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }

  // Solo mostrar en modo admin cuando hay usuario autenticado
  el.textContent = currentUser.name || "Usuario";
  el.classList.remove("hidden");
}

function applyTheme(theme) {
  const body = document.body;
  const buttons = document.querySelectorAll(".theme-toggle");
  if (!body || !buttons.length) return;

  if (theme === "dark") {
    body.classList.add("dark-theme");
    buttons.forEach((btn) => {
      btn.setAttribute("aria-label", "Cambiar a modo claro");
    });
  } else {
    body.classList.remove("dark-theme");
    buttons.forEach((btn) => {
      btn.setAttribute("aria-label", "Cambiar a modo oscuro");
    });
  }
}

function hideLoader() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.add("hidden");
}

function showLoader() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.remove("hidden");
}

// Toast notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent =
    type === "success" ? "✔" : type === "error" ? "✖" : "ℹ";

  const text = document.createElement("div");
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 220);
  }, 3500);
}

async function cancelAppointmentByUser(appointmentId, note) {
  try {
    showLoader();
    const res = await fetch(`${API_BASE}/appointments/${appointmentId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "cancelled",
        adminNote: note || "",
        source: "user",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "No se pudo cancelar la cita.");
      return;
    }

    await Promise.all([loadUserAppointments(), loadNotifications()]);

    renderCalendar();
    renderPatientAppointments();
    renderPatientTimeSlots();
    renderPatientNotifications();
    closeModal();
  } catch (err) {
    console.error(err);
    alert("Ocurrió un error al cancelar la cita.");
  } finally {
    hideLoader();
  }
}

// Gestión de usuarios (solo para admin/psicóloga)
let usersList = [];

async function loadUsers() {
  if (currentUser?.role !== "admin") return;
  
  try {
    const res = await fetch(`${API_BASE}/users`);
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Error al cargar usuarios.", "error");
      return;
    }
    usersList = data;
  } catch (err) {
    console.error(err);
    showToast("Error al cargar usuarios.", "error");
  }
}

function openManageUsersModal() {
  if (currentUser?.role !== "admin") return;
  
  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  title.textContent = "Gestionar usuarios";
  body.innerHTML = "";

  // Botón para agregar usuario
  const addUserBtn = document.createElement("button");
  addUserBtn.className = "btn";
  addUserBtn.style.background = "var(--coop-green)";
  addUserBtn.style.color = "white";
  addUserBtn.style.marginBottom = "1rem";
  addUserBtn.textContent = "+ Agregar nuevo usuario";
  addUserBtn.addEventListener("click", openAddUserModal);
  body.appendChild(addUserBtn);

  // Lista de usuarios
  const usersContainer = document.createElement("div");
  usersContainer.id = "users-list-container";
  usersContainer.style.maxHeight = "400px";
  usersContainer.style.overflowY = "auto";
  body.appendChild(usersContainer);

  renderUsersList();

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-reject";
  closeBtn.textContent = "Cerrar";
  closeBtn.addEventListener("click", closeModal);
  actions.appendChild(closeBtn);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
  
  // Cargar usuarios si no están cargados
  if (usersList.length === 0) {
    loadUsers().then(() => renderUsersList());
  }
}

function renderUsersList() {
  const container = document.getElementById("users-list-container");
  if (!container) return;

  container.innerHTML = "";

  if (usersList.length === 0) {
    container.innerHTML = "<p style='text-align: center; color: #6b7280; padding: 2rem;'>No hay usuarios registrados.</p>";
    return;
  }

  usersList.forEach((user) => {
    const userItem = document.createElement("div");
    userItem.style.padding = "1rem";
    userItem.style.border = "1px solid #e5e7eb";
    userItem.style.borderRadius = "8px";
    userItem.style.marginBottom = "0.5rem";
    userItem.style.display = "flex";
    userItem.style.justifyContent = "space-between";
    userItem.style.alignItems = "center";

    const userInfo = document.createElement("div");
    userInfo.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 0.25rem;">${user.name}</div>
      <div style="font-size: 0.85rem; color: #6b7280;">Tel: ${user.phone || "No registrado"}</div>
    `;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn";
    deleteBtn.style.background = "#ef4444";
    deleteBtn.style.color = "white";
    deleteBtn.style.padding = "0.4rem 0.8rem";
    deleteBtn.style.fontSize = "0.85rem";
    deleteBtn.textContent = "Eliminar";
    deleteBtn.addEventListener("click", () => deleteUser(user.id, user.name));

    userItem.appendChild(userInfo);
    userItem.appendChild(deleteBtn);
    container.appendChild(userItem);
  });
}

function openAddUserModal() {
  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  title.textContent = "Agregar nuevo usuario";
  body.innerHTML = "";

  const form = document.createElement("div");
  form.className = "auth-form";

  const nameGroup = document.createElement("div");
  nameGroup.className = "auth-field-group";
  nameGroup.innerHTML = `
    <label>Nombre completo</label>
    <input type="text" id="new-user-name" required />
  `;

  const idNumberGroup = document.createElement("div");
  idNumberGroup.className = "auth-field-group";
  idNumberGroup.innerHTML = `
    <label>Número de identificación</label>
    <input type="text" id="new-user-id-number" required />
  `;

  const phoneGroup = document.createElement("div");
  phoneGroup.className = "auth-field-group";
  phoneGroup.innerHTML = `
    <label>Teléfono</label>
    <input type="tel" id="new-user-phone" required />
  `;

  form.appendChild(nameGroup);
  form.appendChild(idNumberGroup);
  form.appendChild(phoneGroup);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-reject";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", () => openManageUsersModal());

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-confirm";
  saveBtn.textContent = "Crear usuario";
  saveBtn.addEventListener("click", async () => {
    const name = document.getElementById("new-user-name").value.trim();
    const idNumber = document.getElementById("new-user-id-number").value.trim();
    const phone = document.getElementById("new-user-phone").value.trim();

    if (!name || !idNumber || !phone) {
      showToast("Nombre completo, número de identificación y teléfono son obligatorios.", "error");
      return;
    }

    await createUser(name, idNumber, phone);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  body.appendChild(form);
  body.appendChild(actions);
}

async function createUser(name, idNumber, phone) {
  try {
    showLoader();
    const res = await fetch(`${API_BASE}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, idNumber, phone }),
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Error al crear el usuario.", "error");
      return;
    }

    showToast("Usuario creado correctamente.", "success");
    await loadUsers();
    openManageUsersModal(); // Volver al modal de gestión
  } catch (err) {
    console.error(err);
    showToast("Error al crear el usuario.", "error");
  } finally {
    hideLoader();
  }
}

async function deleteUser(userId, userName) {
  if (!confirm(`¿Estás segura de que deseas eliminar al usuario "${userName}"?\n\nEsta acción eliminará todas sus citas y no se puede deshacer.`)) {
    return;
  }

  try {
    showLoader();
    const res = await fetch(`${API_BASE}/users/${userId}`, {
      method: "DELETE",
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Error al eliminar el usuario.", "error");
      return;
    }

    showToast("Usuario eliminado correctamente.", "success");
    await loadUsers();
    renderUsersList();
  } catch (err) {
    console.error(err);
    showToast("Error al eliminar el usuario.", "error");
  } finally {
    hideLoader();
  }
}

document.addEventListener("DOMContentLoaded", init);


