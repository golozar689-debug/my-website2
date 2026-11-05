import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpLeft, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, CircleAlert, Clock3, Eye, EyeOff, History, LoaderCircle, LogOut, MessageCircle, PawPrint, RefreshCw, Search, ShieldCheck, ShieldOff, Star, Trash2, UserRound, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { AuthDialog, ModalShell } from './AccountDialogs.jsx';
import '../admin.css';

const number = value => new Intl.NumberFormat('fa-IR').format(value ?? 0);
const time = value => String(value ?? '').replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[digit]);
function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+03:30` : value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}
const visitNames = { consultation: 'ویزیت دامپزشکی', followup: 'پیگیری درمان', online: 'مشاوره دامپزشکی' };
const tabs = [
  { id: 'users', title: 'کاربران', icon: Users, subtitle: 'حساب‌ها و دسترسی‌ها' },
  { id: 'appointments', title: 'نوبت‌ها', icon: CalendarDays, subtitle: 'بررسی و هماهنگی مراجعه' },
  { id: 'reviews', title: 'نظرها', icon: MessageCircle, subtitle: 'مدیریت تجربه‌های ثبت‌شده' },
  { id: 'audit', title: 'رویدادها', icon: History, subtitle: 'تاریخچه فعالیت مدیریت' },
];
const actionNames = {
  'user.blocked': 'مسدود کردن حساب', 'user.unblocked': 'فعال کردن حساب',
  'appointment.confirmed': 'تأیید نوبت', 'appointment.pending': 'بازگرداندن نوبت به انتظار',
  'appointment.cancelled': 'لغو نوبت', 'review.hidden': 'پنهان کردن نظر',
  'review.published': 'نمایش دوباره نظر', 'admin.provisioned': 'راه‌اندازی حساب مدیر',
  'admin.demoted': 'برداشتن دسترسی مدیریت',
};
const targetNames = { user: 'کاربر', appointment: 'نوبت', review: 'نظر', admin: 'مدیر' };

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionVersion, setSessionVersion] = useState(0);
  const [authMode, setAuthMode] = useState(null);
  const [tab, setTab] = useState('users');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [stats, setStats] = useState(null);
  const [result, setResult] = useState({ total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setSessionLoading(true); setSessionError('');
    api('/session').then(data => { if (active) setUser(data.user); })
      .catch(failure => { if (active) setSessionError(failure.message); })
      .finally(() => { if (active) setSessionLoading(false); });
    return () => { active = false; };
  }, [sessionVersion]);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (user?.role !== 'admin') return undefined;
    let active = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page) });
    if (tab === 'users' && query) params.set('q', query);
    if (tab === 'appointments') params.set('status', status);
    Promise.all([api('/admin/overview'), api(`/admin/${tab}?${params}`)])
      .then(([overview, data]) => {
        if (active) {
          setStats(overview.stats); setResult(data);
          const maxPage = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 20)));
          if (page > maxPage) setPage(maxPage);
        }
      })
      .catch(failure => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, tab, page, query, status, version]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function logout(openLogin = false) {
    setBusy('logout'); setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      setUser(null); setStats(null); setResult({ total: 0, page: 1, pageSize: 20 });
      if (openLogin) setAuthMode('login');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  }

  async function mutate(path, options, message, key) {
    if (busy) return;
    setBusy(key); setError('');
    try {
      await api(path, options);
      setConfirmation(null); setNotice(message); setVersion(value => value + 1);
    } catch (failure) { setError(failure.message); setConfirmation(null); }
    finally { setBusy(null); }
  }

  function changeTab(next) { setTab(next); setPage(1); setError(''); }
  const selectedTab = tabs.find(item => item.id === tab);
  const totalPages = Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || 20)));
  const authDialog = authMode && <AuthDialog mode={authMode} allowRegistration={false} onClose={() => setAuthMode(null)} onModeChange={setAuthMode} onAuthenticated={value => { setUser(value); setAuthMode(null); setPage(1); setError(''); }} />;

  if (sessionLoading) return <div className="admin-gate-wrap" dir="rtl"><div className="admin-gate glass"><LoaderCircle className="spin" size={28} /><p role="status">در حال بررسی حساب کاربری…</p></div></div>;
  if (sessionError) return <div className="admin-gate-wrap" dir="rtl"><div className="admin-gate glass"><CircleAlert size={32} /><h1>ارتباط برقرار نشد</h1><p role="alert">{sessionError}</p><button className="primary-btn" onClick={() => setSessionVersion(value => value + 1)}><RefreshCw size={17} /> تلاش دوباره</button><a href="/" className="text-btn">بازگشت به سایت <ArrowLeft size={17} /></a></div></div>;
  if (!user || user.role !== 'admin') return <div className="admin-gate-wrap" dir="rtl"><div className="admin-gate glass"><span className="admin-gate-symbol"><ShieldCheck size={33} /></span><span className="eyebrow">مدیریت سایت</span><h1>{user ? 'این حساب دسترسی مدیریت ندارد.' : 'فضای مدیریت، برای صاحب سایت.'}</h1><p>{user ? 'با حساب مدیریتی تنظیم‌شده برای این سایت وارد شوید.' : 'برای مدیریت کاربران، نوبت‌ها و نظرها، با حساب مدیر وارد شوید.'}</p>{user && <span className="admin-gate-email" dir="ltr">{user.email}</span>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-btn" disabled={busy !== null} onClick={() => user ? logout(true) : setAuthMode('login')}>{busy ? <LoaderCircle size={18} className="spin" /> : <UserRound size={18} />}{user ? 'خروج و ورود با حساب مدیر' : 'ورود مدیر'}</button><a className="text-btn" href="/">بازگشت به سایت <ArrowLeft size={17} /></a><small>ساخت حساب عادی، دسترسی مدیریت ایجاد نمی‌کند.</small></div>{authDialog}</div>;

  return <div className="admin-app" dir="rtl">
    <a href="#admin-content" className="skip-link">رفتن به محتوای مدیریت</a>
    <div className="admin-shell">
      <aside className="admin-sidebar glass">
        <a href="/" className="admin-brand"><span className="brand-symbol"><PawPrint size={25} /></span><span><strong>دکتر بهنام وزیریان</strong><small>پنل مدیریت سایت</small></span></a>
        <div className="admin-sidebar-label">فضای مدیریت</div>
        <nav className="admin-nav" aria-label="بخش‌های مدیریت">{tabs.map(({id,title,icon:Icon}) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => changeTab(id)}><Icon size={19} strokeWidth={1.6} /><span>{title}</span>{tab === id && <span className="admin-nav-dot" />}</button>)}</nav>
        <div className="admin-sidebar-bottom"><div className="admin-owner"><span className="admin-owner-icon"><ShieldCheck size={21} /></span><div><strong>{user.name}</strong><small>مدیر سایت</small></div></div><span className="admin-owner-email" dir="ltr">{user.email}</span><button className="admin-logout" onClick={() => logout()} disabled={busy !== null}>{busy === 'logout' ? <LoaderCircle size={16} className="spin" /> : <LogOut size={16} />}خروج از حساب</button></div>
      </aside>

      <main id="admin-content" className="admin-main">
        <header className="admin-header"><div><span className="eyebrow"><span className="live-dot" /> مدیریت اطلاعات سایت</span><h1>{selectedTab.title}</h1><p>{selectedTab.subtitle}</p></div><a href="/" className="secondary-btn">مشاهده سایت <ArrowUpLeft size={17} /></a></header>
        <section className="admin-stats" aria-label="آمار سایت">{[
          { key: 'users', label: 'حساب کاربری', icon: Users },
          { key: 'appointments', label: 'نوبت ثبت‌شده', icon: CalendarDays },
          { key: 'pending', label: 'در انتظار تأیید', icon: Clock3 },
          { key: 'confirmed', label: 'نوبت تأییدشده', icon: CheckCheck },
          { key: 'reviews', label: 'تجربه ثبت‌شده', icon: MessageCircle },
        ].map(({key,label,icon:Icon}) => <article key={key} className="admin-stat glass"><span className="admin-stat-icon"><Icon size={19} strokeWidth={1.5} /></span><strong>{stats ? number(stats[key]) : '—'}</strong><span>{label}</span></article>)}</section>

        <section className="admin-panel glass" aria-label={selectedTab.subtitle}>
          <div className="admin-panel-toolbar"><div><h2>{tab === 'users' ? 'کاربران سایت' : tab === 'appointments' ? 'درخواست‌های مراجعه' : tab === 'reviews' ? 'تجربه‌های ثبت‌شده' : 'تاریخچه مدیریت'}</h2><p>{tab === 'users' ? 'رمز عبور کاربران قابل مشاهده نیست.' : tab === 'appointments' ? 'تأیید یا لغو هر درخواست، در همین بخش انجام می‌شود.' : tab === 'reviews' ? 'نظر پنهان‌شده در صفحه عمومی سایت نمایش داده نمی‌شود.' : 'تغییرات مدیریتی برای پیگیری در این بخش ثبت می‌شوند.'}</p></div><div className="admin-tools">{tab === 'users' && <label className="admin-search"><Search size={16} /><span className="admin-sr-only">جست‌وجوی نام یا ایمیل کاربر</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} placeholder="جست‌وجوی نام یا ایمیل…" /></label>}{tab === 'appointments' && <label className="admin-filter"><span className="admin-sr-only">وضعیت نوبت</span><select aria-label="وضعیت نوبت" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">همه نوبت‌ها</option><option value="pending">در انتظار تأیید</option><option value="confirmed">تأییدشده</option></select></label>}<button className="admin-refresh icon-btn" type="button" onClick={() => setVersion(value => value + 1)} aria-label="تازه‌سازی اطلاعات" disabled={loading}><RefreshCw size={17} className={loading ? 'spin' : ''} /></button></div></div>

          {error && <div className="admin-error" role="alert"><CircleAlert size={18} /><p>{error}</p><button type="button" onClick={() => setVersion(value => value + 1)}>تلاش دوباره</button></div>}
          {loading ? <div className="admin-loading" role="status"><LoaderCircle size={25} className="spin" /><span>در حال دریافت اطلاعات…</span></div> : error ? null : <>
            {tab !== 'reviews' && <p className="admin-table-hint"><ArrowLeft size={13} />برای دیدن همه ستون‌ها، جدول را به طرفین بکشید.</p>}
            {tab === 'users' && <UsersTable rows={result.users || []} busy={busy} onBlock={row => row.blocked ? mutate(`/admin/users/${row.id}`, { method: 'PATCH', body: JSON.stringify({ blocked: false }) }, 'حساب کاربر دوباره فعال شد.', `user-${row.id}`) : setConfirmation({ kind: 'block', row })} />}
            {tab === 'appointments' && <AppointmentsTable rows={result.appointments || []} busy={busy} onStatus={row => mutate(`/admin/appointments/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: row.status === 'confirmed' ? 'pending' : 'confirmed' }) }, row.status === 'confirmed' ? 'نوبت به حالت انتظار برگشت.' : 'نوبت تأیید شد.', `appointment-${row.id}`)} onCancel={row => setConfirmation({ kind: 'cancel', row })} />}
            {tab === 'reviews' && <ReviewsList rows={result.reviews || []} busy={busy} onToggle={row => mutate(`/admin/reviews/${row.id}`, { method: 'PATCH', body: JSON.stringify({ hidden: !row.hidden }) }, row.hidden ? 'نظر دوباره در سایت نمایش داده می‌شود.' : 'نظر از صفحه عمومی پنهان شد.', `review-${row.id}`)} />}
            {tab === 'audit' && <AuditTable rows={result.entries || []} />}
            <div className="admin-pagination"><span>{number(result.total)} {tab === 'users' ? 'کاربر' : tab === 'appointments' ? 'نوبت' : tab === 'reviews' ? 'نظر' : 'رویداد'}<i />صفحه {number(page)} از {number(totalPages)}</span><div><button className="icon-btn" type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1} aria-label="صفحه قبل"><ChevronRight size={18} /></button><button className="icon-btn" type="button" onClick={() => setPage(value => value + 1)} disabled={page >= totalPages} aria-label="صفحه بعد"><ChevronLeft size={18} /></button></div></div>
          </>}
        </section>
        <p className="admin-footer-note"><ShieldCheck size={14} /> این فضا فقط برای حساب مدیر قابل دسترسی است.</p>
      </main>
    </div>
    {notice && <div className="toast glass" role="status"><Check size={18} /><span>{notice}</span><button className="icon-btn" onClick={() => setNotice('')} aria-label="بستن پیام">×</button></div>}
    {authDialog}
    {confirmation && <ModalShell title={confirmation.kind === 'block' ? 'مسدود کردن حساب' : 'لغو درخواست نوبت'} onClose={() => { if (!busy) setConfirmation(null); }} className="admin-confirmation"><span className="admin-confirm-icon">{confirmation.kind === 'block' ? <ShieldOff size={27} /> : <CalendarDays size={27} />}</span><p>{confirmation.kind === 'block' ? `حساب «${confirmation.row.name}» مسدود شود؟ نشست‌های فعلی این کاربر بسته می‌شود و تا فعال‌سازی دوباره نمی‌تواند وارد شود.` : `درخواست ${confirmation.row.userName} در ${formatDate(confirmation.row.date)}، ساعت ${time(confirmation.row.time)} لغو شود؟ این ساعت دوباره قابل رزرو خواهد شد.`}</p><div className="admin-confirm-actions"><button className="primary-btn" disabled={busy !== null} onClick={() => confirmation.kind === 'block' ? mutate(`/admin/users/${confirmation.row.id}`, { method: 'PATCH', body: JSON.stringify({ blocked: true }) }, 'حساب کاربر مسدود شد.', `user-${confirmation.row.id}`) : mutate(`/admin/appointments/${confirmation.row.id}`, { method: 'DELETE' }, 'درخواست نوبت لغو شد و ساعت آن آزاد شد.', `appointment-${confirmation.row.id}`)}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{confirmation.kind === 'block' ? 'بله، مسدود شود' : 'بله، نوبت لغو شود'}</button><button className="secondary-btn" disabled={busy !== null} onClick={() => setConfirmation(null)}>انصراف</button></div></ModalShell>}
  </div>;
}

