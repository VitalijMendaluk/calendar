import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { createClient } from "@supabase/supabase-js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { uk } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Search, LogOut, Bell, Download, X, Clock3, MapPin, Pencil, Trash2 } from "lucide-react";
import "./style.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const ZONES = {
  "Грузія · Тбілісі": "Asia/Tbilisi",
  "Україна · Київ": "Europe/Kyiv",
  "Польща · Варшава": "Europe/Warsaw"
};

const toLocalInput = (iso, zone) => iso ? formatInTimeZone(new Date(iso), zone, "yyyy-MM-dd'T'HH:mm") : "";
const fromLocalInput = (value, zone) => fromZonedTime(value, zone).toISOString();
const fmt = (iso, zone, pattern = "dd.MM.yyyy, HH:mm") =>
  iso ? formatInTimeZone(new Date(iso), zone, pattern, { locale: uk }) : "—";
const decodeKey = (base64) => {
  const pad = "=".repeat((4 - base64.length % 4) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [calendarTitle, setCalendarTitle] = useState("Календар");
  const [form, setForm] = useState(emptyForm());
  const calendarRef = useRef(null);

  function emptyForm() {
    const zone = "Asia/Tbilisi";
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const rounded = new Date(start);
    rounded.setMinutes(Math.ceil(rounded.getMinutes() / 15) * 15, 0, 0);
    return { title: "", timezone: zone, start_local: toLocalInput(rounded.toISOString(), zone), duration: 60, notes: "" };
  }

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadEvents(); }, [session]);

  async function signIn(e) {
    e.preventDefault(); setAuthError("");
    if (!supabase) return setAuthError("Спочатку додай змінні Supabase у Vercel.");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setAuthError("Не вдалося увійти. Перевір email і пароль.");
  }

  async function loadEvents() {
    setLoading(true);
    const { data, error } = await supabase.from("consultations").select("*").order("starts_at");
    if (error) setNotice("Помилка завантаження: " + error.message);
    else setEvents(data || []);
    setLoading(false);
  }

  function openNew(dateStr) {
    const f = emptyForm();
    if (dateStr) {
      const d = new Date(dateStr);
      f.start_local = toLocalInput(d.toISOString(), "Asia/Tbilisi");
    }
    setEditing(null); setForm(f); setModal(true);
  }

  function openEdit(event) {
    const row = event.extendedProps.row || event;
    setEditing(row);
    setForm({
      title: row.title || "",
      timezone: row.timezone || "Asia/Tbilisi",
      start_local: toLocalInput(row.starts_at, row.timezone || "Asia/Tbilisi"),
      duration: row.duration_minutes || 60,
      notes: row.notes || ""
    });
    setModal(true);
  }

  async function saveEvent(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.start_local) return;
    const starts = fromLocalInput(form.start_local, form.timezone);
    const payload = {
      title: form.title.trim(),
      timezone: form.timezone,
      starts_at: starts,
      duration_minutes: Number(form.duration),
      notes: form.notes.trim(),
      reminder_at: new Date(new Date(starts).getTime() - 30 * 60 * 1000).toISOString()
    };
    let result;
    if (editing) result = await supabase.from("consultations").update({ ...payload, reminder_sent_at: null }).eq("id", editing.id);
    else result = await supabase.from("consultations").insert(payload);
    if (result.error) setNotice("Не вдалося зберегти: " + result.error.message);
    else { setModal(false); setNotice("Збережено"); await loadEvents(); }
  }

  async function deleteEvent() {
    if (!editing || !confirm("Видалити цю консультацію?")) return;
    const { error } = await supabase.from("consultations").delete().eq("id", editing.id);
    if (error) setNotice("Не вдалося видалити: " + error.message);
    else { setModal(false); setNotice("Консультацію видалено"); await loadEvents(); }
  }

  async function moveEvent(info) {
    const row = info.event.extendedProps.row;
    const newStart = info.event.start;
    const newIso = newStart.toISOString();
    const { error } = await supabase.from("consultations").update({
      starts_at: newIso,
      duration_minutes: info.event.end ? Math.max(15, Math.round((info.event.end.getTime() - newStart.getTime()) / 60000)) : row.duration_minutes,
      reminder_at: new Date(newStart.getTime() - 30 * 60 * 1000).toISOString(),
      reminder_sent_at: null
    }).eq("id", row.id);
    if (error) { info.revert(); setNotice("Не вдалося перенести: " + error.message); }
    else await loadEvents();
  }

  async function enablePush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setNotice("Цей браузер не підтримує Web Push. На iPhone додай сайт на головний екран і відкрий його звідти.");
        return;
      }
      if (!VAPID_PUBLIC_KEY) { setNotice("Не задано VITE_VAPID_PUBLIC_KEY у Vercel."); return; }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setNotice("Дозвіл на сповіщення не надано."); return; }
      const registration = await navigator.serviceWorker.register("/sw.js");
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(VAPID_PUBLIC_KEY)
      });
      const { error } = await supabase.from("push_subscriptions").upsert({
        endpoint: subscription.endpoint,
        subscription: subscription.toJSON()
      }, { onConflict: "endpoint" });
      if (error) throw error;
      setNotice("Push-сповіщення увімкнено на цьому iPhone.");
    } catch (err) {
      setNotice("Не вдалося ввімкнути сповіщення: " + (err?.message || "невідома помилка"));
    }
  }

  async function exportData() {
    const { data, error } = await supabase.from("consultations").select("*").order("starts_at");
    if (error) return setNotice("Експорт не вдався: " + error.message);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `calendar-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
    setNotice("Резервну копію завантажено.");
  }

  const calendarEvents = useMemo(() => events.map((row) => ({
    id: row.id,
    title: row.title,
    start: row.starts_at,
    end: new Date(new Date(row.starts_at).getTime() + row.duration_minutes * 60000).toISOString(),
    extendedProps: { row }
  })).filter((e) => !search || e.title.toLowerCase().includes(search.toLowerCase()) || (e.extendedProps.row.notes || "").toLowerCase().includes(search.toLowerCase())), [events, search]);

  if (authLoading) return <div className="splash">Завантаження…</div>;
  if (!session) return <main className="login-shell"><div className="login-card">
    <div className="brand-mark"><CalendarDays size={22}/></div><p className="eyebrow">PERSONAL WORKSPACE</p>
    <h1>Мій календар</h1><p className="muted">Особистий простір для консультацій</p>
    <form onSubmit={signIn} className="login-form">
      <label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
      <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required /></label>
      {authError && <p className="error">{authError}</p>}
      <button className="primary full" type="submit">Увійти</button>
    </form>
    <p className="tiny muted">Доступ лише для власника календаря.</p>
  </div></main>;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><CalendarDays size={20}/></div><div><strong>Мій календар</strong><span>Особисті консультації</span></div></div>
      <div className="top-actions">
        <button className="icon-btn" title="Увімкнути нагадування" onClick={enablePush}><Bell size={18}/></button>
        <button className="icon-btn" title="Завантажити резервну копію" onClick={exportData}><Download size={18}/></button>
        <button className="icon-btn" title="Вийти" onClick={()=>supabase.auth.signOut()}><LogOut size={18}/></button>
      </div>
    </header>
    <section className="toolbar">
      <div className="toolbar-left">
        <button className="today-btn" onClick={()=>calendarRef.current?.getApi().today()}>Сьогодні</button>
        <button className="nav-btn" onClick={()=>calendarRef.current?.getApi().prev()}><ChevronLeft size={18}/></button>
        <button className="nav-btn" onClick={()=>calendarRef.current?.getApi().next()}><ChevronRight size={18}/></button>
        <h2>{calendarTitle}</h2>
      </div>
      <div className="toolbar-right">
        <div className="searchbox"><Search size={16}/><input placeholder="Пошук" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <button className="primary add-btn" onClick={()=>openNew()}><Plus size={18}/> <span>Нова консультація</span></button>
      </div>
    </section>
    <section className="calendar-card">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale="uk"
        firstDay={1}
        height="auto"
        headerToolbar={{ left: "", center: "", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
        buttonText={{ today: "Сьогодні", month: "Місяць", week: "Тиждень", day: "День", list: "Список" }}
        events={calendarEvents}
        editable={true}
        selectable={true}
        selectMirror={true}
        dayMaxEvents={3}
        eventClick={(info)=>openEdit(info.event)}
        dateClick={(info)=>openNew(info.dateStr)}
        eventDrop={moveEvent}
        eventResize={moveEvent}
        datesSet={(arg)=>setCalendarTitle(arg.view.title)}
        slotMinTime="06:00:00"
        slotMaxTime="23:00:00"
        nowIndicator={true}
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        timeZone="Asia/Tbilisi"
        longPressDelay={250}
        select={(info)=>{ openNew(info.startStr); calendarRef.current?.getApi().unselect(); }}
      />
      {loading && <div className="loading-line">Оновлюємо записи…</div>}
    </section>
    <div className="timezone-note"><MapPin size={14}/> Час календаря: Тбілісі (Asia/Tbilisi). Час кожної консультації зберігається з її часовим поясом.</div>
    {notice && <button className="toast" onClick={()=>setNotice("")}>{notice}<X size={14}/></button>}
    {modal && <div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)setModal(false);}}>
      <form className="event-modal" onSubmit={saveEvent}>
        <div className="modal-head"><div><p className="eyebrow">{editing ? "РЕДАГУВАННЯ" : "НОВИЙ ЗАПИС"}</p><h3>{editing ? "Консультація" : "Нова консультація"}</h3></div><button type="button" className="icon-btn" onClick={()=>setModal(false)}><X size={18}/></button></div>
        <label>Назва / ім'я клієнта<input autoFocus value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Наприклад, Марія — консультація" required /></label>
        <label>Часовий пояс клієнта<select value={form.timezone} onChange={e=>setForm({...form,timezone:e.target.value,start_local:form.start_local})}>{Object.entries(ZONES).map(([label,value])=><option key={value} value={value}>{label}</option>)}</select></label>
        <div className="form-grid">
          <label>Дата та час клієнта<input type="datetime-local" value={form.start_local} onChange={e=>setForm({...form,start_local:e.target.value})} required /></label>
          <label>Тривалість<select value={form.duration} onChange={e=>setForm({...form,duration:e.target.value})}><option value="30">30 хв</option><option value="45">45 хв</option><option value="60">60 хв</option><option value="90">90 хв</option><option value="120">120 хв</option></select></label>
        </div>
        <div className="time-preview"><Clock3 size={16}/><span>У Тбілісі: <strong>{form.start_local ? fmt(fromLocalInput(form.start_local,form.timezone),"Asia/Tbilisi") : "—"}</strong></span></div>
        <label>Нотатки<textarea rows="4" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Будь-яка інформація, яку хочеш зберегти…"/></label>
        <div className="reminder-line"><Bell size={15}/> Push-нагадування за 30 хвилин</div>
        <div className="modal-actions">
          {editing && <button type="button" className="danger-btn" onClick={deleteEvent}><Trash2 size={16}/> Видалити</button>}
          <button type="button" className="secondary" onClick={()=>setModal(false)}>Скасувати</button>
          <button className="primary" type="submit"><Pencil size={16}/> Зберегти</button>
        </div>
      </form>
    </div>}
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
