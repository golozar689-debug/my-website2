import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CalendarDays, Check, Clock3, Eye, EyeOff, LoaderCircle, LogOut, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { api } from '../lib/api';

export function ModalShell({ children, onClose, title, className = '' }) {
  const card = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const first = card.current?.querySelector('input, textarea, select, button');
      (first || card.current)?.focus();
    }, 30);
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
      if (event.key !== 'Tab') return;
      const elements = [...(card.current?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') || [])]
        .filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        card.current?.focus();
      } else if (event.shiftKey && (document.activeElement === first || !card.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !card.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div className={`modal-card ${className}`} ref={card} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : 'پنجره اطلاعات'} tabIndex={-1} dir="rtl">
        <button type="button" className="modal-close icon-button" onClick={onClose} aria-label="بستن پنجره"><X size={20} /></button>
        {title && <h2 id={titleId} className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>, document.body,
  );
}

export function AuthDialog({ mode = 'login', onClose, onModeChange, onAuthenticated, allowRegistration = true }) {
  const register = mode === 'register';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const formId = useId();

  useEffect(() => { setError(''); setPassword(''); }, [mode]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api(register ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ ...(register ? { name: name.trim() } : {}), email: email.trim(), password }),
      });
      onAuthenticated(result.user);
    } catch (failure) {
      setError(failure.message || 'ارتباط برقرار نشد. دوباره تلاش کنید.');
    } finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose} title={register ? 'به جمع ما خوش آمدید' : 'خوش برگشتید'} className="auth-dialog">
      <div className="auth-symbol"><UserRound size={26} /></div>
      <p className="eyebrow">حساب کاربری شما</p>
      <p className="modal-description">{register ? 'برای مدیریت نوبت‌ها و ثبت تجربه، حساب بسازید.' : 'وارد شوید و نوبت‌هایتان را در یک نگاه ببینید.'}</p>
      <form onSubmit={submit} className="auth-form">
        {register && <div className="form-field">
          <label htmlFor={`${formId}-name`}>نام و نام خانوادگی</label>
          <input id={`${formId}-name`} autoComplete="name" placeholder="نام و نام خانوادگی شما" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} disabled={busy} />
        </div>}
        <div className="form-field">
          <label htmlFor={`${formId}-email`}>ایمیل</label>
          <input id={`${formId}-email`} type="email" autoComplete="email" dir="ltr" inputMode="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} disabled={busy} />
        </div>
        <div className="form-field">
          <label htmlFor={`${formId}-password`}>رمز عبور</label>
          <div className="password-input">
            <input id={`${formId}-password`} type={visible ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} dir="ltr" placeholder={register ? 'حداقل ۸ کاراکتر' : 'رمز عبور شما'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={register ? 8 : 1} maxLength={128} disabled={busy} />
            <button type="button" className="password-toggle icon-button" onClick={() => setVisible(!visible)} aria-label={visible ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'} aria-pressed={visible}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
        </div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit" className="primary-btn" disabled={busy}>{busy ? <LoaderCircle className="spin" size={19} /> : <ArrowLeft size={19} />}{busy ? 'لطفاً کمی صبر کنید…' : register ? 'ساخت حساب کاربری' : 'ورود به حساب'}</button>
      </form>
      {allowRegistration && <p className="auth-switch">{register ? 'قبلاً حساب ساخته‌اید؟' : 'هنوز حساب ندارید؟'} <button type="button" onClick={() => onModeChange(register ? 'login' : 'register')} disabled={busy}>{register ? 'وارد شوید' : 'ثبت‌نام کنید'}</button></p>}
      <div className="auth-note"><ShieldCheck size={16} /><span>اطلاعات حساب شما به‌صورت امن نگهداری می‌شود.</span></div>
    </ModalShell>
  );
}

