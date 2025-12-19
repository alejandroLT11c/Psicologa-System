// Datos de ejemplo y estado global
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17; // exclusivo, última cita 16:00-17:00

// Detectar entorno: si estamos en localhost, usar localhost, sino usar la URL de producción
// Esta URL se actualizará cuando tengas la URL final de tu backend en Render
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalhost 
  ? "http://localhost:4000/api"
  : "https://psicologa-backend.onrender.com/api";

let currentRole = "paciente";
let currentDate = new Date();
let selectedDate = null; // Date o null

// Usuario autenticado (se carga desde login / registro)
let currentUser = null;

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
  for (let h = WORK_START_HOUR; h < WORK_END_HOUR; h++) {
    times.push(`${String(h).padStart(2, "0")}:00`);
  }
  return times;
}

function getAppointmentsForDay(isoDate) {
  return appointments.filter((a) => a.date === isoDate);
}

function isTimeTaken(isoDate, time) {
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

function userHasAppointmentOnDay(isoDate, userId) {
  return appointments.some(
    (a) =>
      a.userId === userId &&
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
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/appointments-all`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar citas");

    appointments.length = 0;
    data.forEach((row) => {
      // Ocultar completamente el usuario de ejemplo (id = 1) para todos
      if (row.user_id === 1) {
        return;
      }

      const isCurrentUser = row.user_id === currentUser.id;
      const userName =
        row.userName || row.username || row.name || (isCurrentUser ? currentUser.name : "Paciente");
      const userEmail =
        row.userEmail || row.email || (isCurrentUser ? currentUser.email : "");
      const userPhone =
        row.userPhone || row.phone || (isCurrentUser ? currentUser.phone : "");

      appointments.push({
        id: row.id,
        date: row.date,
        time: row.time,
        userId: row.user_id,
        userName,
        userEmail,
        userPhone,
        userNote: row.user_note || "",
        status: row.status,
      });
    });
  } catch (err) {
    console.error(err);
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

async function scheduleAppointment(isoDate, time, user, userNote) {
  if (userHasAppointmentOnDay(isoDate, user.id)) {
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
    const res = await fetch(`${API_BASE}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        date: isoDate,
        time,
        userNote: userNote || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "No se pudo crear la cita.", "error");
      return;
    }

    await loadUserAppointments();
    renderCalendar();
    renderPatientAppointments();
    renderPatientTimeSlots();
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

  const dayNames = ["L", "M", "X", "J", "V", "S", "D"];
  dayNames.forEach((d) => {
    const div = document.createElement("div");
    div.className = "calendar-day-name";
    div.textContent = d;
    grid.appendChild(div);
  });

  const firstDayOfMonth = new Date(year, month, 1);
  const firstDayWeekday = (firstDayOfMonth.getDay() + 6) % 7; // Lunes=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDayWeekday; i++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "calendar-cell empty";
    grid.appendChild(emptyCell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const iso = toISODate(cellDate);
    const cell = document.createElement("div");
    cell.className = "calendar-cell";

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

    const allApps = getAppointmentsForDay(iso);
    const apps =
      currentRole === "admin" || !currentUser
        ? allApps
        : allApps.filter((a) => a.userId === currentUser.id);
    if (apps.length > 0) {
      const dotsContainer = document.createElement("div");
      dotsContainer.className = "status-dots";

      const pendingCount = apps.filter((a) => a.status === "pending").length;
      const confirmedCount = apps.filter((a) => a.status === "confirmed").length;

      if (pendingCount > 0) {
        const pendingWrapper = document.createElement("div");
        pendingWrapper.className = "status-dot-wrapper";

        const dotPending = document.createElement("div");
        dotPending.className = "status-dot pending";
        pendingWrapper.appendChild(dotPending);

        // Para la psicóloga, mostrar número de citas pendientes en el día
        if (currentRole === "admin") {
          const badge = document.createElement("span");
          badge.className = "status-count";
          badge.textContent = pendingCount.toString();
          pendingWrapper.appendChild(badge);
        }

        dotsContainer.appendChild(pendingWrapper);
      }

      if (confirmedCount > 0) {
        const dotConfirmed = document.createElement("div");
        dotConfirmed.className = "status-dot confirmed";
        dotsContainer.appendChild(dotConfirmed);
      }

      cell.appendChild(dotsContainer);
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

  const userId = currentUser ? currentUser.id : null;
  const userApps = userId
    ? appointments
        .filter((a) => a.userId === userId)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    : [];

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

  const pPhone = document.createElement("p");
  pPhone.innerHTML = `<strong>Teléfono:</strong> ${
    appointment.userPhone || "No registrado"
  }`;

  const pEmail = document.createElement("p");
  pEmail.innerHTML = `<strong>Correo electrónico:</strong> ${
    appointment.userEmail || "No registrado"
  }`;

  body.appendChild(pDate);
  body.appendChild(pUser);
  body.appendChild(pPhone);
  body.appendChild(pEmail);

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

  const emailGroup = document.createElement("div");
  emailGroup.className = "auth-field-group";
  const emailLabel = document.createElement("label");
  emailLabel.textContent = "Correo electrónico";
  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.value = currentUser.email || "";
  emailGroup.appendChild(emailLabel);
  emailGroup.appendChild(emailInput);

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
  form.appendChild(emailGroup);
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
    const newEmail = emailInput.value.trim();
    const newPhone = phoneInput.value.trim();
    updateUserProfile(newName, newEmail, newPhone);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  body.appendChild(form);
  body.appendChild(actions);

  backdrop.classList.remove("hidden");
}

async function updateUserProfile(name, email, phone) {
  if (!currentUser) return;
  if (!name || !email || !phone) {
    showToast("Nombre, correo y teléfono son obligatorios.", "error");
    return;
  }

  try {
    showLoader();
    const res = await fetch(`${API_BASE}/users/${currentUser.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone }),
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "No se pudo actualizar tu perfil.", "error");
      return;
    }

    currentUser = {
      ...currentUser,
      name: data.name,
      email: data.email,
      phone: data.phone,
    };
    localStorage.setItem("psico_user", JSON.stringify(currentUser));
    updateUserDisplay();

    // Recargar citas para reflejar nombre/teléfono actualizados
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

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-confirm";
  confirmBtn.textContent = "Confirmar cita";
  confirmBtn.addEventListener("click", () => {
    if (!currentUser) {
      alert("Debes iniciar sesión para agendar una cita.");
      return;
    }
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
  helper.textContent = "Elige una hora disponible entre 8:00 a.m. y 5:00 p.m.";

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

    // En móvil usamos modal; si el día está deshabilitado o es pasado, no abrimos nada
    if (window.innerWidth <= 768) {
      if (disabledDays.has(iso)) {
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

  // Si hay usuario guardado en localStorage o sessionStorage, restaurarlo
  const storedLocal = localStorage.getItem("psico_user");
  const storedSession = !storedLocal ? sessionStorage.getItem("psico_user") : null;
  const stored = storedLocal || storedSession;
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.id) {
        await onUserAuthenticated(parsed, storedLocal ? "local" : "session");
        return;
      }
    } catch {
      // Ignorar errores de parseo corrupto
      localStorage.removeItem("psico_user");
      sessionStorage.removeItem("psico_user");
    }
  }

  // Si no hay usuario autenticado, mostrar overlay y solo el calendario vacío
  showAuthOverlay();
  renderCalendar();
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

async function onUserAuthenticated(user, storage = "local") {
  currentUser = user;
  saveUserToStorage(user, storage);
  hideAuthOverlay();
  updateUserDisplay();

  try {
    showLoader();
    await Promise.all([loadUserAppointments(), loadDisabledDays(), loadNotifications()]);

    const initialRole = currentUser.role === "admin" ? "admin" : "paciente";
    try {
      switchRole(initialRole);
      renderCalendar();
    } catch (uiErr) {
      console.error("Error al actualizar la interfaz después de autenticarse:", uiErr);
    }
  } catch (err) {
    console.error("Error al cargar datos después de autenticarse:", err);
  } finally {
    hideLoader();
  }
}

function setupAuthUI() {
  const tabLogin = document.getElementById("auth-tab-login");
  const tabRegister = document.getElementById("auth-tab-register");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const logoutBtn = document.getElementById("logout-btn");

  if (!tabLogin || !tabRegister || !loginForm || !registerForm) return;

  tabLogin.addEventListener("click", () => {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
  });

  tabRegister.addEventListener("click", () => {
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const rememberCheckbox = document.getElementById("login-remember");
    const remember = !rememberCheckbox || rememberCheckbox.checked;

    try {
      showLoader();
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "No se pudo iniciar sesión.", "error");
        return;
      }
      await onUserAuthenticated(data, remember ? "local" : "session");
    } catch (err) {
      console.error(err);
      showToast("Ocurrió un error al iniciar sesión.", "error");
    } finally {
      hideLoader();
    }
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("register-name");
    const emailInput = document.getElementById("register-email");
    const phoneInput = document.getElementById("register-phone");
    const passwordInput = document.getElementById("register-password");

    if (!nameInput || !emailInput || !phoneInput || !passwordInput) {
      showToast("Error interno del formulario. Por favor recarga la página.", "error");
      return;
    }

    const name = nameInput.value;
    const email = emailInput.value;
    const phone = phoneInput.value;
    const password = passwordInput.value;

    try {
      showLoader();
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, password }),
      });

      const contentType = res.headers.get("content-type") || "";

      if (!res.ok) {
        let message = `Error ${res.status}`;
        if (contentType.includes("application/json")) {
          const data = await res.json();
          if (data && data.error) {
            message = data.error;
          }
        } else {
          const text = await res.text();
          if (text) {
            message = text.slice(0, 200);
          }
        }
        showToast(`No se pudo crear la cuenta. ${message}`, "error");
        return;
      }

      // Si la respuesta es correcta, asumimos JSON
      const data = contentType.includes("application/json") ? await res.json() : null;
      if (!data) {
        showToast("La respuesta del servidor no es la esperada.", "error");
        return;
      }
      await onUserAuthenticated(data, "local");
    } catch (err) {
      console.error("Error en registro:", err);
      showToast(
        `Ocurrió un error al registrarse: ${err && err.message ? err.message : ""}`,
        "error"
      );
    } finally {
      hideLoader();
    }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      logout();
    });
  }

  // Configurar botones de mostrar/ocultar contraseña
  setupPasswordToggle("login-password", "login-password-toggle");
  setupPasswordToggle("register-password", "register-password-toggle");
}

function setupPasswordToggle(passwordInputId, toggleButtonId) {
  const passwordInput = document.getElementById(passwordInputId);
  const toggleButton = document.getElementById(toggleButtonId);

  if (!passwordInput || !toggleButton) return;

  toggleButton.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    toggleButton.classList.toggle("active", isPassword);
    
    // Cambiar el icono visualmente (el emoji ya está en el HTML)
    const icon = toggleButton.querySelector(".password-toggle-icon");
    if (icon) {
      // El emoji ya cambia visualmente, pero podemos agregar un efecto
      icon.textContent = isPassword ? "🙈" : "👁️";
    }
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

  if (!currentUser) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }

  el.textContent = currentUser.name || currentUser.email || "Usuario";
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

document.addEventListener("DOMContentLoaded", init);


