const API = '/api';
let publicDb = { services: [], hours: [] };
let adminToken = localStorage.getItem('massage_admin_token') || '';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('fa-IR').format(n) + ' تومان';
const statusText = {pending:'در انتظار تأیید',confirmed:'تأیید شده',completed:'انجام شد',cancelled:'لغو شده'};

async function api(url, options={}) {
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  const res = await fetch(API + url, {...options, headers});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'خطایی رخ داد.');
  return data;
}
function openModal(id){const m=$(id); m?.classList.add('open'); m?.setAttribute('aria-hidden','false');}
function closeModal(el){const m=el.closest('.modal');m?.classList.remove('open');m?.setAttribute('aria-hidden','true');}
function dayIndex(dateStr){const d=new Date(dateStr+'T12:00:00'); return (d.getDay()+1)%7;}
function setToday(){const d=new Date().toISOString().slice(0,10); $('#booking-date').min=d; if(!$('#booking-date').value) $('#booking-date').value=d;}

async function loadPublic(){
  publicDb = await api('/public');
  $('#service-cards').innerHTML = publicDb.services.map(s=>`<article class="card service-card"><div class="service-top"><div class="service-icon"><i class="icon-hand"></i></div><span class="muted">${s.minutes} دقیقه</span></div><h3>${s.name}</h3><p>${s.desc}</p><div class="service-meta"><span class="price">${money(s.price)}</span><button class="text-btn" data-service="${s.id}">رزرو <i class="icon-arrow-left"></i></button></div></article>`).join('');
  $('#pricing-table').innerHTML='<div class="pricing-row head"><span>خدمت</span><span>مدت</span><span>قیمت</span><span></span></div>'+publicDb.services.map(s=>`<div class="pricing-row"><strong>${s.name}</strong><span>${s.minutes} دقیقه</span><span>${money(s.price)}</span><span><button class="mini-btn" data-service="${s.id}">رزرو</button></span></div>`).join('');
  $$('#service-cards [data-service],#pricing-table [data-service]').forEach(b=>b.onclick=()=>openBooking(b.dataset.service));
}
async function refreshTimes(){
  const date=$('#booking-date').value, service=$('#booking-service').value; if(!date||!service)return;
  try { const {times}=await api(`/availability?date=${encodeURIComponent(date)}&service=${encodeURIComponent(service)}`); $('#booking-time').innerHTML=times.length?times.map(t=>`<option value="${t}">${t}</option>`).join(''):'<option value="">ظرفیت این روز تکمیل است</option>'; updateSummary(); }
  catch(e){ $('#booking-time').innerHTML='<option value="">خطا در دریافت زمان‌ها</option>'; }
}
function updateSummary(){const s=publicDb.services.find(x=>x.id===$('#booking-service')?.value); if(!s)return; $('#booking-summary').innerHTML=`<strong>${s.name}</strong> · ${s.minutes} دقیقه · ${money(s.price)}<br><span class="muted">${$('#booking-date')?.value||'—'} · ${$('#booking-time')?.value||'—'}</span>`;}
function openBooking(preselect){
  $('#booking-service').innerHTML=publicDb.services.map(s=>`<option value="${s.id}" ${s.id===preselect?'selected':''}>${s.name} — ${money(s.price)}</option>`).join('');
  $('#booking-form').reset(); setToday(); if(preselect) $('#booking-service').value=preselect; refreshTimes(); updateSummary(); openModal('#booking-modal');
}

$('#booking-form').onsubmit = async e => {
  e.preventDefault(); const fd=new FormData(e.target); const payload=Object.fromEntries(fd.entries());
  try { const result=await api('/bookings',{method:'POST',body:JSON.stringify(payload)}); closeModal($('#booking-modal')); alert(`نوبت ثبت شد.\nکد پیگیری شما: ${result.booking.code}\nاین کد را برای پیگیری رزرو نگه دارید.`); openModal('#customer-portal-modal'); $('#customer-login-form [name="phone"]').value=payload.phone; $('#customer-login-form [name="code"]').value=result.booking.code; $('#customer-login-form').requestSubmit(); }
  catch(err){ alert(err.message); }
};
$('#booking-service').onchange=()=>{refreshTimes();updateSummary()}; $('#booking-date').onchange=refreshTimes; $('#booking-time').onchange=updateSummary;
$$('[data-open-booking]').forEach(b=>b.onclick=()=>openBooking());
$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b)); $$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m)}));