const appointmentNames = { consultation: 'ویزیت دامپزشکی', followup: 'پیگیری درمان', online: 'مشاوره دامپزشکی' };
const persianTime = (value) => value.replace(/\d/g, (number) => '۰۱۲۳۴۵۶۷۸۹'[number]);
function formattedDate(value) {
  return new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Tehran' }).format(new Date(`${value}T12:00:00+03:30`));
}

export function AccountDialog({ user, onClose, onLogout, onChanged }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    let live = true;
    api('/appointments').then((result) => { if (live) setAppointments(result.appointments); })
      .catch((failure) => { if (live) setError(failure.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const cancel = async (id) => {
    setBusy(id);
    setError('');
    try {
      await api(`/appointments/${id}`, { method: 'DELETE' });
      const result = await api('/appointments');
      setAppointments(result.appointments);
      setConfirming(null);
      onChanged?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  };

  const logout = async () => {
    setBusy('logout');
    setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      onLogout();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  };

  return (
    <ModalShell onClose={onClose} title="فضای شخصی شما" className="account-dialog">
      <p className="eyebrow">حساب کاربری</p>
      <div className="account-welcome"><div className="account-avatar"><UserRound size={25} /></div><div><strong>سلام، {user.name}</strong><p dir="ltr">{user.email}</p></div></div>
      {user.role === 'admin' && <a className="secondary-btn account-admin-link" href="/admin"><ShieldCheck size={18} />ورود به پنل مدیریت سایت<ArrowLeft size={17} /></a>}
      <div className="account-section-title"><h3>نوبت‌های من</h3><CalendarDays size={20} /></div>
      {loading ? <div className="account-loading" role="status"><LoaderCircle size={22} className="spin" /><span>در حال دریافت نوبت‌ها…</span></div> : appointments.length === 0 ? <div className="account-empty"><CalendarDays size={32} /><h4>هنوز نوبتی ثبت نکرده‌اید</h4><p>از بخش نوبت‌دهی، زمان مناسب خود را انتخاب کنید.</p><button type="button" className="secondary-btn" onClick={onClose}>انتخاب نوبت <ArrowLeft size={16} /></button></div> : <div className="appointment-list">
        {appointments.map((appointment) => <article className="appointment-item" key={appointment.id}>
          <div className="appointment-item-header"><strong>{appointmentNames[appointment.type] || 'درخواست نوبت'}</strong><span className={`appointment-status ${appointment.status === 'cancelled' ? 'cancelled' : appointment.status === 'confirmed' ? 'confirmed' : ''}`}>{appointment.status === 'cancelled' ? 'لغو شده' : appointment.status === 'confirmed' ? 'تأیید شده' : 'در انتظار تأیید مطب'}</span></div>
          <div className="appointment-details"><span><CalendarDays size={15} />{formattedDate(appointment.date)}</span><span><Clock3 size={15} />ساعت {persianTime(appointment.time)}</span></div>
          {appointment.status !== 'cancelled' && (confirming === appointment.id ? <div className="cancel-confirmation"><span>این درخواست نوبت لغو شود؟</span><button type="button" className="cancel-yes" onClick={() => cancel(appointment.id)} disabled={busy !== null}>{busy === appointment.id ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} بله، لغو شود</button><button type="button" onClick={() => setConfirming(null)} disabled={busy !== null}>انصراف</button></div> : <button type="button" className="cancel-appointment" onClick={() => setConfirming(appointment.id)} disabled={busy !== null}><Trash2 size={14} />لغو درخواست</button>)}
        </article>)}
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="account-schedule-note">زمان‌های ارائه‌شده، برنامه نمونه سایت هستند. وضعیت تأیید هر درخواست در کنار آن نمایش داده می‌شود؛ برای مراجعه با مرکز دامپزشکی هماهنگ کنید.</p>
      <button type="button" className="secondary-btn logout-btn" onClick={logout} disabled={busy !== null}>{busy === 'logout' ? <LoaderCircle className="spin" size={18} /> : <LogOut size={18} />}خروج از حساب</button>
    </ModalShell>
  );
}
