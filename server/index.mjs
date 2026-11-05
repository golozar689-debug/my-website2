import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, statSync, realpathSync, createReadStream } from 'node:fs';
import { dirname, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const SLOT_TIMES = ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30'];
const APPOINTMENT_TYPES = new Set(['consultation', 'followup', 'online']);
const tehranFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function localDateTime(date) {
  const values = Object.fromEntries(tehranFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function normalizeDigits(value) {
  return value.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
}

function textField(value, max, label, min = 1) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} معتبر وارد کنید.`);
  const valueTrimmed = value.trim();
  if (valueTrimmed.length < min || valueTrimmed.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(valueTrimmed)) {
    throw new HttpError(400, `${label} باید بین ${min} و ${max} نویسه باشد.`);
  }
  return valueTrimmed;
}

function emailField(value) {
  const email = textField(value, 254, 'ایمیل').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'نشانی ایمیل معتبر وارد کنید.');
  return email;
}

function passwordField(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpError(400, 'رمز عبور باید بین ۸ و ۱۲۸ نویسه باشد.');
  }
  return value;
}

function phoneField(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'شماره موبایل معتبر وارد کنید.');
  let phone = normalizeDigits(value).replace(/[\s-]/g, '');
  if (phone.startsWith('+98')) phone = '0' + phone.slice(3);
  if (!/^09\d{9}$/.test(phone)) throw new HttpError(400, 'شماره موبایل را با ۰۹ و در ۱۱ رقم وارد کنید.');
  return phone;
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'اطلاعات باید با فرمت JSON ارسال شوند.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new HttpError(413, 'حجم اطلاعات ارسالی بیش از حد مجاز است.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'اطلاعات ارسالی معتبر نیست.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'اطلاعات ارسالی معتبر نیست.');
  return body;
}

function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role === 'admin' ? 'admin' : 'user' }; }

function publicAppointment(row) {
  return {
    id: row.id, date: row.date, time: row.time, type: row.type,
    phone: row.phone, status: row.status || 'pending', createdAt: row.created_at,
  };
}

function publicReview(row) {
  return { id: row.id, name: row.name, rating: row.rating, comment: row.comment, createdAt: row.created_at };
}

/** Creates an isolated HTTP application. No listener is started until server.listen(). */
export function createApp({
  dbPath = process.env.DB_PATH || resolve(projectRoot, '.data', 'site.sqlite'),
  distDir = resolve(projectRoot, 'dist'),
  now = () => new Date(),
  appOrigin = process.env.APP_ORIGIN,
  adminEmail = process.env.ADMIN_EMAIL,
  adminPassword = process.env.ADMIN_PASSWORD,
} = {}) {
  // Only server-controlled paired credentials can create the owner. A public
  // registration or an email address alone can never grant administration.
  let ownerEmail = null;
  if (Boolean(adminEmail) !== Boolean(adminPassword)) {
    console.warn('Administrator provisioning skipped: both ADMIN_EMAIL and ADMIN_PASSWORD are required.');
  }
  if (adminEmail && adminPassword) {
    try { ownerEmail = emailField(adminEmail); }
    catch { throw new Error('ADMIN_EMAIL must be a valid email address.'); }
    if (typeof adminPassword !== 'string' || adminPassword.length < 12 || adminPassword.length > 128) {
      throw new Error('ADMIN_PASSWORD must contain 12 to 128 characters.');
    }
  }
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, time TEXT NOT NULL, type TEXT NOT NULL, phone TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(date, time)
    );
    CREATE INDEX IF NOT EXISTS appointments_user ON appointments(user_id);
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5), comment TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);

  // Additive migration keeps accounts, bookings and reviews from older versions.
  db.exec('BEGIN IMMEDIATE');
  try {
    const addColumn = (table, name, declaration) => {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
      }
    };
    addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'))");
    addColumn('users', 'blocked', 'INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1))');
    addColumn('appointments', 'status', "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed'))");
    addColumn('reviews', 'hidden', 'INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1))');
    db.exec(`CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  function audit(actorId, action, targetType, targetId) {
    db.prepare('INSERT INTO admin_audit (actor_id,action,target_type,target_id,created_at) VALUES (?,?,?,?,?)')
      .run(actorId, action, targetType, targetId, now().toISOString());
  }

  if (ownerEmail) {
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(ownerEmail);
    const salt = existing?.password_salt || randomBytes(16).toString('hex');
    const key = scryptSync(adminPassword, salt, 64);
    const storedKey = existing ? Buffer.from(existing.password_hash, 'hex') : null;
    const samePassword = storedKey?.length === key.length && timingSafeEqual(key, storedKey);
    const changedOwner = !existing || existing.role !== 'admin' || existing.blocked || !samePassword;
    const previousOwners = db.prepare("SELECT id,password_hash,password_salt FROM users WHERE role = 'admin' AND email <> ?").all(ownerEmail);
    // An outgoing owner may know their previous password. Ownership transfer
    // must not let that credential authenticate as the newly configured owner.
    for (const previous of previousOwners) {
      const previousKey = Buffer.from(previous.password_hash, 'hex');
      const candidate = scryptSync(adminPassword, previous.password_salt, 64);
      if (previousKey.length === candidate.length && timingSafeEqual(previousKey, candidate)) {
        db.close();
        throw new Error('Changing ADMIN_EMAIL requires a new ADMIN_PASSWORD.');
      }
    }
    if (changedOwner || previousOwners.length) {
      db.exec('BEGIN IMMEDIATE');
      try {
        let ownerId = existing?.id;
        if (changedOwner && existing) {
          db.prepare("UPDATE users SET role = 'admin', blocked = 0, password_hash = ? WHERE id = ?")
            .run(key.toString('hex'), existing.id);
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
        } else if (!existing) {
          ownerId = Number(db.prepare(`INSERT INTO users (name,email,password_hash,password_salt,created_at,role)
            VALUES (?,?,?,?,?,'admin')`).run('مدیر سایت', ownerEmail, key.toString('hex'), salt, now().toISOString()).lastInsertRowid);
        }
        if (changedOwner) audit(ownerId, 'admin.provisioned', 'user', ownerId);
        for (const previous of previousOwners) {
          db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(previous.id);
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(previous.id);
          audit(ownerId, 'admin.demoted', 'user', previous.id);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        db.close();
        throw error;
      }
    }
  }

  const rateBuckets = new Map();
  // A precomputed dummy key keeps missing-account and wrong-password checks comparable.
  const dummySalt = randomBytes(16).toString('hex');
  const dummyKey = randomBytes(64);

  function rateLimit(req, scope, limit, duration = 15 * 60_000) {
    const timestamp = now().getTime();
    if (rateBuckets.size > 2000) {
      for (const [key, bucket] of rateBuckets) if (bucket.until <= timestamp) rateBuckets.delete(key);
    }
    const key = `${scope}:${req.socket.remoteAddress}`;
    const previous = rateBuckets.get(key);
    const bucket = previous && previous.until > timestamp ? previous : { count: 0, until: timestamp + duration };
    bucket.count++;
    rateBuckets.set(key, bucket);
    if (bucket.count > limit) throw new HttpError(429, 'تعداد درخواست‌ها زیاد است؛ چند دقیقه دیگر دوباره تلاش کنید.');
  }

  function send(res, status, body, extra = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store', ...extra,
    });
    res.end(payload);
  }

  function checkSameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'درخواست از این مبدأ مجاز نیست.');
    const origin = req.headers.origin;
    if (!origin) return;
    let parsed;
    try { parsed = new URL(origin); }
    catch { throw new HttpError(403, 'مبدأ درخواست معتبر نیست.'); }
    const permitted = parsed.host === req.headers.host && ['http:', 'https:'].includes(parsed.protocol);
    if (!permitted && origin !== appOrigin) throw new HttpError(403, 'درخواست از این مبدأ مجاز نیست.');
  }

  function sessionToken(req) {
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('vazirian_session='));
    return cookie ? cookie.slice('vazirian_session='.length) : null;
  }

  function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }

  function getUser(req, required = true) {
    const token = sessionToken(req);
    const user = token && /^[a-f0-9]{64}$/.test(token) ? db.prepare(`
      SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token), now().getTime()) : null;
    if (user?.blocked) throw new HttpError(401, 'دسترسی این حساب مسدود شده است.');
    if (!user && required) throw new HttpError(401, 'برای ادامه وارد حساب کاربری شوید.');
    return user || null;
  }

  function getAdmin(req) {
    const user = getUser(req);
    if (user.role !== 'admin') throw new HttpError(403, 'دسترسی به این بخش فقط برای مدیر سایت مجاز است.');
    return user;
  }

  function resourceId(value) {
    const id = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'مورد موردنظر پیدا نشد.');
    return id;
  }

  function pagination(url) {
    const raw = url.searchParams.get('page') ?? '1';
    if (!/^[1-9]\d*$/.test(raw)) throw new HttpError(400, 'شماره صفحه معتبر نیست.');
    const page = Number(raw);
    if (!Number.isSafeInteger(page) || page > 1_000_000) throw new HttpError(400, 'شماره صفحه معتبر نیست.');
    return { page, pageSize: 20, offset: (page - 1) * 20 };
  }

  function publicAdminUser(row) {
    return {
      ...publicUser(row), blocked: Boolean(row.blocked), createdAt: row.created_at,
      appointmentCount: row.appointment_count, reviewCount: row.review_count,
    };
  }

  function cookieFlags(req) {
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
    return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  }

  function newSession(req, userId) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now().getTime());
    const oldToken = sessionToken(req);
    if (oldToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(oldToken));
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), userId, now().getTime() + SESSION_AGE);
    return `vazirian_session=${token}; ${cookieFlags(req)}; Max-Age=${SESSION_AGE / 1000}`;
  }

  function validateDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'تاریخ نوبت معتبر نیست.');
    const dateObject = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(dateObject.getTime()) || dateObject.toISOString().slice(0, 10) !== date) throw new HttpError(400, 'تاریخ نوبت معتبر نیست.');
    const current = localDateTime(now());
    const finalDate = new Date(`${current.date}T00:00:00Z`);
    finalDate.setUTCDate(finalDate.getUTCDate() + 60);
    if (date < current.date || date > finalDate.toISOString().slice(0, 10)) {
      throw new HttpError(400, 'نوبت را از امروز تا ۶۰ روز آینده انتخاب کنید.');
    }
    return { current, closed: dateObject.getUTCDay() === 5 };
  }

  function slotsForDate(date) {
    const { current, closed } = validateDate(date);
    if (closed) return { date, slots: [], closed: true };
    const reserved = new Set(db.prepare('SELECT time FROM appointments WHERE date = ?').all(date).map(row => row.time));
    return { date, closed: false, slots: SLOT_TIMES.map(time => ({
      time, available: !reserved.has(time) && (date > current.date || time > current.time),
    })) };
  }

  async function api(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) checkSameOrigin(req);

    if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
      const admin = getAdmin(req);
      const pageInfo = pagination(url);
      const { page, pageSize, offset } = pageInfo;
      const paged = (key, rows, total) => send(res, 200, { [key]: rows, total, page, pageSize });

      if (method === 'GET' && pathname === '/api/admin/overview') {
        const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
        return send(res, 200, { stats: {
          users: count('users'), appointments: count('appointments'), reviews: count('reviews'),
          pending: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status='pending'").get().n,
          confirmed: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status='confirmed'").get().n,
        } });
      }
      if (method === 'GET' && pathname === '/api/admin/users') {
        const q = textField(url.searchParams.get('q') || '', 200, 'عبارت جست‌وجو', 0);
        const where = 'WHERE instr(lower(users.name), lower(?)) > 0 OR instr(lower(users.email), lower(?)) > 0';
        const rows = db.prepare(`SELECT users.id, users.name, users.email, users.role, users.blocked, users.created_at,
          (SELECT COUNT(*) FROM appointments WHERE appointments.user_id = users.id) AS appointment_count,
          (SELECT COUNT(*) FROM reviews WHERE reviews.user_id = users.id) AS review_count
          FROM users ${where} ORDER BY users.id DESC LIMIT ? OFFSET ?`).all(q, q, pageSize, offset);
        const total = db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(q, q).n;
        return paged('users', rows.map(publicAdminUser), total);
      }
      const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (method === 'PATCH' && userMatch) {
        const id = resourceId(userMatch[1]);
        const body = await readJson(req);
        if (typeof body.blocked !== 'boolean') throw new HttpError(400, 'وضعیت دسترسی معتبر نیست.');
        const target = db.prepare('SELECT id,role FROM users WHERE id = ?').get(id);
        if (!target) throw new HttpError(404, 'کاربر پیدا نشد.');
        if (id === admin.id || target.role === 'admin') throw new HttpError(400, 'دسترسی حساب مدیر از این بخش قابل تغییر نیست.');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(Number(body.blocked), id);
          if (body.blocked) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
          audit(admin.id, body.blocked ? 'user.blocked' : 'user.unblocked', 'user', id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(res, 200, { ok: true });
      }
      if (method === 'GET' && pathname === '/api/admin/appointments') {
        const status = url.searchParams.get('status') || 'all';
        if (!['all','pending','confirmed'].includes(status)) throw new HttpError(400, 'وضعیت نوبت معتبر نیست.');
        const where = status === 'all' ? '' : 'WHERE appointments.status = ?';
        const params = status === 'all' ? [] : [status];
        const rows = db.prepare(`SELECT appointments.*, users.name AS user_name, users.email AS user_email
          FROM appointments JOIN users ON users.id = appointments.user_id ${where}
          ORDER BY appointments.date DESC, appointments.time DESC, appointments.id DESC LIMIT ? OFFSET ?`)
          .all(...params, pageSize, offset);
        const total = db.prepare(`SELECT COUNT(*) AS n FROM appointments ${where}`).get(...params).n;
        return paged('appointments', rows.map(row => ({
          ...publicAppointment(row), userId: row.user_id, userName: row.user_name, userEmail: row.user_email,
        })), total);
      }
      const appointmentMatch = pathname.match(/^\/api\/admin\/appointments\/([^/]+)$/);
      if (['PATCH','DELETE'].includes(method) && appointmentMatch) {
        const id = resourceId(appointmentMatch[1]);
        const target = db.prepare('SELECT id FROM appointments WHERE id = ?').get(id);
        if (!target) throw new HttpError(404, 'نوبت پیدا نشد.');
        let status;
        if (method === 'PATCH') {
          const body = await readJson(req);
          if (!['pending','confirmed'].includes(body.status)) throw new HttpError(400, 'وضعیت نوبت معتبر نیست.');
          status = body.status;
        }
        db.exec('BEGIN IMMEDIATE');
        try {
          if (method === 'DELETE') db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
          else db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, id);
          audit(admin.id, method === 'DELETE' ? 'appointment.cancelled' : `appointment.${status}`, 'appointment', id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        if (method === 'DELETE') return send(res, 200, { ok: true });
        return send(res, 200, { appointment: publicAppointment(db.prepare('SELECT * FROM appointments WHERE id = ?').get(id)) });
      }
      if (method === 'GET' && pathname === '/api/admin/reviews') {
        const rows = db.prepare(`SELECT reviews.*, users.name FROM reviews JOIN users ON users.id = reviews.user_id
          ORDER BY reviews.id DESC LIMIT ? OFFSET ?`).all(pageSize, offset);
        return paged('reviews', rows.map(row => ({ ...publicReview(row), userId: row.user_id, hidden: Boolean(row.hidden) })),
          db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n);
      }
      const reviewMatch = pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
      if (method === 'PATCH' && reviewMatch) {
        const id = resourceId(reviewMatch[1]);
        const body = await readJson(req);
        if (typeof body.hidden !== 'boolean') throw new HttpError(400, 'وضعیت نمایش نظر معتبر نیست.');
        if (!db.prepare('SELECT id FROM reviews WHERE id = ?').get(id)) throw new HttpError(404, 'نظر پیدا نشد.');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE reviews SET hidden = ? WHERE id = ?').run(Number(body.hidden), id);
          audit(admin.id, body.hidden ? 'review.hidden' : 'review.published', 'review', id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(res, 200, { ok: true });
      }
      if (method === 'GET' && pathname === '/api/admin/audit') {
        const rows = db.prepare(`SELECT admin_audit.*, users.name AS actor_name FROM admin_audit
          JOIN users ON users.id = admin_audit.actor_id ORDER BY admin_audit.id DESC LIMIT ? OFFSET ?`)
          .all(pageSize, offset);
        return paged('entries', rows.map(row => ({ id: row.id, actorName: row.actor_name, action: row.action,
          targetType: row.target_type, targetId: row.target_id, createdAt: row.created_at })),
          db.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n);
      }
      return send(res, 404, { error: 'مسیر مدیریت پیدا نشد.' });
    }

    if (method === 'GET' && pathname === '/api/health') {
      db.prepare('SELECT 1').get();
      return send(res, 200, { status: 'ok', scheduleMode: 'demo' });
    }
    if (method === 'GET' && pathname === '/api/session') {
      const user = getUser(req, false);
      return send(res, 200, { user: user ? publicUser(user) : null });
    }
    if (method === 'POST' && pathname === '/api/auth/register') {
      rateLimit(req, 'register', 15);
      const body = await readJson(req);
      const name = textField(body.name, 80, 'نام و نام خانوادگی', 2);
      const email = emailField(body.email);
      const password = passwordField(body.password);
      const salt = randomBytes(16).toString('hex');
      const key = await scrypt(password, salt, 64);
      let userId;
      try {
        const result = db.prepare('INSERT INTO users (name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(name, email, key.toString('hex'), salt, now().toISOString());
        userId = Number(result.lastInsertRowid);
      } catch (error) {
        if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE')) throw new HttpError(409, 'این ایمیل قبلاً ثبت شده است؛ وارد حساب خود شوید.');
        throw error;
      }
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      return send(res, 201, { user: publicUser(user) }, { 'Set-Cookie': newSession(req, userId) });
    }
    if (method === 'POST' && pathname === '/api/auth/login') {
      rateLimit(req, 'login', 30);
      const body = await readJson(req);
      const email = emailField(body.email);
      const password = passwordField(body.password);
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const key = await scrypt(password, user?.password_salt || dummySalt, 64);
      const correct = timingSafeEqual(key, user ? Buffer.from(user.password_hash, 'hex') : dummyKey);
      if (!user || !correct) throw new HttpError(401, 'ایمیل یا رمز عبور درست نیست.');
      if (user.blocked) throw new HttpError(403, 'دسترسی این حساب مسدود شده است.');
      return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': newSession(req, user.id) });
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const token = sessionToken(req);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      return send(res, 200, { ok: true }, { 'Set-Cookie': `vazirian_session=; ${cookieFlags(req)}; Max-Age=0` });
    }
    if (method === 'GET' && pathname === '/api/availability') {
      return send(res, 200, slotsForDate(url.searchParams.get('date')));
    }
    if (method === 'GET' && pathname === '/api/appointments') {
      const user = getUser(req);
      const rows = db.prepare('SELECT * FROM appointments WHERE user_id = ? ORDER BY date, time').all(user.id);
      return send(res, 200, { appointments: rows.map(publicAppointment) });
    }
    if (method === 'POST' && pathname === '/api/appointments') {
      const user = getUser(req);
      rateLimit(req, `book:${user.id}`, 20);
      const body = await readJson(req);
      const { current, closed } = validateDate(body.date);
      if (closed) throw new HttpError(400, 'در برنامه نمونه، روز جمعه نوبتی ارائه نمی‌شود.');
      if (!SLOT_TIMES.includes(body.time) || (body.date === current.date && body.time <= current.time)) throw new HttpError(400, 'یک زمان معتبر در آینده انتخاب کنید.');
      if (!APPOINTMENT_TYPES.has(body.type)) throw new HttpError(400, 'نوع مراجعه معتبر نیست.');
      const phone = phoneField(body.phone);
      let id;
      db.exec('BEGIN IMMEDIATE');
      try {
        const count = db.prepare(`
          SELECT COUNT(*) AS count FROM appointments
          WHERE user_id = ? AND (date > ? OR (date = ? AND time > ?))
        `).get(user.id, current.date, current.date, current.time).count;
        if (count >= 5) throw new HttpError(400, 'حداکثر ۵ نوبت فعال می‌توانید داشته باشید.');
        const result = db.prepare('INSERT INTO appointments (user_id, date, time, type, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(user.id, body.date, body.time, body.type, phone, now().toISOString());
        id = Number(result.lastInsertRowid);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE')) throw new HttpError(409, 'این زمان همین الان رزرو شد؛ زمان دیگری انتخاب کنید.');
        throw error;
      }
      return send(res, 201, { appointment: publicAppointment(db.prepare('SELECT * FROM appointments WHERE id = ?').get(id)) });
    }
    const cancelMatch = pathname.match(/^\/api\/appointments\/(\d+)$/);
    if (method === 'DELETE' && cancelMatch) {
      const user = getUser(req);
      const id = Number(cancelMatch[1]);
      if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'نوبت مورد نظر پیدا نشد.');
      const result = db.prepare('DELETE FROM appointments WHERE id = ? AND user_id = ?').run(id, user.id);
      if (result.changes === 0) throw new HttpError(404, 'نوبت مورد نظر پیدا نشد.');
      return send(res, 200, { ok: true });
    }
    if (method === 'GET' && pathname === '/api/reviews') {
      const rows = db.prepare(`SELECT reviews.*, users.name FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.hidden = 0 ORDER BY reviews.id DESC LIMIT 100`).all();
      return send(res, 200, { reviews: rows.map(publicReview) });
    }
    if (method === 'POST' && pathname === '/api/reviews') {
      const user = getUser(req);
      rateLimit(req, `review:${user.id}`, 5, 60 * 60_000);
      const body = await readJson(req);
      if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) throw new HttpError(400, 'امتیاز باید بین ۱ تا ۵ باشد.');
      const comment = textField(body.comment, 1500, 'متن نظر', 8);
      const result = db.prepare('INSERT INTO reviews (user_id, rating, comment, created_at) VALUES (?, ?, ?, ?)')
        .run(user.id, body.rating, comment, now().toISOString());
      const row = db.prepare('SELECT reviews.*, users.name FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.id = ?').get(Number(result.lastInsertRowid));
      return send(res, 201, { review: publicReview(row) });
    }
    return send(res, 404, { error: 'مسیر مورد نظر پیدا نشد.' });
  }

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary',
  };

  function serveStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'این روش درخواست مجاز نیست.' }, { Allow: 'GET, HEAD' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { throw new HttpError(400, 'مسیر معتبر نیست.'); }
    if (/[\x00-\x1f\x7f]/.test(pathname)) throw new HttpError(400, 'مسیر معتبر نیست.');
    const resolvedDist = resolve(distDir);
    let filename = resolve(resolvedDist, '.' + pathname);
    if (!filename.startsWith(resolvedDist + sep) && filename !== resolvedDist) throw new HttpError(403, 'دسترسی مجاز نیست.');
    if (relative(resolvedDist, filename).split(sep).some(part => part.startsWith('.'))) throw new HttpError(404, 'فایل پیدا نشد.');
    if (!existsSync(filename) || !statSync(filename).isFile()) {
      // SPA routes receive the document; missing assets should be genuine 404s.
      if (extname(pathname)) return send(res, 404, { error: 'فایل پیدا نشد.' });
      filename = resolve(resolvedDist, 'index.html');
    }
    if (!existsSync(filename)) return send(res, 503, { error: 'ابتدا npm run build را اجرا کنید یا سرور توسعه را راه‌اندازی کنید.' });
    // A symlink inside dist must never expose database, source or server files.
    const realDist = realpathSync(resolvedDist);
    const realFilename = realpathSync(filename);
    if (!realFilename.startsWith(realDist + sep)) throw new HttpError(404, 'فایل پیدا نشد.');
    const stats = statSync(filename);
    res.writeHead(200, {
      'Content-Type': mimeTypes[extname(filename).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': filename.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filename).on('error', () => res.destroy()).pipe(res);
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await api(req, res, url);
      else serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (!(error instanceof HttpError)) console.error('Application error:', error.name, error.code || '');
      send(res, error.status || 500, { error: error instanceof HttpError ? error.message : 'خطایی رخ داد؛ دوباره تلاش کنید.' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('close', () => db.close());
  return { server, db };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  const port = Number(process.env.PORT || 3001);
  server.listen(port, '0.0.0.0', () => console.log(`Doctor website server listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