function renderAdmin(data, tab='appointments'){
  $$('.admin-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const root=$('#admin-content');
  if(tab==='appointments'){
    const rows=data.appointments.map(a=>`<div class="admin-item"><div><strong>${a.name}</strong><div class="muted">${a.serviceName || a.service} · ${a.date} · ${a.time} · ${a.duration} دقیقه</div><small>${a.phone}${a.note?` · ${a.note}`:''}<br><span class="${a.status==='confirmed'?'success':a.status==='cancelled'?'error':''}">${statusText[a.status]}</span></small></div><div class="admin-actions"><select data-status="${a.id}">${Object.entries(statusText).map(([k,v])=>`<option value="${k}" ${a.status===k?'selected':''}>${v}</option>`).join('')}</select><button class="mini-btn" data-customer-phone="${a.phone}">پروفایل</button></div></div>`).join('');
    root.innerHTML=`<div class="admin-item" style="background:#f3f6f3"><strong>امروز: ${data.stats.today}</strong><span>در انتظار: ${data.stats.pending}</span><span>مشتری: ${data.stats.customers}</span></div><div class="admin-list" style="margin-top:10px">${rows||'<p class="muted">هنوز نوبتی ثبت نشده است.</p>'}</div>`;
    root.querySelectorAll('[data-status]').forEach(sel=>sel.onchange=async()=>{await api(`/admin/appointments/${sel.dataset.status}`,{method:'PATCH',body:JSON.stringify({status:sel.value})}); refreshAdmin('appointments');});
    root.querySelectorAll('[data-customer-phone]').forEach(b=>b.onclick=()=>adminCustomerByPhone(b.dataset.customerPhone));
  }
  if(tab==='services'){
    root.innerHTML=`<div class="admin-list">${data.services.map(s=>`<div class="admin-item"><div><strong>${s.name}</strong><div class="muted">${s.minutes} دقیقه · ${money(s.price)}</div></div><button class="mini-btn" data-edit-service="${s.id}">ویرایش</button></div>`).join('')}</div>`;
    root.querySelectorAll('[data-edit-service]').forEach(b=>b.onclick=async()=>{const s=data.services.find(x=>x.id===b.dataset.editService);const name=prompt('نام خدمت',s.name);if(name===null)return;const minutes=Number(prompt('مدت به دقیقه',s.minutes));const price=Number(prompt('قیمت',s.price));if(name&&minutes&&price){await api(`/admin/services/${s.id}`,{method:'PATCH',body:JSON.stringify({name,minutes,price})});refreshAdmin('services');loadPublic();}});
  }
  if(tab==='hours'){
    const days=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
    root.innerHTML=`<div class="hours-grid">${days.map((d,i)=>`<div class="hours-row"><strong>${d}</strong><input value="${data.hours[i][0]}" data-hour="${i}-0"><input value="${data.hours[i][1]}" data-hour="${i}-1"></div>`).join('')}</div><button class="btn btn-primary full" style="margin-top:14px" id="save-hours">ذخیره ساعات کاری</button>`;
    $('#save-hours').onclick=async()=>{const hours=data.hours.map(x=>[...x]);root.querySelectorAll('[data-hour]').forEach(inp=>{const [i,k]=inp.dataset.hour.split('-').map(Number);hours[i][k]=inp.value});await api('/admin/hours',{method:'PATCH',body:JSON.stringify({hours})});alert('ساعات کاری ذخیره شد.');loadPublic();};
  }
  if(tab==='customers'){
    root.innerHTML=`<div class="admin-list">${data.customers.map(c=>`<div class="customer-card"><div class="customer-name"><img class="avatar" src="${c.avatar||'https://placehold.co/100x100?text=Client'}" alt=""><div><strong>${c.name}</strong><div class="muted">${c.sessions} جلسه · ${c.phone}</div></div></div><button class="mini-btn" data-customer="${c.id}">مشاهده</button></div>`).join('')}</div>`;
    root.querySelectorAll('[data-customer]').forEach(b=>b.onclick=()=>adminCustomer(data.customers.find(c=>c.id===b.dataset.customer)));
  }
}
async function refreshAdmin(tab='appointments'){
  if(!adminToken){openModal('#admin-login-modal');return;}
  try{const data=await api('/admin/dashboard');renderAdmin(data,tab)}catch(e){adminToken='';localStorage.removeItem('massage_admin_token');openModal('#admin-login-modal');}
}
$('#admin-login-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);try{const r=await api('/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(fd.entries()))});adminToken=r.token;localStorage.setItem('massage_admin_token',adminToken);closeModal($('#admin-login-modal'));$('#admin-drawer').classList.add('open');renderAdmin(await api('/admin/dashboard'));}catch(err){$('#admin-login-message').innerHTML=`<span class="error">${err.message}</span>`;}};
$('#open-admin').onclick=()=>refreshAdmin(); $('[data-close-admin]').onclick=()=>$('#admin-drawer').classList.remove('open'); $('.admin-tabs').onclick=e=>{const b=e.target.closest('button[data-tab]');if(b)refreshAdmin(b.dataset.tab)};

