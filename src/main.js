import { Calendar } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import { DateTime } from "luxon";
import "./style.css";

const DB_NAME = "personal-consultation-calendar";
const STORE = "consultations";
const ZONES = [
  { label: "Грузія · Тбілісі", value: "Asia/Tbilisi" },
  { label: "Україна · Київ", value: "Europe/Kyiv" },
  { label: "Польща · Варшава", value: "Europe/Warsaw" }
];
const $ = (selector) => document.querySelector(selector);
let calendar;
let db;
let editingId = null;
let reminderTimer = null;
const notifiedInThisSession = new Set();

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("startsAt", "startsAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function tx(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}
function getAll() {
  return new Promise((resolve, reject) => {
    const request = tx().getAll();
    request.onsuccess = () => resolve(request.result.sort((a,b) => a.startsAt.localeCompare(b.startsAt)));
    request.onerror = () => reject(request.error);
  });
}
function save(row) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").put(row);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
function remove(id) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
function zonedInputToISO(value, zone) {
  const dt = DateTime.fromISO(value, { zone });
  if (!dt.isValid) throw new Error("Перевір дату та час.");
  return dt.toUTC().toISO();
}
function isoToZonedInput(iso, zone) {
  return DateTime.fromISO(iso, { setZone: true }).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");
}
function fmt(iso, zone, format = "dd.LL.yyyy, HH:mm") {
  return DateTime.fromISO(iso, { setZone: true }).setZone(zone).toFormat(format);
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}
function blankForm() {
  const now = DateTime.now().setZone("Asia/Tbilisi").plus({ hours: 1 }).startOf("minute").set({ minute: Math.ceil(DateTime.now().minute / 15) * 15 % 60 });
  return {
    title: "",
    timezone: "Europe/Warsaw",
    startLocal: now.setZone("Europe/Warsaw").toFormat("yyyy-MM-dd'T'HH:mm"),
    duration: 60,
    notes: ""
  };
}
function openModal(row = null, clickedDate = null) {
  editingId = row?.id || null;
  const form = row ? {
    title: row.title,
    timezone: row.timezone,
    startLocal: isoToZonedInput(row.startsAt, row.timezone),
    duration: row.duration,
    notes: row.notes || ""
  } : blankForm();
  if (clickedDate && !row) {
    const clicked = DateTime.fromJSDate(clickedDate, { zone: "Asia/Tbilisi" });
    form.startLocal = clicked.setZone(form.timezone).toFormat("yyyy-MM-dd'T'HH:mm");
  }
  $("#event-title").value = form.title;
  $("#event-zone").value = form.timezone;
  $("#event-start").value = form.startLocal;
  $("#event-duration").value = String(form.duration);
  $("#event-notes").value = form.notes;
  $("#delete-btn").hidden = !row;
  $("#modal-title").textContent = row ? "Редагувати консультацію" : "Нова консультація";
  updateTimePreview();
  $("#event-modal").showModal();
}
function updateTimePreview() {
  const value = $("#event-start").value;
  const zone = $("#event-zone").value;
  if (!value) { $("#time-preview").textContent = "Час у Тбілісі: —"; return; }
  const iso = zonedInputToISO(value, zone);
  $("#time-preview").innerHTML = `У Тбілісі: <strong>${fmt(iso, "Asia/Tbilisi")}</strong>`;
}
async function refreshCalendar() {
  const rows = await getAll();
  calendar.removeAllEvents();
  calendar.addEventSource(rows.map((row) => ({
    id: row.id,
    title: row.title,
    start: row.startsAt,
    end: DateTime.fromISO(row.startsAt).plus({ minutes: row.duration }).toISO(),
    extendedProps: { row }
  })));
  $("#count-label").textContent = `${rows.length} ${rows.length === 1 ? "консультація" : "консультацій"}`;
}
async function saveForm(event) {
  event.preventDefault();
  const title = $("#event-title").value.trim();
  const timezone = $("#event-zone").value;
  const startLocal = $("#event-start").value;
  if (!title || !startLocal) return;
  const startsAt = zonedInputToISO(startLocal, timezone);
  const row = {
    id: editingId || crypto.randomUUID(),
    title,
    timezone,
    startsAt,
    duration: Number($("#event-duration").value),
    notes: $("#event-notes").value.trim(),
    updatedAt: new Date().toISOString()
  };
  await save(row);
  $("#event-modal").close();
  await refreshCalendar();
  toast("Консультацію збережено на цьому iPhone.");
}
async function deleteCurrent() {
  if (!editingId || !confirm("Видалити цю консультацію?")) return;
  await remove(editingId);
  $("#event-modal").close();
  await refreshCalendar();
  toast("Консультацію видалено.");
}
async function moveEvent(info) {
  const row = info.event.extendedProps.row;
  row.startsAt = info.event.start.toISOString();
  if (info.event.end) row.duration = Math.max(15, Math.round((info.event.end - info.event.start) / 60000));
  row.updatedAt = new Date().toISOString();
  await save(row);
  await refreshCalendar();
  toast("Час консультації змінено.");
}
async function exportBackup() {
  const rows = await getAll();
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), consultations: rows }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-calendar-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Резервну копію завантажено.");
}
async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.consultations)) throw new Error("У файлі немає списку консультацій.");
    for (const row of parsed.consultations) {
      if (!row.id || !row.title || !row.startsAt || !row.timezone) continue;
      await save(row);
    }
    await refreshCalendar();
    toast(`Імпортовано ${parsed.consultations.length} записів.`);
  } catch (error) {
    toast(error.message || "Не вдалося прочитати резервну копію.");
  }
}
async function reminderCheck() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = Date.now();
  const rows = await getAll();
  for (const row of rows) {
    const start = Date.parse(row.startsAt);
    const reminder = start - 30 * 60 * 1000;
    if (now >= reminder && now < start && !notifiedInThisSession.has(row.id)) {
      notifiedInThisSession.add(row.id);
      new Notification("Консультація через 30 хвилин", {
        body: `${row.title} · ${fmt(row.startsAt, row.timezone)}`,
        icon: "/icon-192.png"
      });
    }
  }
}
async function enableNotifications() {
  if (!("Notification" in window)) return toast("Цей браузер не підтримує сповіщення.");
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    toast("Сповіщення дозволені. Вони працюватимуть, поки календар відкритий.");
  } else {
    toast("Дозвіл на сповіщення не надано.");
  }
}
function initCalendar() {
  calendar = new Calendar($("#calendar"), {
    plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin],
    initialView: "dayGridMonth",
    locale: "uk",
    firstDay: 1,
    timeZone: "Asia/Tbilisi",
    height: "auto",
    headerToolbar: { left: "", center: "", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" },
    buttonText: { today: "Сьогодні", month: "Місяць", week: "Тиждень", day: "День", list: "Список" },
    editable: true,
    selectable: true,
    selectMirror: true,
    dayMaxEvents: 3,
    slotMinTime: "06:00:00",
    slotMaxTime: "23:00:00",
    nowIndicator: true,
    eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
    eventClick: (info) => openModal(info.event.extendedProps.row),
    dateClick: (info) => openModal(null, info.date),
    select: (info) => { openModal(null, info.start); calendar.unselect(); },
    eventDrop: moveEvent,
    eventResize: moveEvent,
    datesSet: (info) => { $("#month-title").textContent = info.view.title; }
  });
  calendar.render();
}
async function init() {
  try {
    db = await openDB();
    initCalendar();
    await refreshCalendar();
    $("#event-form").addEventListener("submit", saveForm);
    $("#event-zone").addEventListener("change", updateTimePreview);
    $("#event-start").addEventListener("input", updateTimePreview);
    $("#delete-btn").addEventListener("click", deleteCurrent);
    $("#new-btn").addEventListener("click", () => openModal());
    $("#today-btn").addEventListener("click", () => calendar.today());
    $("#prev-btn").addEventListener("click", () => calendar.prev());
    $("#next-btn").addEventListener("click", () => calendar.next());
    $("#export-btn").addEventListener("click", exportBackup);
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => e.target.files[0] && importBackup(e.target.files[0]));
    $("#notify-btn").addEventListener("click", enableNotifications);
    $("#search").addEventListener("input", async (e) => {
      const query = e.target.value.toLowerCase().trim();
      const rows = await getAll();
      calendar.removeAllEvents();
      calendar.addEventSource(rows.filter((r) => !query || `${r.title} ${r.notes}`.toLowerCase().includes(query)).map((row) => ({
        id: row.id, title: row.title, start: row.startsAt,
        end: DateTime.fromISO(row.startsAt).plus({ minutes: row.duration }).toISO(),
        extendedProps: { row }
      })));
    });
    $("#close-modal").addEventListener("click", () => $("#event-modal").close());
    $("#cancel-btn").addEventListener("click", () => $("#event-modal").close());
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    reminderTimer = setInterval(reminderCheck, 30_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reminderCheck(); });
    $("#privacy-note").textContent = "Дані зберігаються лише в цьому браузері на цьому пристрої. Експортуй резервну копію регулярно.";
  } catch (error) {
    console.error(error);
    toast("Не вдалося запустити календар. Перезавантаж сторінку.");
  }
}
init();