function EmptyState({ icon: Icon, title, description }) {
  return <div className="admin-empty"><span><Icon size={30} strokeWidth={1.4} /></span><h3>{title}</h3><p>{description}</p></div>;
}

function UsersTable({ rows, busy, onBlock }) {
  if (!rows.length) return <EmptyState icon={Users} title="کاربری پیدا نشد" description="با ثبت‌نام کاربران، اطلاعاتشان اینجا نمایش داده می‌شود. اگر جست‌وجو کرده‌اید، عبارت دیگری امتحان کنید." />;
  return <div className="admin-table-scroll" tabIndex={0} aria-label="جدول کاربران، قابل پیمایش افقی"><table className="admin-table admin-users-table"><caption className="admin-sr-only">فهرست حساب‌های کاربران سایت</caption><thead><tr><th scope="col">کاربر</th><th scope="col">تاریخ عضویت</th><th scope="col">نوبت / نظر</th><th scope="col">وضعیت</th><th scope="col">دسترسی حساب</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><div className="admin-user-cell"><span className="admin-initial">{row.name?.charAt(0) || 'ک'}</span><div><strong>{row.name}</strong><span dir="ltr">{row.email}</span></div></div></td><td className="admin-nowrap">{formatDate(row.createdAt)}</td><td><span className="admin-count-pair"><span><CalendarDays size={13} />{number(row.appointmentCount)}</span><span><MessageCircle size={13} />{number(row.reviewCount)}</span></span></td><td><span className={`admin-status ${row.role === 'admin' ? 'is-admin' : row.blocked ? 'is-blocked' : 'is-active'}`}>{row.role === 'admin' ? 'مدیر سایت' : row.blocked ? 'مسدود' : 'فعال'}</span></td><td>{row.role === 'admin' ? <span className="admin-protected"><ShieldCheck size={15} /> محافظت‌شده</span> : <button className={`admin-row-action ${row.blocked ? 'positive' : 'subtle-danger'}`} disabled={busy !== null} onClick={() => onBlock(row)} aria-label={`${row.blocked ? 'فعال کردن' : 'مسدود کردن'} حساب ${row.name}`}>{busy === `user-${row.id}` ? <LoaderCircle className="spin" size={14} /> : row.blocked ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}{row.blocked ? 'فعال کردن' : 'مسدود کردن'}</button>}</td></tr>)}</tbody></table></div>;
}