function renderCustomerPortal(data){
  const c=data.customer; const max=10; const remainder=c.sessions%max; const percent=remainder===0&&c.sessions>0?100:(remainder/max*100); const next=c.sessions>=10?'یک جلسه رایگان برای شما فعال است':`تا پاداش بعدی ${5-(c.sessions%5)||5} جلسه`;
  $('#customer-portal-content').innerHTML=`<div class="customer-profile"><div><img class="profile-photo" src="${c.avatar||'https://placehold.co/500x600?text=Client'}" alt="${c.name}"></div><div class="profile-main"><h4>${c.name}</h4><div class="muted">${c.phone}</div><div class="stats"><div class="stat"><strong>${c.sessions}</strong><span class="muted">جلسه تکمیل‌شده</span></div><div class="stat"><strong>${Math.min(c.sessions,10)} / ۱۰</strong><span class="muted">مسیر پاداش</span></div><div class="stat"><strong>${c.sessions>=10?'رایگان':'وفادار'}</strong><span class="muted">وضعیت</span></div></div><div style="margin:15px 0"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span>پیشرفت</span><strong>${Math.round(percent)}%</strong></div><div class="progress"><span style="width:${percent}%"></span></div><small class="muted">${next}</small></div><div class="admin-list">${data.appointments.map(a=>`<div class="admin-item"><div><strong>${a.serviceName}</strong><div class="muted">${a.date} · ${a.time}</div></div><span>${statusText[a.status]}</span></div>`).join('')}</div></div></div>`;
}
$('#customer-login-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);try{const data=await api('/customer/lookup',{method:'POST',body:JSON.stringify(Object.fromEntries(fd.entries()))});renderCustomerPortal(data);}catch(err){$('#customer-portal-content').innerHTML=`<p class="error">${err.message}</p>`;}};
$('#open-customer-portal').onclick=()=>openModal('#customer-portal-modal');
function adminCustomer(c){openModal('#customer-modal');$('#customer-view').innerHTML=`<div class="customer-profile"><div><img class="profile-photo" src="${c.avatar||'https://placehold.co/500x600?text=Client'}" alt="${c.name}"></div><div class="profile-main"><h4>${c.name}</h4><div class="muted">${c.phone} · ${c.sessions} جلسه انجام‌شده</div><div class="notes-box" style="margin-top:18px"><strong>یادداشت‌های درمانگر</strong><textarea id="customer-notes">${c.notes||''}</textarea><button class="btn btn-primary" id="save-notes" style="margin-top:10px">ذخیره یادداشت</button></div><div class="history"><h4>تاریخچه جلسات</h4>${(c.history||[]).map(h=>`<div class="history-item"><strong>${h[0]}</strong><span>${h[1]}</span><span class="muted">${h[2]}</span></div>`).join('')||'<p class="muted">هنوز سابقه‌ای ثبت نشده.</p>'}</div></div></div>`;$('#save-notes').onclick=async()=>{await api(`/admin/customers/${c.id}`,{method:'PATCH',body:JSON.stringify({notes:$('#customer-notes').value})});alert('یادداشت ذخیره شد.');};}
async function adminCustomerByPhone(phone){const data=await api('/admin/dashboard');adminCustomer(data.customers.find(c=>c.phone===phone));}

loadPublic().catch(err=>console.error(err)); setToday();
setInterval(()=>{ if(adminToken && $('#admin-drawer')?.classList.contains('open')) refreshAdmin('appointments'); },15000);
