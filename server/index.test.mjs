import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './index.mjs';

const fixedNow = new Date('2026-11-05T08:00:00Z');

async function fixture(t, options = {}) {
  const app = createApp({ dbPath: ':memory:', now: () => fixedNow, adminEmail: undefined, adminPassword: undefined, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.server.listening
    ? new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()))
    : undefined);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, { body, cookie, method = body ? 'POST' : 'GET', headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await response.json();
    return { response, body: json, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function register(email = 'user@example.com') {
    const result = await request('/api/auth/register', { body: { name: 'کاربر آزمایشی', email, password: 'correct-horse-42' } });
    assert.equal(result.response.status, 201);
    assert.ok(result.cookie);
    return result;
  }
  return { ...app, base, request, register };
}

test('account lifecycle stores hashed credentials, uses private sessions and invalidates logout', async t => {
  const { request, register, db } = await fixture(t);
  assert.deepEqual((await request('/api/session')).body, { user: null });
  const account = await register();
  assert.equal(account.body.user.name, 'کاربر آزمایشی');
  assert.deepEqual(Object.keys(account.body.user).sort(), ['email', 'id', 'name', 'role']);
  assert.match(account.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(account.response.headers.get('set-cookie'), /SameSite=Lax/);
  const stored = db.prepare('SELECT password_hash, password_salt FROM users').get();
  assert.equal(stored.password_hash.length, 128);
  assert.notEqual(stored.password_hash, 'correct-horse-42');
  assert.equal(db.prepare('SELECT token_hash FROM sessions').get().token_hash.length, 64);
  assert.notEqual(db.prepare('SELECT token_hash FROM sessions').get().token_hash, account.cookie.split('=')[1]);
  assert.equal((await request('/api/session', { cookie: account.cookie })).body.user.id, account.body.user.id);
  assert.equal((await request('/api/auth/login', { body: { email: 'user@example.com', password: 'incorrect-pass' } })).response.status, 401);
  const login = await request('/api/auth/login', { body: { email: 'USER@example.com', password: 'correct-horse-42' } });
  assert.equal(login.response.status, 200);
  assert.notEqual(login.cookie, account.cookie);
  const logout = await request('/api/auth/logout', { method: 'POST', cookie: login.cookie });
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual((await request('/api/session', { cookie: login.cookie })).body, { user: null });
});

test('registration and JSON validation reject malformed data without leaking internals', async t => {
  const { request, register, base } = await fixture(t);
  await register();
  assert.equal((await request('/api/auth/register', { body: { name: 'بازدیدکننده', email: 'USER@example.com', password: 'another-good-pass' } })).response.status, 409);
  assert.equal((await request('/api/auth/register', { body: { name: 'آزمایش', email: 'bad-mail', password: 'strong-pass-9' } })).response.status, 400);
  assert.equal((await request('/api/auth/register', { body: { name: 'آزمایش', email: 'two@example.com', password: 'short' } })).response.status, 400);
  const invalid = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid}' });
  assert.equal(invalid.status, 400);
  const invalidType = await fetch(base + '/api/auth/register', { method: 'POST', body: 'plain text' });
  assert.equal(invalidType.status, 415);
  const fakeJsonType = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/jsonp' }, body: '{}',
  });
  assert.equal(fakeJsonType.status, 415);
  const oversized = await request('/api/auth/register', { body: { name: 'x'.repeat(20_000) } });
  assert.equal(oversized.response.status, 413);
  assert.equal((await request('/api/appointments')).response.status, 401);
  assert.deepEqual((await request('/api/session', { cookie: 'vazirian_session=forged-token' })).body, { user: null });
});