function AppointmentsTable({ rows, busy, onStatus, onCancel }) {
  if (!rows.length) return <EmptyState icon={CalendarDays} title="نوبتی در این فهرست نیست" description="درخواست‌های مراجعه پس از ثبت در سایت، برای بررسی و تأیید اینجا نمایش داده می‌شوند." />;
  return <div className="admin-table-scroll" tabIndex={0} aria-label="جدول نوبت‌ها، قابل پیمایش افقی"><table className="admin-table admin-appointments-table"><caption className="admin-sr-only">فهرست درخواست‌های مراجعه</caption><thead><tr><th scope="col">همراه حیوان</th><th scope="col">زمان مراجعه</th><th scope="col">نوع مراجعه</th><th scope="col">وضعیت</th><th scope="col">مدیریت نوبت</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><div className="admin-contact-cell"><strong>{row.userName}</strong><a href={`tel:${row.phone}`} dir="ltr">{time(row.phone)}</a><small dir="ltr">{row.userEmail}</small></div></td><td className="admin-nowrap"><div className="admin-appointment-time"><span>{formatDate(row.date)}</span><small><Clock3 size={13} /> ساعت {time(row.time)}</small></div></td><td>{visitNames[row.type] || 'درخواست مراجعه'}</td><td><span className={`admin-status ${row.status === 'confirmed' ? 'is-active' : 'is-pending'}`}>{row.status === 'confirmed' ? 'تأییدشده' : 'در انتظار تأیید'}</span></td><td><div className="admin-row-actions"><button className="admin-row-action positive" disabled={busy !== null} onClick={() => onStatus(row)} aria-label={`${row.status === 'confirmed' ? 'بازگشت به انتظار' : 'تأیید نوبت'} ${row.userName}`}>{busy === `appointment-${row.id}` ? <LoaderCircle className="spin" size={14} /> : <CheckCheck size={14} />}{row.status === 'confirmed' ? 'بازگشت به انتظار' : 'تأیید نوبت'}</button><button className="admin-row-action subtle-danger" disabled={busy !== null} onClick={() => onCancel(row)} aria-label={`لغو نوبت ${row.userName}`}><Trash2 size={14} />لغو</button></div></td></tr>)}</tbody></table></div>;
}

