require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const OTP_TTL_MS = 5 * 60 * 1000;      // OTP valid for 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;  // 1 OTP per minute per email
const MAX_ATTEMPTS = 5;

/* ---------- tiny JSON "database" ---------- */
const DB_FILE = path.join(__dirname, 'db.json');
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: {}, otps: {}, bookmarks: [] }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

/* ---------- mail ---------- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: Number(process.env.SMTP_PORT || 465) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

function sendMail(to, subject, html) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to, subject, html,
  });
}

const wrap = (inner) => `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e3f5;border-radius:16px">
  <h2 style="margin:0 0 16px;color:#1e1b3a">Campus <span style="color:#6c4fe6">Radar</span></h2>
  ${inner}
  <p style="color:#999;font-size:12px;margin-top:24px">If this wasn't you, ignore this email.</p>
</div>`;

/* ---------- helpers ---------- */
const hashOtp = (email, otp) =>
  crypto.createHmac('sha256', JWT_SECRET).update(email + ':' + otp).digest('hex');

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

// Date-only deadlines ("2026-12-05") are treated as end of day IST
function parseDeadline(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) d += 'T23:59:00+05:30';
  const t = new Date(d);
  return isNaN(t) ? null : t.toISOString();
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, login again' });
  }
}

/* ---------- app ---------- */
const app = express();
app.use(express.json({ limit: '50kb' }));
const origins = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5500,http://localhost:5500').split(',');
app.use(cors({ origin: origins }));

/* 1) Request OTP */
app.post('/api/auth/request-otp', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });

  const db = loadDB();
  const existing = db.otps[email];
  if (existing && Date.now() - existing.sentAt < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.sentAt)) / 1000);
    return res.status(429).json({ error: `Wait ${wait}s before requesting another OTP` });
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  db.otps[email] = { hash: hashOtp(email, otp), expires: Date.now() + OTP_TTL_MS, attempts: 0, sentAt: Date.now() };
  saveDB(db);

  try {
    await sendMail(email, `${otp} is your Campus Radar login code`, wrap(`
      <p>Your one-time login code:</p>
      <div style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#6c4fe6;margin:12px 0">${otp}</div>
      <p>Valid for 5 minutes. Don't share it with anyone.</p>`));
    res.json({ ok: true });
  } catch (e) {
    console.error('Mail error:', e.message);
    res.status(500).json({ error: 'Could not send email. Check SMTP settings in .env' });
  }
});

/* 2) Verify OTP -> JWT */
app.post('/api/auth/verify-otp', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();
  if (!isEmail(email) || !/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Invalid email or OTP format' });

  const db = loadDB();
  const rec = db.otps[email];
  if (!rec) return res.status(400).json({ error: 'Request an OTP first' });
  if (Date.now() > rec.expires) { delete db.otps[email]; saveDB(db); return res.status(400).json({ error: 'OTP expired, request a new one' }); }
  if (rec.attempts >= MAX_ATTEMPTS) { delete db.otps[email]; saveDB(db); return res.status(429).json({ error: 'Too many wrong attempts, request a new OTP' }); }

  const a = Buffer.from(rec.hash), b = Buffer.from(hashOtp(email, otp));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    rec.attempts++; saveDB(db);
    return res.status(400).json({ error: `Wrong OTP (${MAX_ATTEMPTS - rec.attempts} tries left)` });
  }

  delete db.otps[email];
  if (!db.users[email]) db.users[email] = { email, createdAt: new Date().toISOString() };
  saveDB(db);

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, token, email });
});

/* 3) Bookmarks */
app.get('/api/bookmarks', auth, (req, res) => {
  const db = loadDB();
  res.json(db.bookmarks.filter(b => b.email === req.user.email));
});

app.post('/api/bookmarks', auth, (req, res) => {
  const { hackathonId, title, deadline, url } = req.body || {};
  const iso = parseDeadline(deadline);
  if (!hackathonId || !title || !iso) return res.status(400).json({ error: 'hackathonId, title and valid deadline required' });

  const db = loadDB();
  const id = String(hackathonId);
  const dup = db.bookmarks.find(b => b.email === req.user.email && b.hackathonId === id);
  if (dup) return res.json({ ok: true, bookmark: dup });

  const bookmark = {
    email: req.user.email, hackathonId: id,
    title: String(title).slice(0, 200), deadline: iso,
    url: typeof url === 'string' ? url.slice(0, 500) : '',
    sent: [], createdAt: new Date().toISOString(),
  };
  db.bookmarks.push(bookmark);
  saveDB(db);
  res.json({ ok: true, bookmark });
});

app.delete('/api/bookmarks/:hackathonId', auth, (req, res) => {
  const db = loadDB();
  db.bookmarks = db.bookmarks.filter(b => !(b.email === req.user.email && b.hackathonId === req.params.hackathonId));
  saveDB(db);
  res.json({ ok: true });
});

/* ---------- reminder job ---------- */
// Sends one email at <=72h left and one at <=24h left, per bookmark. Never duplicates.
async function runReminders() {
  const db = loadDB();
  const now = Date.now();
  let changed = false;

  for (const b of db.bookmarks) {
    const hoursLeft = (new Date(b.deadline).getTime() - now) / 3600000;
    if (hoursLeft <= 0) continue;
    const stage = hoursLeft <= 24 ? 24 : hoursLeft <= 72 ? 72 : null;
    if (!stage || b.sent.includes(stage)) continue;

    const when = new Date(b.deadline).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    const left = hoursLeft < 24 ? `${Math.max(1, Math.round(hoursLeft))} hour(s)` : `${Math.round(hoursLeft / 24)} day(s)`;
    try {
      await sendMail(b.email, `Deadline in ${left}: ${b.title}`, wrap(`
        <p>The deadline for a hackathon you saved is close:</p>
        <h3 style="margin:8px 0;color:#1e1b3a">${escapeHtml(b.title)}</h3>
        <p><b>Deadline:</b> ${when} IST<br><b>Time left:</b> ~${left}</p>
        ${b.url ? `<p><a href="${encodeURI(b.url)}" style="background:#6c4fe6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Register now</a></p>` : ''}`));
      b.sent.push(stage);
      if (stage === 24 && !b.sent.includes(72)) b.sent.push(72);
      changed = true;
      console.log(`Reminder (${stage}h) sent to ${b.email} for ${b.title}`);
    } catch (e) {
      console.error('Reminder failed:', e.message);
    }
  }
  if (changed) saveDB(db);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

cron.schedule('0 * * * *', runReminders); // every hour on the hour
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Campus Radar API running on http://localhost:${PORT}`);
  runReminders();
});