test('booking is atomic, scoped to its owner, reflected in availability and cancellable', async t => {
  const { request, register } = await fixture(t);
  const alice = await register('alice@example.com');
  const bob = await register('bob@example.com');
  const date = '2026-11-07';
  const booking = { date, time: '16:00', type: 'consultation', phone: '۰۹۱۲۳۴۵۶۷۸۹' };
  const initial = await request(`/api/availability?date=${date}`);
  assert.equal(initial.body.slots.length, 8);
  assert.ok(initial.body.slots.every(slot => slot.available));
  const attempts = await Promise.all([
    request('/api/appointments', { body: booking, cookie: alice.cookie }),
    request('/api/appointments', { body: booking, cookie: bob.cookie }),
  ]);
  assert.deepEqual(attempts.map(a => a.response.status).sort(), [201, 409]);
  const successIndex = attempts.findIndex(result => result.response.status === 201);
  const winner = [alice, bob][successIndex];
  const other = [alice, bob][1 - successIndex];
  const booked = attempts[successIndex].body.appointment;
  assert.equal(booked.phone, '09123456789');
  assert.equal(booked.status, 'pending');
  assert.equal((await request(`/api/availability?date=${date}`)).body.slots[0].available, false);
  assert.deepEqual((await request('/api/appointments', { cookie: other.cookie })).body.appointments, []);
  assert.equal((await request('/api/appointments', { cookie: winner.cookie })).body.appointments[0].id, booked.id);
  assert.equal((await request(`/api/appointments/${booked.id}`, { method: 'DELETE', cookie: other.cookie })).response.status, 404);
  assert.equal((await request(`/api/appointments/${booked.id}`, { method: 'DELETE', cookie: winner.cookie })).response.status, 200);
  assert.equal((await request(`/api/availability?date=${date}`)).body.slots[0].available, true);
});

test('calendar enforces Tehran time, Friday closure, valid dates, allowed types and phone numbers', async t => {
  const { request, register } = await fixture(t, { now: () => new Date('2026-11-05T13:15:00Z') });
  const { cookie } = await register();
  const booking = { date: '2026-11-07', time: '16:00', type: 'followup', phone: '09123456789' };
  const today = await request('/api/availability?date=2026-11-05');
  assert.equal(today.body.slots[0].available, false); // 16:45 Tehran.
  assert.equal(today.body.slots[2].available, true);
  const friday = await request('/api/availability?date=2026-11-06');
  assert.equal(friday.body.closed, true);
  assert.deepEqual(friday.body.slots, []);
  for (const patch of [
    { date: '2026-11-06' }, { date: '2026-11-04' }, { date: '2027-06-15' }, { date: '2026-02-30' },
    { time: '03:00' }, { type: 'surgery-without-consultation' }, { phone: '123456' }, { date: '2026-11-05', time: '16:00' },
  ]) {
    assert.equal((await request('/api/appointments', { body: { ...booking, ...patch }, cookie })).response.status, 400, JSON.stringify(patch));
  }
  for (const query of ['', '?date=', '?date=not-a-date', '?date=2026-02-30', '?date=2026-11-04', '?date=2027-06-15']) {
    assert.equal((await request('/api/availability' + query)).response.status, 400, query);
  }
  assert.equal((await request('/api/appointments', { body: { ...booking, phone: '+98 912 345 6789' }, cookie })).response.status, 201);
  for (const id of ['0', '999999999999999999999999999999999999', 'not-an-id']) {
    assert.equal((await request(`/api/appointments/${id}`, { method: 'DELETE', cookie })).response.status, 404);
  }
});

test('five-appointment limit excludes elapsed appointments and a cancellation releases capacity', async t => {
  const { request, register, db } = await fixture(t, { now: () => new Date('2026-11-05T14:45:00Z') });
  const account = await register();
  const seed = db.prepare('INSERT INTO appointments (user_id,date,time,type,phone,created_at) VALUES (?,?,?,?,?,?)');
  for (const time of ['16:00', '16:30', '17:00', '17:30', '18:00']) {
    seed.run(account.body.user.id, '2026-11-05', time, 'consultation', '09123456789', fixedNow.toISOString());
  }
  const appointments = [];
  for (const time of ['16:00', '16:30', '17:00', '17:30', '18:00']) {
    const result = await request('/api/appointments', {
      cookie: account.cookie, body: { date: '2026-11-07', time, type: 'consultation', phone: '09123456789' },
    });
    assert.equal(result.response.status, 201);
    appointments.push(result.body.appointment);
  }
  const sixth = { date: '2026-11-07', time: '18:30', type: 'consultation', phone: '09123456789' };
  assert.equal((await request('/api/appointments', { cookie: account.cookie, body: sixth })).response.status, 400);
  assert.equal((await request(`/api/appointments/${appointments[0].id}`, { method: 'DELETE', cookie: account.cookie })).response.status, 200);
  assert.equal((await request('/api/appointments', { cookie: account.cookie, body: sixth })).response.status, 201);
});