function ReviewsList({ rows, busy, onToggle }) {
  if (!rows.length) return <EmptyState icon={MessageCircle} title="هنوز تجربه‌ای ثبت نشده است" description="پس از ثبت نظر کاربران، می‌توانید نمایش عمومی هر نظر را از این بخش مدیریت کنید." />;
  return <div className="admin-review-list">{rows.map(row => <article className={`admin-review ${row.hidden ? 'hidden-review' : ''}`} key={row.id}><div className="admin-review-heading"><div className="admin-user-cell"><span className="admin-initial">{row.name?.charAt(0) || 'ک'}</span><div><strong>{row.name}</strong><small>{formatDate(row.createdAt)}</small></div></div><span className={`admin-status ${row.hidden ? 'is-blocked' : 'is-active'}`}>{row.hidden ? 'پنهان از سایت' : 'نمایش در سایت'}</span></div><div className="admin-review-stars" aria-label={`${number(row.rating)} از ۵ ستاره`}>{Array.from({length:5},(_,index) => <Star key={index} size={14} fill={index < row.rating ? 'currentColor' : 'none'} />)}</div><p>{row.comment}</p><button className="admin-row-action" onClick={() => onToggle(row)} disabled={busy !== null}>{busy === `review-${row.id}` ? <LoaderCircle className="spin" size={15} /> : row.hidden ? <Eye size={15} /> : <EyeOff size={15} />}{row.hidden ? 'نمایش دوباره نظر' : 'پنهان کردن از سایت'}</button></article>)}</div>;
}

function AuditTable({ rows }) {
  if (!rows.length) return <EmptyState icon={History} title="هنوز رویدادی ثبت نشده است" description="تغییر وضعیت کاربران، نوبت‌ها و نظرها در این قسمت ثبت می‌شود." />;
  return <div className="admin-table-scroll" tabIndex={0} aria-label="تاریخچه فعالیت مدیریت، قابل پیمایش افقی"><table className="admin-table admin-audit-table"><caption className="admin-sr-only">تاریخچه فعالیت مدیر سایت</caption><thead><tr><th scope="col">فعالیت</th><th scope="col">انجام‌دهنده</th><th scope="col">مورد</th><th scope="col">زمان</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><span className="admin-audit-action"><History size={14} />{actionNames[row.action] || 'تغییر مدیریتی'}</span></td><td>{row.actorName || 'مدیر سایت'}</td><td><span className="admin-audit-target">{targetNames[row.targetType] || 'مورد'} {number(row.targetId)}</span></td><td className="admin-nowrap">{formatDate(row.createdAt, true)}</td></tr>)}</tbody></table></div>;
}
