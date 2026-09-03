import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const sessions = new Map();

app.use(express.json());
app.use(express.static(__dirname));

async function readDb() {
  return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
}
async function writeDb(db) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt < now) sessions.delete(token);
}
function auth(req, res, next) {
  cleanExpiredSessions();
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const session = token ? sessions.get(token) : null;
  if (!session || session.role !== 'admin') return res.status(401).json({ error: 'نیاز به ورود ادمین دارید.' });
  req.admin = session;
  next();
}
function normalizePhone(phone = '') { return phone.replace(/\D/g, '').replace(/^98/, '0'); }
function findAvailableTimes(hours, appointments, date, duration) {
  const d = new Date(`${date}T12:00:00`);
  const idx = (d.getDay() + 1) % 7;
  const [start, end] = hours[idx] || ['09:00', '20:00'];
  const toMin = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
  const from = toMin(start); const until = toMin(end);
  const busy = appointments.filter(a => a.date === date && a.status !== 'cancelled').map(a => ({ start: toMin(a.time), end: toMin(a.time) + a.duration }));
  const result = [];
  for (let m = from; m + duration <= until; m += 30) {
    const clash = busy.some(b => m < b.end && m + duration > b.start);
    if (!clash) result.push(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
  }
  return result;
}

app.get('/api/public', async (_req, res) => {
  const db = await readDb();
  res.json({ services: db.services, hours: db.hours, reviews: db.reviews, gallery: db.gallery, loyalty: db.loyalty });
});
app.get('/api/availability', async (req, res) => {
  const { date, service } = req.query;
  const db = await readDb();
  const item = db.services.find(s => s.id === service);
  if (!date || !item) return res.status(400).json({ error: 'تاریخ یا خدمت نامعتبر است.' });
  res.json({ date, times: findAvailableTimes(db.hours, db.appointments, date, item.minutes) });
});
app.post('/api/bookings', async (req, res) => {
  const { name, phone, service, date, time, note = '' } = req.body || {};
  const db = await readDb();
  const item = db.services.find(s => s.id === service);
  if (!name?.trim() || !phone?.trim() || !item || !date || !time) return res.status(400).json({ error: 'اطلاعات رزرو کامل نیست.' });
  const available = findAvailableTimes(db.hours, db.appointments, date, item.minutes);
  if (!available.includes(time)) return res.status(409).json({ error: 'این ساعت دیگر آزاد نیست.' });
  let customer = db.customers.find(c => normalizePhone(c.phone) === normalizePhone(phone));
  if (!customer) {
    customer = { id: `c_${Date.now()}`, name: name.trim(), phone: phone.trim(), sessions: 0, notes: '', avatar: db.gallery[0]?.url || '', history: [] };
    db.customers.push(customer);
  } else customer.name = name.trim();
  const customerCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const appointment = { id: `a_${Date.now()}`, customerId: customer.id, name: name.trim(), phone: phone.trim(), service, duration: item.minutes, price: item.price, date, time, note: String(note).slice(0, 500), status: 'pending', customerCode, createdAt: new Date().toISOString() };
  db.appointments.unshift(appointment);
  await writeDb(db);
  res.status(201).json({ booking: { id: appointment.id, code: customerCode, ...appointment, serviceName: item.name } });
});
app.post('/api/customer/lookup', async (req, res) => {
  const { phone, code } = req.body || {};
  const db = await readDb();
  const appt = db.appointments.find(a => normalizePhone(a.phone) === normalizePhone(phone) && a.customerCode === String(code || '').toUpperCase());
  if (!appt) return res.status(404).json({ error: 'اطلاعات ورود مشتری پیدا نشد.' });
  const customer = db.customers.find(c => c.id === appt.customerId);
  const appointments = db.appointments.filter(a => a.customerId === customer.id).map(a => ({ id:a.id, date:a.date, time:a.time, status:a.status, serviceName: db.services.find(s=>s.id===a.service)?.name || a.service, price:a.price }));
  res.json({ customer: { id: customer.id, name: customer.name, phone: customer.phone, sessions: customer.sessions, history: customer.history, loyalty: db.loyalty }, appointments });
});
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { role: 'admin', username, expiresAt: Date.now() + SESSION_TTL_MS });
  res.json({ token, expiresAt: Date.now() + SESSION_TTL_MS });
});
app.post('/api/admin/logout', auth, (req, res) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, ''); if (token) sessions.delete(token); res.json({ ok:true });
});
app.get('/api/admin/dashboard', auth, async (_req, res) => {
  const db = await readDb();
  const today = new Date().toISOString().slice(0,10);
  const stats = { today: db.appointments.filter(a => a.date === today && a.status !== 'cancelled').length, pending: db.appointments.filter(a => a.status === 'pending').length, customers: db.customers.length, sessions: db.customers.reduce((n,c)=>n+c.sessions,0) };
  res.json({ stats, appointments: db.appointments, customers: db.customers, services: db.services, hours: db.hours });
});
app.patch('/api/admin/appointments/:id', auth, async (req,res)=>{
  const db = await readDb(); const appt = db.appointments.find(a=>a.id===req.params.id); if(!appt) return res.status(404).json({error:'نوبت پیدا نشد.'});
  const next = ['pending','confirmed','completed','cancelled'].includes(req.body.status) ? req.body.status : appt.status;
  if (next === 'completed' && appt.status !== 'completed') {
    const c = db.customers.find(c=>c.id===appt.customerId); if (c) { c.sessions += 1; c.history.unshift([appt.date, db.services.find(s=>s.id===appt.service)?.name || appt.service, appt.note || '']); }
  }
  appt.status = next;
  await writeDb(db); res.json({ok:true});
});
app.delete('/api/admin/appointments/:id', auth, async (req,res)=>{ const db=await readDb(); db.appointments=db.appointments.filter(a=>a.id!==req.params.id); await writeDb(db); res.json({ok:true}); });
app.patch('/api/admin/customers/:id', auth, async (req,res)=>{ const db=await readDb(); const c=db.customers.find(x=>x.id===req.params.id); if(!c)return res.status(404).json({error:'مشتری پیدا نشد.'}); if(typeof req.body.notes==='string')c.notes=req.body.notes.slice(0,3000); await writeDb(db); res.json({ok:true}); });
app.patch('/api/admin/services/:id', auth, async (req,res)=>{ const db=await readDb(); const s=db.services.find(x=>x.id===req.params.id); if(!s)return res.status(404).json({error:'خدمت پیدا نشد.'}); Object.assign(s,{name:req.body.name ?? s.name,minutes:Number(req.body.minutes)||s.minutes,price:Number(req.body.price)||s.price,desc:req.body.desc ?? s.desc}); await writeDb(db); res.json({ok:true}); });
app.patch('/api/admin/hours', auth, async (req,res)=>{ const db=await readDb(); if(!Array.isArray(req.body.hours)||req.body.hours.length!==7)return res.status(400).json({error:'ساعات کاری نامعتبر است.'}); db.hours=req.body.hours; await writeDb(db); res.json({ok:true}); });

app.use((_req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT, ()=>console.log(`Massage app running on http://localhost:${PORT}`));