test('reviews require authentication, validate ratings and expose only public profile information', async t => {
  const { request, register } = await fixture(t);
  assert.deepEqual((await request('/api/reviews')).body, { reviews: [] });
  const review = { rating: 5, comment: 'ثبت تجربه و نظر آزمایشی درباره سامانه' };
  assert.equal((await request('/api/reviews', { body: review })).response.status, 401);
  const { cookie } = await register();
  assert.equal((await request('/api/reviews', { body: { ...review, rating: 6 }, cookie })).response.status, 400);
  assert.equal((await request('/api/reviews', { body: { ...review, rating: 3.5 }, cookie })).response.status, 400);
  assert.equal((await request('/api/reviews', { body: { ...review, comment: 'کم' }, cookie })).response.status, 400);
  const result = await request('/api/reviews', { body: review, cookie });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.review.name, 'کاربر آزمایشی');
  assert.deepEqual(Object.keys(result.body.review).sort(), ['comment', 'createdAt', 'id', 'name', 'rating']);
  const list = await request('/api/reviews');
  assert.equal(list.body.reviews.length, 1);
  assert.equal(list.body.reviews[0].comment, review.comment);
});

test('cross-origin mutations are denied and same-origin mutations succeed', async t => {
  const { request, base } = await fixture(t);
  const account = { name: 'کاربر نمونه', email: 'origin@example.com', password: 'correct-pass-123' };
  assert.equal((await request('/api/auth/register', { body: account, headers: { Origin: 'https://untrusted.example' } })).response.status, 403);
  assert.equal((await request('/api/auth/register', { body: account, headers: { Origin: base, 'Sec-Fetch-Site': 'cross-site' } })).response.status, 403);
  assert.equal((await request('/api/auth/register', { body: account, headers: { Origin: base } })).response.status, 201);
});

test('HTTPS reverse proxy gets Secure cookies and explicit public origin supports preserved session auth', async t => {
  const { request } = await fixture(t, { appOrigin: 'https://doctor.example' });
  const headers = { Origin: 'https://doctor.example', 'X-Forwarded-Proto': 'https' };
  const result = await request('/api/auth/register', {
    headers, body: { name: 'کاربر نمونه', email: 'secure@example.com', password: 'correct-pass-123' },
  });
  assert.equal(result.response.status, 201);
  assert.match(result.response.headers.get('set-cookie'), /; Secure(?:;|$)/);
  assert.equal((await request('/api/session', { cookie: result.cookie })).body.user.email, 'secure@example.com');
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers, cookie: result.cookie })).response.status, 200);
  assert.deepEqual((await request('/api/session', { cookie: result.cookie })).body, { user: null });
});

test('sessions expire, registration is rate limited and API routes stay JSON', async t => {
  let time = fixedNow;
  const { request, register } = await fixture(t, { now: () => time });
  const account = await register();
  time = new Date(fixedNow.getTime() + 8 * 24 * 60 * 60_000);
  assert.deepEqual((await request('/api/session', { cookie: account.cookie })).body, { user: null });
  for (let index = 0; index < 15; index++) await request('/api/auth/register', { body: { email: 'invalid' } });
  assert.equal((await request('/api/auth/register', { body: { email: 'invalid' } })).response.status, 429);
  assert.equal((await request('/api/nonexistent')).response.status, 404);
  assert.deepEqual((await request('/api/health')).body, { status: 'ok', scheduleMode: 'demo' });
});

test('database persists accounts and bookings across server restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-site-db-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'test.sqlite');
  const first = await fixture(t, { dbPath });
  const account = await first.register('persistent@example.com');
  const booked = await first.request('/api/appointments', {
    cookie: account.cookie,
    body: { date: '2026-11-07', time: '17:00', type: 'online', phone: '09123456789' },
  });
  assert.equal(booked.response.status, 201);
  await new Promise(resolve => first.server.close(resolve));
  const second = await fixture(t, { dbPath });
  const login = await second.request('/api/auth/login', { body: { email: 'persistent@example.com', password: 'correct-horse-42' } });
  assert.equal(login.response.status, 200);
  const appointments = await second.request('/api/appointments', { cookie: login.cookie });
  assert.equal(appointments.body.appointments.length, 1);
  assert.equal(appointments.body.appointments[0].time, '17:00');
});

