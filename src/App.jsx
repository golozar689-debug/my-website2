import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUpLeft, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, ChevronDown, Clock3, Heart, HeartHandshake, Menu, MessageCircle, MoveUpRight, ShieldCheck, Sparkles, Star, Stethoscope, UserRound, Video, X, Plus, CircleCheck, Quote, Leaf, Activity, LoaderCircle } from 'lucide-react';
import { AuthDialog, AccountDialog, ModalShell } from './components/AccountDialogs.jsx';
import { api } from './lib/api.js';

const GlassScene = lazy(() => import('./components/GlassScene.jsx'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard.jsx'));

const fa = value => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(value);
const dateFormat = (value, options = {}) => new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', ...options }).format(new Date(`${value}T12:00:00+03:30`));
function todayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year','month','day'].map(type => parts.find(p => p.type === type).value).join('-');
}
function addDays(iso, days) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function firstAvailableDate() {
  let date = todayISO();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Tehran', hour:'2-digit', hourCycle:'h23' }).format(new Date()));
  if (hour >= 19) date = addDays(date, 1);
  while (new Date(`${date}T12:00:00Z`).getUTCDay() === 5) date = addDays(date, 1);
  return date;
}
const VISITS = [
  { id:'consultation', icon:Stethoscope, name:'ویزیت دامپزشکی', short:'بررسی دقیق، مراقبت آگاهانه', description:'بررسی شرایط حیوان همراهتان و گفت‌وگو درباره مسیر مناسب پیگیری و درمان.', number:'01' },
  { id:'followup', icon:HeartHandshake, name:'پیگیری درمان', short:'همراهی در مسیر بهبودی', description:'بررسی روند بهبود حیوان پس از درمان و پاسخ به پرسش‌های شما درباره مراقبت از او.', number:'02' },
  { id:'online', icon:Video, name:'مشاوره دامپزشکی', short:'یک قدم نزدیک‌تر به آرامش', description:'درخواست هماهنگی برای مشاوره درباره سلامت حیوان و راهنمایی برای مراجعه حضوری.', number:'03' },
];

function App() {
  if (window.location.pathname.replace(/\/+$/, '') === '/admin') {
    return <Suspense fallback={<div className="app-loading" role="status"><LoaderCircle className="spin" size={24} />در حال آماده‌سازی پنل مدیریت…</div>}><AdminDashboard /></Suspense>;
  }
  return <HomePage />;
}

function HomePage() {
  const [user, setUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authMode, setAuthMode] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [visitType, setVisitType] = useState('consultation');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewsError, setReviewsError] = useState('');
  const [reviewLoading, setReviewLoading] = useState(true);
  const [success, setSuccess] = useState(null);
  const [faqOpen, setFaqOpen] = useState(0);
  const heroRef = useRef(null);

  useEffect(() => {
    api('/session').then(data => setUser(data.user)).catch(() => {}).finally(() => setSessionLoading(false));
    loadReviews();
  }, []);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timeout); }, [notice]);
  async function loadReviews() {
    setReviewLoading(true); setReviewsError('');
    try { const data = await api('/reviews'); setReviews(data.reviews); }
    catch (error) { setReviewsError(error.message); }
    finally { setReviewLoading(false); }
  }
  function scrollTo(id) { setMenuOpen(false); document.getElementById(id)?.scrollIntoView({ behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start' }); }
  function authenticated(value) { setUser(value); setAuthMode(null); setNotice('خوش آمدید! حالا می‌توانید نوبت بگیرید یا تجربه‌تان را بنویسید.'); }
  function openReview() { if (!user) { setAuthMode('login'); setNotice('برای ثبت تجربه، ابتدا وارد حساب خود شوید.'); } else setReviewOpen(true); }
  const averageRating = reviews.length ? reviews.reduce((sum,r) => sum + r.rating,0) / reviews.length : 0;

  return <>
    <a className="skip-link" href="#main">رفتن به محتوای اصلی</a>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="grain" />
    <header className="header-wrap">
      <nav className="navbar glass" aria-label="ناوبری اصلی">
        <a className="brand" href="#" aria-label="صفحه اصلی دکتر بهنام وزیریان">
          <span className="brand-symbol"><Plus strokeWidth={3} /></span>
          <span><strong>دکتر بهنام وزیریان</strong><small>دامپزشک، رزیدنت جراحی</small></span>
        </a>
        <div className={`nav-links ${menuOpen ? 'is-open' : ''}`}>
          <a href="#about" onClick={() => setMenuOpen(false)}>درباره دکتر</a>
          <a href="#services" onClick={() => setMenuOpen(false)}>خدمات و مراقبت‌ها</a>
          <a href="#reviews" onClick={() => setMenuOpen(false)}>تجربه مراجعین</a>
        </div>
        <div className="nav-actions">
          <button className="login-btn" disabled={sessionLoading} onClick={() => user ? setAccountOpen(true) : setAuthMode('login')}><UserRound size={17} /><span>{user ? user.name.split(' ')[0] : 'ورود / ثبت‌نام'}</span></button>
          <button className="nav-book" onClick={() => scrollTo('booking')}>دریافت نوبت<ArrowUpLeft size={17} /></button>
          <button className="mobile-menu icon-btn" onClick={() => setMenuOpen(v => !v)} aria-label={menuOpen ? 'بستن منو' : 'باز کردن منو'} aria-expanded={menuOpen}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </nav>
    </header>

    <main id="main">
      <section className="hero container" aria-labelledby="hero-title" ref={heroRef}>
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow"><span className="live-dot" /> برای سلامت حیوانات، با تمام وجود</div>
          <h1 id="hero-title">مراقبتی از جنسِ<br /><span className="hero-emphasis">آرامش<svg viewBox="0 0 300 20" aria-hidden="true"><path d="M8 14Q140-7 292 11" /></svg></span>، برای او<span className="title-dot">.</span></h1>
          <p className="hero-description">من بهنام وزیریان، دامپزشک و رزیدنت جراحی هستم.<br />برای سلامت حیوان همراهتان، با دقت،<br className="desktop-break" /> شفافیت و همراهی در هر قدم.</p>
          <div className="hero-actions">
            <button className="primary-btn" onClick={() => scrollTo('booking')}>دریافت نوبت آنلاین <ArrowUpLeft size={20} /></button>
            <button className="text-btn" onClick={() => scrollTo('about')}><span className="round-arrow"><ArrowDown size={17} /></span> بیشتر با من آشنا شوید</button>
          </div>
          <div className="hero-assurances"><span><ShieldCheck size={17} /> حریم خصوصی شما محفوظ است</span><i /><span><CalendarDays size={16} /> انتخاب آسان زمان مراجعه</span></div>
          <div className="hero-signature"><span>مراقبت، فراتر از درمان</span><span className="signature-line" /><small dir="ltr">B. VAZIRIAN</small></div>
        </div>
        <div className="hero-art" aria-label="تصویر دکتر بهنام وزیریان در میان المان‌های شیشه‌ای سه‌بعدی">
          <div className="art-glow" /><div className="art-orb" /><div className="art-ring ring-one" /><div className="art-ring ring-two" />
          <span className="art-coordinate coord-top" dir="ltr">EVERY LIFE MATTERS.</span>
          <Suspense fallback={null}><GlassScene /></Suspense>
          <div className="portrait-frame"><img className="doctor-portrait" src="/doctor.png" alt="دکتر بهنام وزیریان، دامپزشک و رزیدنت جراحی" fetchPriority="high" /><div className="portrait-fade" /></div>
          <div className="floating-card floating-care glass"><span className="mini-icon"><Heart size={21} /></span><div><strong>با دقت، با دل</strong><small>برای حال بهتر همراهتان</small></div><span className="float-spark">✦</span></div>
          <div className="floating-specialty glass"><span className="medical-orb"><Plus size={27} strokeWidth={3} /></span><strong>دامپزشک<br />رزیدنت جراحی</strong><span className="specialty-line" /><Activity size={23} /></div>
          <div className="portrait-nameplate glass"><span className="nameplate-status"><i /> همراه شما</span><strong>دکتر بهنام وزیریان</strong><span dir="ltr">DR. BEHNAM VAZIRIAN</span></div>
          <span className="art-coordinate coord-bottom" dir="ltr">PRECISION IN EVERY STEP —</span>
        </div>
        <button className="scroll-hint" onClick={() => scrollTo('services')} aria-label="مشاهده ادامه صفحه"><span />کمی پایین‌تر، بیشتر آشنا شویم</button>
      </section>

      <section className="care-strip container glass" aria-label="رویکرد مراقبت">
        <div className="strip-intro"><span className="strip-star">✳</span><div><strong>حال خوب، از یک انتخاب شروع می‌شود.</strong><small>در مسیر سلامت حیوانتان، تنها نیستید.</small></div></div>
        <div className="strip-item"><span><Stethoscope /></span><div><strong>مراقبت فردی</strong><small>متناسب با شرایط حیوان</small></div></div>
        <div className="strip-item"><span><MessageCircle /></span><div><strong>گفت‌وگوی شفاف</strong><small>پاسخ به پرسش‌های شما</small></div></div>
        <div className="strip-item"><span><HeartHandshake /></span><div><strong>همراهی مستمر</strong><small>در طول مسیر درمان</small></div></div>
      </section>

      <section id="services" className="section container services-section">
        <div className="section-heading"><div><span className="eyebrow"><span className="tiny-plus">+</span> خدمات و مراقبت‌ها</span><h2>یک قدم نزدیک‌تر،<br className="mobile-only" /> به حالِ بهتر.</h2></div><p>از اولین گفت‌وگو تا پیگیری درمان،<br />برای هر مرحله، یک همراه در کنار شماست.</p></div>
        <div className="service-grid">{VISITS.map(({id,icon:Icon,name,short,description,number}) => <button key={id} className={`service-card glass ${id==='consultation'?'service-featured':''}`} onClick={() => { setVisitType(id); scrollTo('booking'); }}><div className="service-card-top"><span className="service-icon"><Icon size={29} strokeWidth={1.5} /></span><span className="service-number">{number}</span></div><span className="service-subtitle">{short}</span><h3>{name}</h3><p>{description}</p><div className="service-card-bottom"><span>انتخاب و درخواست نوبت</span><span className="service-arrow"><ArrowUpLeft size={20} /></span></div></button>)}</div>
      </section>

      <section id="about" className="about-section container">
        <div className="about-visual glass"><div className="about-orbit" /><div className="about-cross"><Plus size={90} strokeWidth={2.5} /></div><div className="about-quote"><Quote size={23} /><p>مراقبت از آن‌ها،<br />با <em>دقت و مهر.</em></p><span>نگاه ما به مراقبت</span></div><span className="about-vertical" dir="ltr">COMPASSION FOR EVERY LIFE</span><div className="about-badge glass"><HeartHandshake /><span>دانش، دقت و همدلی</span></div></div>
        <div className="about-copy"><span className="eyebrow"><span className="tiny-plus">+</span> کمی نزدیک‌تر</span><h2>پشت هر نگاه بی‌کلام،<br />یک <span className="serif-accent">زندگی</span> ارزشمند است.</h2><p>من دکتر بهنام وزیریان، دامپزشک و رزیدنت جراحی هستم. باور دارم توجه به شرایط حیوان و آگاهی همراه او، بخش مهمی از مسیر مراقبت است؛ به همین دلیل، گفت‌وگو و پاسخ روشن به پرسش‌های شما را جدی می‌گیرم.</p><p>این فضا ساخته شده تا آشنایی، انتخاب زمان مراجعه و پیگیری درخواست‌ها برای شما ساده‌تر و شفاف‌تر باشد.</p><div className="about-values"><span><CircleCheck size={17} /> توجه به دغدغه‌های شما</span><span><CircleCheck size={17} /> احترام به حریم خصوصی</span></div><a href="#booking" className="about-link">برای یک گفت‌وگو، وقت بگذاریم <ArrowLeft size={19} /></a></div>
      </section>

      <section id="booking" className="section booking-section container">
        <div className="section-heading"><div><span className="eyebrow"><span className="tiny-plus">+</span> نوبت‌دهی آنلاین</span><h2>یک زمان برای سلامت همراهتان.</h2></div><p>روز و ساعت مناسب را انتخاب کنید؛<br />باقی مسیر را با هم پیش می‌رویم.</p></div>
        <Booking user={user} type={visitType} onTypeChange={setVisitType} onLogin={() => setAuthMode('login')} onSuccess={setSuccess} />
      </section>

      <section id="reviews" className="section reviews-section container">
        <div className="section-heading"><div><span className="eyebrow"><span className="tiny-plus">+</span> صدای شما</span><h2>تجربه شما، ارزشمند است.</h2></div><button className="secondary-btn" onClick={openReview}><MessageCircle size={18} /> ثبت تجربه من <ArrowUpLeft size={17} /></button></div>
        {reviewLoading ? <div className="review-empty glass"><LoaderCircle className="spin" />در حال دریافت تجربه‌ها…</div> : reviewsError ? <div className="review-empty glass"><p>{reviewsError}</p><button className="text-btn" onClick={loadReviews}>تلاش دوباره</button></div> : reviews.length ? <><div className="review-summary"><span className="review-rating">{averageRating.toLocaleString('fa-IR',{maximumFractionDigits:1})}<Star size={18} fill="currentColor" /></span><span>از {fa(reviews.length)} تجربه ثبت‌شده در این سایت</span></div><div className="review-grid">{reviews.slice(0,6).map(review => <article className="review-card glass" key={review.id}><div className="review-top"><span className="review-avatar">{review.name.charAt(0)}</span><div><strong>{review.name}</strong><small>{new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeZone:'Asia/Tehran'}).format(new Date(review.createdAt))}</small></div><Quote size={24} /></div><div className="stars" aria-label={`${fa(review.rating)} از ۵ ستاره`}>{Array.from({length:5},(_,i)=><Star key={i} size={14} fill={i<review.rating?'currentColor':'none'} className={i<review.rating?'':'star-muted'} />)}</div><p>{review.comment}</p><span className="review-auth-note"><CheckCheck size={14} /> ثبت‌شده توسط کاربر سایت</span></article>)}</div></> : <div className="review-invitation glass"><div className="review-illustration"><MessageCircle size={42} strokeWidth={1.2} /><span><Star size={18} fill="currentColor" /></span></div><div><h3>اولین تجربه را شما بنویسید.</h3><p>هنوز نظری در این سایت ثبت نشده است. اگر تجربه مراجعه دارید،<br className="desktop-break" /> روایت شما می‌تواند به انتخاب آگاهانه دیگران کمک کند.</p></div><button className="text-btn" onClick={openReview}>نوشتن تجربه <ArrowLeft size={19} /></button></div>}
        <p className="reviews-disclaimer"><ShieldCheck size={14} /> نظرها تجربه شخصی کاربران هستند و جایگزین مشاوره دامپزشکی نیستند.</p>
      </section>

      <section className="faq-section container section"><div className="faq-intro"><span className="eyebrow"><span className="tiny-plus">+</span> پیش از مراجعه</span><h2>شاید سؤال شما<br />هم همین باشد.</h2><p>پاسخ‌های کوتاه، برای یک شروع آرام‌تر.</p><span className="faq-spark">✳</span></div><div className="faq-list">{[
        ['چطور نوبت بگیرم؟','در بخش نوبت‌دهی، روز و ساعت را انتخاب کنید، وارد حساب شوید و شماره همراه خود را وارد کنید. پس از ثبت، درخواست در بخش «نوبت‌های من» قابل مشاهده است. تأیید نهایی زمان مراجعه باید توسط مطب انجام شود.'],
        ['آیا زمان‌های نمایش‌داده‌شده برنامه قطعی مطب هستند؟','خیر. در این نسخه، ساعت‌ها برای نمایش عملکرد سامانه تنظیم شده‌اند. برنامه حضور، آدرس و راه ارتباطی باید پیش از استفاده عمومی توسط مطب تأیید و تکمیل شوند.'],
        ['چطور وضعیت نوبت را ببینم یا آن را لغو کنم؟','پس از ورود، روی نام خود در بالای صفحه بزنید. در بخش «نوبت‌های من» وضعیت درخواست را ببینید. تأیید مدیر سایت در همین بخش نمایش داده می‌شود. برای لغو، درخواست موردنظر را پیدا و گزینه لغو را انتخاب کنید.'],
        ['چه کسی به اطلاعات حساب و نوبت‌ها دسترسی دارد؟','مدیر سایت برای مدیریت خدمات به نام، ایمیل، اطلاعات نوبت و شماره همراه ثبت‌شده دسترسی دارد. رمز عبور به‌صورت هش ذخیره می‌شود و قابل مشاهده نیست. نظرهای منتشرشده با نام حساب شما برای بازدیدکنندگان نمایش داده می‌شوند.'],
        ['برای مراجعه چه چیزهایی همراه داشته باشم؟','سوابق دامپزشکی حیوان، نتایج آزمایش یا تصویربرداری قبلی و فهرست داروهای مصرفی او را آماده کنید. برای شرایط ویژه، راهنمایی اختصاصی را از مرکز دامپزشکی دریافت کنید.'],
      ].map(([q,a],i)=><div className={`faq-item ${faqOpen===i?'expanded':''}`} key={q}><button onClick={()=>setFaqOpen(faqOpen===i?null:i)} aria-expanded={faqOpen===i} aria-controls={`faq-${i}`}><span><small>{fa(i+1).padStart(2,'۰')}</small>{q}</span><Plus size={20} /></button><div id={`faq-${i}`} hidden={faqOpen!==i}><p>{a}</p></div></div>)}</div></section>

      <section className="closing-banner container glass"><div className="closing-orb"><Heart size={38} strokeWidth={1.3} /></div><div><span className="eyebrow">از یک گفت‌وگو شروع کنیم.</span><h2>برای سلامتی همراهتان، وقت بگذارید.</h2></div><button className="primary-btn" onClick={()=>scrollTo('booking')}>انتخاب زمان مراجعه <ArrowUpLeft size={20} /></button></section>
    </main>

    <footer className="footer container"><div className="footer-top"><a className="brand" href="#"><span className="brand-symbol"><Plus strokeWidth={3}/></span><span><strong>دکتر بهنام وزیریان</strong><small>دامپزشک، رزیدنت جراحی · همراه شما در مسیر سلامت حیوانات</small></span></a><div className="footer-links"><a href="#about">درباره دکتر</a><a href="#booking">دریافت نوبت</a><a href="#reviews">ثبت تجربه</a><button onClick={()=>user?setAccountOpen(true):setAuthMode('login')}>حساب کاربری</button></div></div><div className="footer-bottom"><p>اطلاعات تماس و آدرس، پس از تأیید مطب اضافه می‌شود.</p><span dir="ltr">DESIGNED WITH CARE <Heart size={12} /></span><p>© {new Intl.DateTimeFormat('fa-IR',{year:'numeric'}).format(new Date())} دکتر بهنام وزیریان</p></div></footer>
    {notice && <div className="toast glass" role="status"><CircleCheck size={20}/><span>{notice}</span><button className="icon-btn" aria-label="بستن پیام" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {authMode && <AuthDialog mode={authMode} onClose={()=>setAuthMode(null)} onModeChange={setAuthMode} onAuthenticated={authenticated} />}
    {accountOpen && <AccountDialog user={user} onClose={()=>setAccountOpen(false)} onLogout={()=>{setUser(null);setAccountOpen(false);setNotice('از حساب خود خارج شدید.');}} onChanged={()=>{}} />}
    {reviewOpen && <ReviewDialog onClose={()=>setReviewOpen(false)} onSuccess={()=>{setReviewOpen(false);loadReviews();setNotice('ممنون از شما. تجربه‌تان ثبت شد.');}} />}
    {success && <ModalShell title="درخواست نوبت ثبت شد" onClose={()=>setSuccess(null)} className="success-dialog"><span className="success-symbol"><Check size={38}/></span><span className="eyebrow">یک قدم برای حال بهتر</span><h2>درخواست شما ثبت شد.</h2><p>این درخواست هنوز به تأیید مطب نیاز دارد.<br/>زمان‌بندی این نسخه، نمایشی است.</p><div className="success-detail glass"><span><CalendarDays size={19}/>{dateFormat(success.date,{weekday:'long',month:'long',day:'numeric'})}</span><span><Clock3 size={19}/>{success.time.replace(/\d/g,d=>fa(d))}</span></div><button className="primary-btn" onClick={()=>{setSuccess(null);setAccountOpen(true);}}>مشاهده نوبت‌های من <ArrowLeft size={18}/></button></ModalShell>}
  </>;
}

function Booking({user,type,onTypeChange,onLogin,onSuccess}) {
  const [date,setDate]=useState(firstAvailableDate);
  const [weekOffset,setWeekOffset]=useState(()=>{
    const today=todayISO();
    const day=new Date(`${today}T12:00:00Z`).getUTCDay();
    const start=addDays(today,-((day+1)%7));
    return Math.floor((new Date(`${firstAvailableDate()}T12:00:00Z`)-new Date(`${start}T12:00:00Z`))/(7*86400000));
  });
  const [time,setTime]=useState('');
  const [slots,setSlots]=useState([]);
  const [phone,setPhone]=useState('');
  const [loading,setLoading]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const [availabilityError,setAvailabilityError]=useState('');
  const [retry,setRetry]=useState(0);
  const today=todayISO();
  const baseDay=new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart=addDays(today,-((baseDay+1)%7)+weekOffset*7);
  const days=Array.from({length:7},(_,i)=>addDays(weekStart,i));
  useEffect(()=>{
    let active=true;setLoading(true);setTime('');setAvailabilityError('');setSlots([]);
    api(`/availability?date=${date}`).then(data=>{if(active)setSlots(data.slots);}).catch(err=>{if(active)setAvailabilityError(err.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[date,retry]);
  async function submit(event) {
    event.preventDefault();setError('');
    if(!time){setError('لطفاً یک ساعت آزاد را انتخاب کنید.');return;}
    const normalized=phone.replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s-]/g,'');
    if(!/^09\d{9}$/.test(normalized)){setError('شماره همراه را با ۰۹ و در ۱۱ رقم وارد کنید.');return;}
    if(!user){onLogin();return;}
    setSubmitting(true);
    try{const data=await api('/appointments',{method:'POST',body:JSON.stringify({date,time,type,phone:normalized})});onSuccess(data.appointment);setTime('');setRetry(v=>v+1);}
    catch(err){setError(err.message);setRetry(v=>v+1);}
    finally{setSubmitting(false);}
  }
  return <div className="booking-panel glass"><div className="booking-calendar"><div className="booking-topline"><h3><CalendarDays size={20}/> روز و ساعت را انتخاب کنید</h3><span className="demo-badge">برنامه نمایشی</span></div><div className="calendar-toolbar"><div><strong>{dateFormat(days[0],{month:'long'})}{dateFormat(days[0],{month:'long'})!==dateFormat(days[6],{month:'long'})?` / ${dateFormat(days[6],{month:'long'})}`:''}</strong><span>{dateFormat(days[0],{year:'numeric'})}</span></div><div className="week-nav"><button type="button" className="icon-btn" disabled={weekOffset===0} onClick={()=>setWeekOffset(v=>v-1)} aria-label="هفته قبل"><ChevronRight size={19}/></button><span>{weekOffset===0?'این هفته':weekOffset===1?'هفته آینده':`${fa(weekOffset)} هفته بعد`}</span><button type="button" className="icon-btn" disabled={weekOffset>=7} onClick={()=>setWeekOffset(v=>v+1)} aria-label="هفته بعد"><ChevronLeft size={19}/></button></div></div><div className="calendar-week">{days.map(day=>{const disabled=day<today||new Date(`${day}T12:00:00Z`).getUTCDay()===5;return <button type="button" key={day} className={`calendar-day ${day===date?'selected':''}`} aria-label={dateFormat(day,{weekday:'long',month:'long',day:'numeric'})} aria-pressed={day===date} disabled={disabled} onClick={()=>{setDate(day);setError('');}}><span>{dateFormat(day,{weekday:'short'})}</span><strong>{dateFormat(day,{day:'numeric'})}</strong><i/></button>;})}</div><div className="slots-heading"><span><Clock3 size={15}/> ساعت‌های قابل انتخاب</span><small>به وقت تهران</small></div>{loading?<div className="slots-message" role="status"><LoaderCircle size={19} className="spin"/>در حال دریافت ساعت‌ها…</div>:availabilityError?<div className="slots-message form-error"><span>{availabilityError}</span><button className="text-btn" onClick={()=>setRetry(v=>v+1)}>تلاش دوباره</button></div>:!slots.length||!slots.some(s=>s.available)?<div className="slots-message">زمان آزادی برای این روز وجود ندارد. روز دیگری را انتخاب کنید.</div>:<div className="time-slots">{slots.map(slot=><button type="button" key={slot.time} disabled={!slot.available} aria-pressed={time===slot.time} onClick={()=>{setTime(slot.time);setError('');}} className={time===slot.time?'selected':''}><span dir="ltr">{slot.time.replace(/\d/g,d=>fa(d))}</span>{time===slot.time&&<Check size={13}/>}</button>)}</div>}<div className="calendar-legend"><span><i className="legend-free"/> قابل انتخاب</span><span><i className="legend-selected"/> انتخاب شما</span><span><i className="legend-closed"/> غیرقابل رزرو</span></div><p className="booking-demo-note">ساعت‌ها نمونه‌اند. تأیید نهایی مراجعه پس از هماهنگی با مطب انجام می‌شود.</p></div><form className="booking-summary" onSubmit={submit}><span className="eyebrow">نوبت شما، در یک نگاه</span><div className="summary-doctor"><span className="doctor-avatar"><img src="/doctor.png" alt="" loading="lazy"/></span><div><h3>دکتر بهنام وزیریان</h3><p>دامپزشک، رزیدنت جراحی</p></div><span className="summary-check"><ShieldCheck size={21}/></span></div><label className="form-field" htmlFor="visit-type"><span>نوع مراجعه</span><span className="select-wrap"><select id="visit-type" value={type} onChange={e=>onTypeChange(e.target.value)}>{VISITS.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select><ChevronDown size={15}/></span></label><div className="selected-datetime"><span><CalendarDays size={17}/>{dateFormat(date,{weekday:'long',month:'long',day:'numeric'})}</span><span><Clock3 size={17}/>{time?time.replace(/\d/g,d=>fa(d)):'ساعت را انتخاب کنید'}</span></div><label className="form-field" htmlFor="booking-phone"><span>شماره همراه شما <small>برای هماهنگی مراجعه حیوان</small></span><input id="booking-phone" name="phone" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0912 345 6789" maxLength={16} required/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-btn booking-submit" type="submit" disabled={loading||submitting}>{submitting?<><LoaderCircle size={18} className="spin"/>در حال ثبت…</>:<>{user?'ثبت درخواست نوبت':'ورود و ثبت درخواست'}<ArrowUpLeft size={19}/></>}</button><p className="privacy-note"><ShieldCheck size={13}/> اطلاعات شما فقط برای پیگیری درخواست ذخیره می‌شود.</p></form></div>;
}

function ReviewDialog({onClose,onSuccess}){
  const[rating,setRating]=useState(5),[hover,setHover]=useState(0),[comment,setComment]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  async function submit(e){e.preventDefault();setError('');setLoading(true);try{await api('/reviews',{method:'POST',body:JSON.stringify({rating,comment})});onSuccess();}catch(err){setError(err.message);}finally{setLoading(false);}}
  return <ModalShell title="ثبت تجربه مراجعه" onClose={onClose}><span className="dialog-icon"><MessageCircle size={25}/></span><span className="eyebrow">صدای شما شنیده می‌شود</span><h2>تجربه‌تان را بنویسید.</h2><p className="modal-description">اگر تجربه مراجعه با حیوانتان دارید، صادقانه با دیگران به اشتراک بگذارید.</p><form onSubmit={submit}><fieldset className="rating-field"><legend>از تجربه خود چقدر رضایت دارید؟</legend><div className="rating-buttons" dir="ltr">{Array.from({length:5},(_,i)=><button type="button" key={i} onMouseEnter={()=>setHover(i+1)} onMouseLeave={()=>setHover(0)} onFocus={()=>setHover(i+1)} onBlur={()=>setHover(0)} onClick={()=>setRating(i+1)} aria-label={`${fa(i+1)} ستاره`} aria-pressed={rating===i+1}><Star size={30} fill={i<(hover||rating)?'currentColor':'none'}/></button>)}</div></fieldset><label className="form-field"><span>نظر شما</span><textarea value={comment} onChange={e=>setComment(e.target.value)} minLength={10} maxLength={1000} rows={4} placeholder="از برخورد، پاسخ‌گویی و تجربه مراجعه با حیوانتان بگویید…" required/></label><p className="privacy-note">نظر با نام حساب شما نمایش داده می‌شود. لطفاً اطلاعات شخصی یا جزئیات حساس درمانی را ننویسید.</p>{error&&<p className="form-error" role="alert">{error}</p>}<button type="submit" className="primary-btn" disabled={loading}>{loading?'در حال ثبت…':'ثبت تجربه'}<ArrowLeft size={18}/></button></form></ModalShell>;
}

export default App;