test('production static server supports SPA routes and rejects missing assets', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-site-dist-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Doctor</title>');
  writeFileSync(join(dir, 'app.js'), 'console.log("ready")');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { base } = await fixture(t, { distDir: dir });
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Doctor/);
  assert.equal((await fetch(base + '/account')).status, 200);
  assert.equal((await fetch(base + '/missing.js')).status, 404);
  assert.match((await fetch(base + '/app.js')).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/.env')).status, 404);
});

test('production static server cannot escape the build directory through symlinks', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-site-static-security-'));
  const dist = join(dir, 'dist');
  mkdirSync(dist);
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Doctor</title>');
  writeFileSync(join(dir, 'private.txt'), 'must not be served');
  symlinkSync(join(dir, 'private.txt'), join(dist, 'escape.txt'));
  symlinkSync(dir, join(dist, 'escape-dir'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { base } = await fixture(t, { distDir: dist });
  assert.equal((await fetch(base + '/escape.txt')).status, 404);
  assert.equal((await fetch(base + '/escape-dir/private.txt')).status, 404);
  assert.equal((await fetch(base + '/%00')).status, 400);
});

const ownerCredentials = { adminEmail: 'owner@example.com', adminPassword: 'owner-bootstrap-secret-42' };
async function adminFixture(t, options = {}) {
  const app = await fixture(t, { ...ownerCredentials, ...options });
  const login = await app.request('/api/auth/login', {
    body: { email: options.adminEmail || ownerCredentials.adminEmail, password: options.adminPassword || ownerCredentials.adminPassword },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.role, 'admin');
  return { ...app, adminCookie: login.cookie, owner: login.body.user };
}

test('administration requires paired server credentials and ignores client-supplied roles', async t => {
  for (const config of [{}, { adminEmail: ownerCredentials.adminEmail }, { adminPassword: ownerCredentials.adminPassword }]) {
    const app = await fixture(t, config);
    const forged = await app.request('/api/auth/register', {
      body: { name: 'مدیر ادعایی', email: ownerCredentials.adminEmail, password: 'ordinary-register-pass', role: 'admin', blocked: false },
    });
    assert.equal(forged.response.status, 201);
    assert.equal(forged.body.user.role, 'user');
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n, 0);
    assert.equal((await app.request('/api/admin/overview', { cookie: forged.cookie })).response.status, 403);
  }
  assert.throws(() => createApp({ dbPath: ':memory:', adminEmail: 'invalid', adminPassword: ownerCredentials.adminPassword }), /ADMIN_EMAIL/);
  assert.throws(() => createApp({ dbPath: ':memory:', adminEmail: ownerCredentials.adminEmail, adminPassword: 'short' }), /ADMIN_PASSWORD/);
});

test('every administration endpoint enforces role authorization before reading or changing data', async t => {
  const { request, register } = await adminFixture(t);
  const regular = await register();
  const routes = [
    ['/api/admin/overview'], ['/api/admin/users'], ['/api/admin/appointments'], ['/api/admin/reviews'], ['/api/admin/audit'],
    ['/api/admin/users/1', 'PATCH', { blocked: true }],
    ['/api/admin/appointments/1', 'PATCH', { status: 'confirmed' }],
    ['/api/admin/appointments/1', 'DELETE'], ['/api/admin/reviews/1', 'PATCH', { hidden: true }],
  ];
  for (const [path, method = 'GET', body] of routes) {
    assert.equal((await request(path, { method, body })).response.status, 401, path);
    assert.equal((await request(path, { method, body, cookie: regular.cookie })).response.status, 403, path);
  }
});

test('owner bootstrap protects stored credentials and preserves sessions only for unchanged configuration', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vet-owner-bootstrap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'site.sqlite');
  const first = await fixture(t, { dbPath });
  const ordinary = await first.register(ownerCredentials.adminEmail);
  assert.equal(ordinary.body.user.role, 'user');
  const ownerId = ordinary.body.user.id;
  await new Promise(resolve => first.server.close(resolve));
  const provisioned = await adminFixture(t, { dbPath });
  assert.equal(provisioned.owner.id, ownerId);
  assert.equal((await provisioned.request('/api/session', { cookie: ordinary.cookie })).body.user, null);
  const stored = provisioned.db.prepare('SELECT * FROM users WHERE id=?').get(ownerId);
  assert.equal(stored.role, 'admin');
  assert.equal(stored.password_hash.length, 128);
  assert.notEqual(stored.password_hash, ownerCredentials.adminPassword);
  assert.equal((await provisioned.request('/api/auth/login', {
    body: { email: ownerCredentials.adminEmail, password: 'correct-horse-42' },
  })).response.status, 401);
  const cookie = provisioned.adminCookie;
  await new Promise(resolve => provisioned.server.close(resolve));
  const unchanged = await fixture(t, { dbPath, ...ownerCredentials });
  assert.equal((await unchanged.request('/api/admin/overview', { cookie })).response.status, 200);
  await new Promise(resolve => unchanged.server.close(resolve));
  const rotated = await adminFixture(t, { dbPath, adminPassword: 'rotated-owner-password-99' });
  assert.equal((await rotated.request('/api/session', { cookie })).body.user, null);
  assert.equal((await rotated.request('/api/auth/login', {
    body: { email: ownerCredentials.adminEmail, password: ownerCredentials.adminPassword },
  })).response.status, 401);
});

test('changing the configured owner demotes previous administrators and revokes old and promoted sessions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vet-owner-rotation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'site.sqlite');
  const old = await adminFixture(t, { dbPath });
  const replacement = await old.register('replacement@example.com');
  const oldCookie = old.adminCookie;
  const beforeTransfer = {
    roles: old.db.prepare('SELECT id,role FROM users ORDER BY id').all().map(row => ({ ...row })),
    sessions: old.db.prepare('SELECT token_hash,user_id FROM sessions ORDER BY token_hash').all().map(row => ({ ...row })),
    audit: old.db.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n,
  };
  await new Promise(resolve => old.server.close(resolve));
  assert.throws(() => createApp({ dbPath, now: () => fixedNow,
    adminEmail: 'replacement@example.com', adminPassword: ownerCredentials.adminPassword,
  }), { message: 'Changing ADMIN_EMAIL requires a new ADMIN_PASSWORD.' });
  const unchanged = await fixture(t, { dbPath });
  assert.deepEqual(unchanged.db.prepare('SELECT id,role FROM users ORDER BY id').all().map(row => ({ ...row })), beforeTransfer.roles);
  assert.deepEqual(unchanged.db.prepare('SELECT token_hash,user_id FROM sessions ORDER BY token_hash').all().map(row => ({ ...row })), beforeTransfer.sessions);
  assert.equal(unchanged.db.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n, beforeTransfer.audit);
  assert.equal((await unchanged.request('/api/admin/overview', { cookie: oldCookie })).response.status, 200);
  assert.equal((await unchanged.request('/api/session', { cookie: replacement.cookie })).body.user.role, 'user');
  await new Promise(resolve => unchanged.server.close(resolve));
  const next = await adminFixture(t, { dbPath, adminEmail: 'replacement@example.com', adminPassword: 'replacement-owner-secret-77' });
  assert.equal(next.owner.id, replacement.body.user.id);
  assert.equal(next.db.prepare('SELECT role FROM users WHERE id=?').get(old.owner.id).role, 'user');
  assert.equal((await next.request('/api/session', { cookie: oldCookie })).body.user, null);
  assert.equal((await next.request('/api/session', { cookie: replacement.cookie })).body.user, null);
  const formerLogin = await next.request('/api/auth/login', {
    body: { email: ownerCredentials.adminEmail, password: ownerCredentials.adminPassword },
  });
  assert.equal(formerLogin.body.user.role, 'user');
  assert.equal((await next.request('/api/admin/users', { cookie: formerLogin.cookie })).response.status, 403);
  assert.equal(next.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n, 1);
});

test('administrator can search and paginate accounts, block access and invalidate sessions', async t => {
  const { request, register, db, adminCookie, owner } = await adminFixture(t);
  const person = await register('managed@example.com');
  const stored = db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(person.body.user.id);
  const seed = db.prepare('INSERT INTO users (name,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?)');
  for (let i = 0; i < 22; i++) seed.run(`کاربر ${i}`, `page${i}@example.com`, stored.password_hash, stored.password_salt, fixedNow.toISOString());
  const page1 = await request('/api/admin/users', { cookie: adminCookie });
  assert.equal(page1.body.total, 24);
  assert.equal(page1.body.pageSize, 20);
  assert.equal(page1.body.users.length, 20);
  const page2 = await request('/api/admin/users?page=2', { cookie: adminCookie });
  assert.equal(page2.body.users.length, 4);
  const search = await request('/api/admin/users?q=MANAGED', { cookie: adminCookie });
  assert.equal(search.body.total, 1);
  assert.deepEqual(Object.keys(search.body.users[0]).sort(), ['appointmentCount','blocked','createdAt','email','id','name','reviewCount','role']);
  for (const query of ['?page=0','?page=-1','?page=1.2','?page=1000001','?q=' + 'x'.repeat(201)]) {
    assert.equal((await request('/api/admin/users' + query, { cookie: adminCookie })).response.status, 400, query);
  }
  assert.equal((await request(`/api/admin/users/${owner.id}`, { method: 'PATCH', body: { blocked: true }, cookie: adminCookie })).response.status, 400);
  assert.equal((await request(`/api/admin/users/${person.body.user.id}`, { method: 'PATCH', body: { blocked: 'yes' }, cookie: adminCookie })).response.status, 400);
  const block = await request(`/api/admin/users/${person.body.user.id}`, { method: 'PATCH', body: { blocked: true }, cookie: adminCookie });
  assert.equal(block.response.status, 200);
  assert.equal((await request('/api/session', { cookie: person.cookie })).body.user, null);
  assert.equal((await request('/api/appointments', { cookie: person.cookie })).response.status, 401);
  assert.equal((await request('/api/auth/login', { body: { email: 'managed@example.com', password: 'correct-horse-42' } })).response.status, 403);
  assert.equal((await request('/api/auth/login', { body: { email: 'managed@example.com', password: 'wrong-password-99' } })).response.status, 401);
  assert.equal((await request(`/api/admin/users/${person.body.user.id}`, { method: 'PATCH', body: { blocked: false }, cookie: adminCookie })).response.status, 200);
  assert.equal((await request('/api/session', { cookie: person.cookie })).body.user, null);
  assert.equal((await request('/api/auth/login', { body: { email: 'managed@example.com', password: 'correct-horse-42' } })).response.status, 200);
});

test('administrator confirms and cancels bookings while preserving ownership and availability rules', async t => {
  const { request, register, adminCookie } = await adminFixture(t);
  const person = await register();
  const booking = await request('/api/appointments', { cookie: person.cookie,
    body: { date: '2026-11-07', time: '16:00', type: 'consultation', phone: '09123456789' } });
  const id = booking.body.appointment.id;
  const pending = await request('/api/admin/appointments?status=pending', { cookie: adminCookie });
  assert.equal(pending.body.total, 1);
  assert.equal(pending.body.appointments[0].userEmail, 'user@example.com');
  assert.equal(pending.body.appointments[0].phone, '09123456789');
  const confirm = await request(`/api/admin/appointments/${id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'confirmed' } });
  assert.equal(confirm.body.appointment.status, 'confirmed');
  assert.equal((await request('/api/appointments', { cookie: person.cookie })).body.appointments[0].status, 'confirmed');
  assert.equal((await request('/api/admin/appointments?status=confirmed', { cookie: adminCookie })).body.total, 1);
  assert.equal((await request('/api/admin/appointments?status=pending', { cookie: adminCookie })).body.total, 0);
  assert.equal((await request('/api/availability?date=2026-11-07')).body.slots[0].available, false);
  for (const url of ['/api/admin/appointments?status=cancelled', '/api/admin/appointments?page=no']) {
    assert.equal((await request(url, { cookie: adminCookie })).response.status, 400);
  }
  assert.equal((await request(`/api/admin/appointments/${id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'cancelled' } })).response.status, 400);
  assert.equal((await request(`/api/admin/appointments/${id}`, { method: 'DELETE', cookie: adminCookie })).response.status, 200);
  assert.equal((await request('/api/availability?date=2026-11-07')).body.slots[0].available, true);
  assert.equal((await request('/api/appointments', { cookie: person.cookie })).body.appointments.length, 0);
  for (const target of ['0','not-an-id','999999999999999999999999']) {
    assert.equal((await request(`/api/admin/appointments/${target}`, { method: 'DELETE', cookie: adminCookie })).response.status, 404);
  }
});

test('review moderation is reversible, private and audited along with protected owner actions', async t => {
  const { request, register, adminCookie } = await adminFixture(t);
  const person = await register();
  const review = await request('/api/reviews', { cookie: person.cookie, body: { rating: 4, comment: 'تجربه آزمایشی کاربر برای بررسی مدیریت نظرها' } });
  const id = review.body.review.id;
  const adminReviews = await request('/api/admin/reviews', { cookie: adminCookie });
  assert.equal(adminReviews.body.reviews[0].userId, person.body.user.id);
  assert.equal(adminReviews.body.reviews[0].hidden, false);
  assert.equal((await request(`/api/admin/reviews/${id}`, { method: 'PATCH', cookie: adminCookie, body: { hidden: true } })).response.status, 200);
  assert.equal((await request('/api/reviews')).body.reviews.length, 0);
  assert.equal((await request('/api/admin/reviews', { cookie: adminCookie })).body.reviews[0].hidden, true);
  assert.equal((await request(`/api/admin/reviews/${id}`, { method: 'PATCH', cookie: adminCookie, body: { hidden: false } })).response.status, 200);
  assert.equal((await request('/api/reviews')).body.reviews.length, 1);
  const crossOrigin = await request(`/api/admin/reviews/${id}`, {
    method: 'PATCH', cookie: adminCookie, body: { hidden: true }, headers: { Origin: 'https://attacker.invalid' },
  });
  assert.equal(crossOrigin.response.status, 403);
  assert.equal((await request('/api/reviews')).body.reviews.length, 1);
  const audit = await request('/api/admin/audit', { cookie: adminCookie });
  assert.deepEqual(audit.body.entries.map(e => e.action), ['review.published','review.hidden','admin.provisioned']);
  assert.deepEqual(Object.keys(audit.body.entries[0]).sort(), ['action','actorName','createdAt','id','targetId','targetType']);
  for (const path of ['/api/admin/overview','/api/admin/users','/api/admin/appointments','/api/admin/reviews','/api/admin/audit']) {
    const body = (await request(path, { cookie: adminCookie })).body;
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /password|salt|token_hash|password_hash/);
    assert.ok(!serialized.includes(ownerCredentials.adminPassword));
  }
  const overview = await request('/api/admin/overview', { cookie: adminCookie });
  assert.deepEqual(overview.body.stats, { users: 2, appointments: 0, reviews: 1, pending: 0, confirmed: 0 });
});

test('additive database migration preserves legacy accounts, bookings and reviews', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const { scryptSync } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'vet-legacy-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE appointments (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),date TEXT NOT NULL,time TEXT NOT NULL,type TEXT NOT NULL,phone TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(date,time));
    CREATE TABLE reviews (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),rating INTEGER NOT NULL,comment TEXT NOT NULL,created_at TEXT NOT NULL);`);
  legacy.prepare('INSERT INTO users VALUES (1,?,?,?,?,?)').run('کاربر قدیمی','legacy@example.com',scryptSync('legacy-password-77','legacy-salt',64).toString('hex'),'legacy-salt',fixedNow.toISOString());
  legacy.prepare('INSERT INTO appointments VALUES (1,1,?,?,?,?,?)').run('2026-11-07','17:30','followup','09123456789',fixedNow.toISOString());
  legacy.prepare('INSERT INTO reviews VALUES (1,1,?,?,?)').run(5,'نظر قدیمی که باید حفظ شود',fixedNow.toISOString());
  legacy.close();
  const { request, db } = await fixture(t, { dbPath });
  const login = await request('/api/auth/login', { body: { email:'legacy@example.com', password:'legacy-password-77' } });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.role, 'user');
  const appointments = await request('/api/appointments', { cookie:login.cookie });
  assert.equal(appointments.body.appointments[0].status, 'pending');
  assert.equal(appointments.body.appointments[0].time, '17:30');
  assert.equal((await request('/api/reviews')).body.reviews[0].comment, 'نظر قدیمی که باید حفظ شود');
  assert.equal(db.prepare('SELECT blocked FROM users WHERE id=1').get().blocked,0);
});
