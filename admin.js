/* ============================================================
   Clarity Journal — Admin panel
   Security model: this file only decides what to *show*. Every
   read and write goes through Supabase RPCs (schema.sql) that
   check the caller's role on the server, and every change is
   written to the audit log by database triggers.
   ============================================================ */
(function(){
'use strict';

/* ---------------- utilities ---------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const I = (name, cls) => window.icon(name, cls);
const DAY = 86400000;
const nf = new Intl.NumberFormat();
const num = (n) => nf.format(Math.round(+n || 0));
const pct = (n) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '') + '%';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const AVATAR_COLORS = ['#00D9A3','#7DD3FC','#8B7CFF','#FFB020','#F472B6','#FF8A5B','#A3E635'];
const displayName = (u) => (u && (u.username || (u.email ? u.email.split('@')[0] : ''))) || 'Unknown';
function initials(u){
  const n = displayName(u).replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/);
  return ((n[0] || '?')[0] + (n[1] ? n[1][0] : ((n[0] || '')[1] || ''))).toUpperCase();
}
function avatarColor(u){
  let h = 0; const s = (u && (u.id || u.email)) || '';
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const avatar = (u, size) => `<span class="avatar${size ? ' ' + size : ''}" style="background:${avatarColor(u)}" aria-hidden="true">${esc(initials(u))}</span>`;

/* dates honour Settings → General (timezone + format) */
let tz; let dateStyle = 'MMM D, YYYY';
function fmtDate(v){
  if(!v) return '—';
  const d = new Date(v); if(isNaN(d)) return '—';
  const o = { timeZone: tz };
  if(dateStyle === 'YYYY-MM-DD') return new Intl.DateTimeFormat('en-CA', { ...o, year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
  if(dateStyle === 'MM/DD/YYYY') return new Intl.DateTimeFormat('en-US', { ...o, year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
  if(dateStyle === 'D MMM YYYY') return new Intl.DateTimeFormat('en-GB', { ...o, year:'numeric', month:'short', day:'numeric' }).format(d);
  return new Intl.DateTimeFormat('en-US', { ...o, year:'numeric', month:'short', day:'numeric' }).format(d);
}
function fmtTime(v){ const d = new Date(v); return isNaN(d) ? '' : new Intl.DateTimeFormat(undefined, { timeZone: tz, hour:'numeric', minute:'2-digit' }).format(d); }
const fmtDateTime = (v) => v ? `${fmtDate(v)}, ${fmtTime(v)}` : '—';
function rel(v){
  if(!v) return 'Never';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if(s < 45) return 'Just now';
  if(s < 3600) return `${Math.round(s / 60)} min ago`;
  if(s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  if(d === 1) return 'Yesterday';
  if(d < 30) return `${d} days ago`;
  return fmtDate(v);
}
const relTip = (v) => v ? `<span data-tip="${esc(fmtDateTime(v))}">${esc(rel(v))}</span>` : '<span class="faint">Never</span>';
const shortDay = (iso) => new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', timeZone:'UTC' }).format(new Date(iso + 'T00:00:00Z'));

function device(ua){
  if(!ua) return '';
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}
const isMobileUA = (ua) => /iPhone|Android|Mobile/.test(ua || '');

/* ---------------- domain vocab ---------------- */
// DB keeps 'approved' (the main app checks it) — the panel calls it Active.
const uiStatus = (s) => s === 'approved' ? 'active' : s === 'disabled' ? 'suspended' : s;
const STATUS = {
  active:      { label:'Active',      db:'approved' },
  pending:     { label:'Pending',     db:'pending' },
  suspended:   { label:'Suspended',   db:'suspended' },
  deactivated: { label:'Deactivated', db:'deactivated' },
};
const statusPill = (s) => { const k = uiStatus(s); return `<span class="pill pill-${k}">${esc((STATUS[k] || {label:s}).label)}</span>`; };
const ROLES = {
  user:      { label:'User',      icon:'user',        desc:'Uses Clarity Journal. No access to this panel.' },
  moderator: { label:'Moderator', icon:'shield',      desc:'Can view users and do what Settings → Admin permissions allows.' },
  admin:     { label:'Admin',     icon:'shieldCheck', desc:'Full control, including roles, deletion and settings.' },
};
const roleBadge = (r) => `<span class="role role-${esc(r)}">${I((ROLES[r] || ROLES.user).icon)}${esc((ROLES[r] || {label:r}).label)}</span>`;

const EVENTS = {
  user_registered:     { label:'User registered',     icon:'userPlus',    tone:'sky' },
  user_approved:       { label:'User approved',       icon:'userCheck',   tone:'green' },
  user_rejected:       { label:'User rejected',       icon:'userX',       tone:'red' },
  user_activated:      { label:'User activated',      icon:'checkCircle', tone:'green' },
  user_suspended:      { label:'User suspended',      icon:'ban',         tone:'red' },
  user_deactivated:    { label:'User deactivated',    icon:'power',       tone:'gray' },
  user_deleted:        { label:'User deleted',        icon:'trash',       tone:'red' },
  role_changed:        { label:'Permissions changed', icon:'shield',      tone:'violet' },
  password_reset_sent: { label:'Password reset',      icon:'key',         tone:'amber' },
  sessions_revoked:    { label:'Sessions revoked',    icon:'logOut',      tone:'amber' },
  profile_updated:     { label:'Profile updated',     icon:'pencil',      tone:'sky' },
  settings_updated:    { label:'Settings updated',    icon:'sliders',     tone:'violet' },
  admin_signed_in:     { label:'Admin signed in',     icon:'logIn',       tone:'gray' },
  admin_signed_out:    { label:'Admin signed out',    icon:'logOut',      tone:'gray' },
  users_exported:      { label:'Users exported',      icon:'download',    tone:'gray' },
  status_changed:      { label:'Status changed',      icon:'refresh',     tone:'gray' },
  tab_access_changed:  { label:'Tab access changed',  icon:'tabs',        tone:'violet' },
  delete_access_changed:{ label:'Delete access changed', icon:'trash',     tone:'violet' },
};
const EVENT_GROUPS = [
  ['', 'All events'],
  ['user_registered', 'Registrations'],
  ['user_approved,user_rejected', 'Approvals & rejections'],
  ['user_suspended,user_deactivated,user_activated,status_changed', 'Status changes'],
  ['user_deleted', 'Deletions'],
  ['password_reset_sent,sessions_revoked', 'Passwords & sessions'],
  ['role_changed,profile_updated,tab_access_changed,delete_access_changed', 'Permissions & profile'],
  ['settings_updated', 'Settings'],
  ['admin_signed_in,admin_signed_out,users_exported', 'Admin access'],
];
const evMeta = (e) => EVENTS[e] || { label: e.replace(/_/g, ' '), icon:'info', tone:'gray' };
function describe(a){
  const t = `<b>${esc(a.target_label || 'a user')}</b>`;
  const who = `<b>${esc(a.actor_label || 'System')}</b>`;
  const d = a.detail || {};
  const reason = d.reason ? ` <span class="faint">· “${esc(d.reason)}”</span>` : '';
  switch(a.event){
    case 'user_registered':     return `${t} signed up`;
    case 'user_approved':       return `${who} approved ${t}`;
    case 'user_rejected':       return `${who} rejected ${t}${reason}`;
    case 'user_activated':      return `${who} reactivated ${t}`;
    case 'user_suspended':      return `${who} suspended ${t}${reason}`;
    case 'user_deactivated':    return `${who} deactivated ${t}${reason}`;
    case 'user_deleted':        return `${who} deleted ${t}`;
    case 'role_changed':        return `${who} changed ${t}'s role from ${esc((ROLES[d.from] || {label:d.from}).label)} to ${esc((ROLES[d.to] || {label:d.to}).label)}`;
    case 'password_reset_sent': return `${who} sent ${t} a password reset link`;
    case 'sessions_revoked':    return `${who} signed ${t} out of ${num(d.sessions || 0)} session${d.sessions === 1 ? '' : 's'}`;
    case 'profile_updated':     return `${who} changed ${t}'s ${esc(d.field || 'profile')}`;
    case 'settings_updated':    return `${who} updated <b>${esc(SECTION_TITLES[a.target_label] || a.target_label || '')}</b> settings`;
    case 'admin_signed_in':     return `${who} signed in to the admin panel`;
    case 'admin_signed_out':    return `${who} signed out`;
    case 'users_exported':      return `${who} exported ${num(d.count || 0)} users to CSV`;
    case 'tab_access_changed':  return `${who} turned ${esc(tabName(d.tab))} ${d.allowed ? 'on' : 'off'} for ${d.count ? `<b>${num(d.count)} users</b>` : t}`;
    case 'delete_access_changed': { const whom = d.count ? `<b>${num(d.count)} users</b>` : t, what = esc(d.perm || 'items');
      return d.allowed ? `${who} let ${whom} delete their ${what}` : `${who} stopped ${whom} deleting their ${what}`; }
    default:                    return `${who} · ${esc(evMeta(a.event).label)} · ${t}`;
  }
}
const SECTION_TITLES = { general:'General', registration:'User registration', maintenance:'Maintenance', authentication:'Authentication', email:'Email', security:'Security', permissions:'Admin permissions' };

/* ---------------- backends ---------------- */
function schemaMissing(e){
  const m = (e && (e.message || '')) + ' ' + (e && e.code || '');
  return /PGRST202|42883|Could not find the function|does not exist/i.test(m) && /admin_|function/i.test(m);
}
async function rpc(name, args){
  const { data, error } = await sb.rpc(name, args || {});
  if(error) throw error;
  return data;
}
const SupaBackend = {
  demo: false,
  async me(){
    const p = await getMyProfile();
    return p ? { id: p.id, email: p.email, username: p.username, role: p.role, status: p.status } : null;
  },
  perms:     () => rpc('admin_my_permissions'),
  overview:  () => rpc('admin_overview'),
  listUsers: () => rpc('admin_list_users'),
  userDetail:(id) => rpc('admin_user_detail', { p_id: id }),
  analytics: (days) => rpc('admin_analytics', { p_days: days }),
  async activity({ search = '', event = '', sinceDays = 0, page = 1, pageSize = 25 } = {}){
    let q = sb.from('audit_log').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if(event) q = q.in('event', event.split(','));
    if(sinceDays) q = q.gte('created_at', new Date(Date.now() - sinceDays * DAY).toISOString());
    const s = search.replace(/[%*,()"'\\]/g, ' ').trim();
    if(s) q = q.or(`target_label.ilike.*${s}*,actor_label.ilike.*${s}*,ip.ilike.*${s}*`);
    const { data, error, count } = await q;
    if(error) throw error;
    return { rows: data || [], total: count || 0 };
  },
  settings:      () => rpc('admin_get_settings'),
  setStatus:     (ids, status, reason) => rpc('admin_set_status_many', { p_ids: ids, p_status: status, p_reason: reason || null }),
  setRole:       (id, role) => rpc('admin_set_role', { p_id: id, p_role: role }),
  updateProfile: (id, username) => rpc('admin_update_profile', { p_id: id, p_username: username }),
  deleteUsers:   (ids) => rpc('admin_delete_users', { p_ids: ids }),
  revokeSessions:(id) => rpc('admin_revoke_sessions', { p_id: id }),
  async resetPassword(u){
    // Supabase emails the user a one-time link. The admin never sees or sets a password.
    const { error } = await sb.auth.resetPasswordForEmail(u.email, { redirectTo: location.origin + '/' });
    if(error) throw error;
    await rpc('admin_log_event', { p_event: 'password_reset_sent', p_target: u.id, p_detail: {} });
  },
  logEvent: (event, target, detail) => rpc('admin_log_event', { p_event: event, p_target: target || null, p_detail: detail || {} }),
  updateSettings: (key, value) => rpc('admin_update_settings', { p_key: key, p_value: value }),
  // site error reports (error-log.js → log_client_error); readable and deletable by admins only
  async errors(){
    const { data, error } = await sb.from('error_logs')
      .select('id, first_seen, last_seen, hits, user_id, kind, message, page, detail, browser')
      .order('last_seen', { ascending: false }).limit(500);
    if(error) throw error;
    return data || [];
  },
  async deleteError(id){ const { error } = await sb.from('error_logs').delete().eq('id', id); if(error) throw error; },
  // which app tabs each account has switched off (Tab Access)
  tabAccess: () => rpc('admin_tab_access'),
  setTabAccess: (ids, tab, allowed) => rpc('admin_set_tab_access', { p_ids: ids, p_tab: tab, p_allowed: allowed }),
  setDeleteAccess: (ids, perm, allowed) => rpc('admin_set_delete_access', { p_ids: ids, p_perm: perm, p_allowed: allowed }),
  // support tickets sent from the app's Support page (admins only); replies are signed "Clarity Journal Support"
  supportList:      () => rpc('admin_support_list'),
  supportOpenCount: () => rpc('admin_support_open_count'),
  supportTicket:    (id) => rpc('admin_support_ticket', { p_id: id }),
  supportReply:     (id, body) => rpc('admin_support_reply', { p_id: id, p_body: body }),
  supportSetStatus: (id, status) => rpc('admin_support_set_status', { p_id: id, p_status: status }),
  async clearErrors(){ const { error } = await sb.from('error_logs').delete().gt('id', 0); if(error) throw error; },
  async signOut(){
    try{ await rpc('admin_log_event', { p_event: 'admin_signed_out' }); }catch(e){}
    await signOutAndRedirect();
  },
};

let B = SupaBackend;
let me = null, perms = {}, settings = {};
const can = (p) => !!perms[p];

/* ---------------- cache ---------------- */
const cache = { users: null, usersAt: 0 };
async function getUsers(force){
  if(!force && cache.users && Date.now() - cache.usersAt < 30000) return cache.users;
  cache.users = await B.listUsers();
  cache.usersAt = Date.now();
  updateBadges();
  return cache.users;
}
function invalidate(){ cache.users = null; }
async function refreshAfterChange(){
  invalidate();
  try{ await getUsers(true); }catch(e){}
  rerender();
}

/* ---------------- toasts ---------------- */
function toast(type, title, desc){
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${I(type === 'success' ? 'checkCircle' : type === 'error' ? 'xCircle' : 'info')}
    <div class="t-body"><div class="t-title">${esc(title)}</div>${desc ? `<div class="t-desc">${esc(desc)}</div>` : ''}</div>
    <button class="t-close" aria-label="Dismiss">${I('x')}</button>`;
  host.appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 180); };
  el.querySelector('.t-close').onclick = close;
  setTimeout(close, type === 'error' ? 7000 : 4200);
  while(host.children.length > 4) host.firstChild.remove();
}
const errText = (e) => (e && (e.message || e.error_description)) || 'Something went wrong.';

/* ---------------- tooltips ---------------- */
let tipEl = null;
function showTip(target){
  const text = target.getAttribute('data-tip');
  if(!text) return;
  hideTip();
  tipEl = document.createElement('div');
  tipEl.className = 'tooltip'; tipEl.textContent = text; tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  const r = target.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
  let top = r.top - t.height - 8; if(top < 6) top = r.bottom + 8;
  let left = Math.min(Math.max(6, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 6);
  if(target.getAttribute('data-tip-side') === 'right'){ top = r.top + r.height / 2 - t.height / 2; left = r.right + 10; } // collapsed sidebar
  tipEl.style.top = top + 'px'; tipEl.style.left = left + 'px';
}
function hideTip(){ if(tipEl){ tipEl.remove(); tipEl = null; } }
document.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-tip]'); if(t) showTip(t); });
document.addEventListener('mouseout', (e) => { if(e.target.closest('[data-tip]')) hideTip(); });
document.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if(t && t.matches(':focus-visible')) showTip(t); });
document.addEventListener('focusout', hideTip);
addEventListener('scroll', hideTip, true);

/* ---------------- menus & popovers ---------------- */
let openLayer = null;
function closeLayer(){
  if(!openLayer) return;
  const { el, anchor, onClose } = openLayer;
  openLayer = null;
  el.remove();
  if(anchor){ anchor.setAttribute('aria-expanded', 'false'); }
  if(onClose) onClose();
}
function place(el, anchor, align){
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = align === 'left' ? r.left : r.right - w;
  left = Math.min(Math.max(8, left), innerWidth - w - 8);
  let top = r.bottom + 6;
  if(top + h > innerHeight - 8 && r.top - h - 6 > 8){ top = r.top - h - 6; el.style.transformOrigin = 'bottom right'; }
  el.style.left = left + 'px'; el.style.top = Math.max(8, top) + 'px';
}
function openMenu(anchor, items, opts = {}){
  if(openLayer && openLayer.anchor === anchor){ closeLayer(); return; }
  closeLayer();
  const el = document.createElement('div');
  el.className = 'menu'; el.setAttribute('role', 'menu');
  el.innerHTML = (opts.head || '') + items.filter(Boolean).map((it, i) => {
    if(it === 'sep') return '<div class="menu-sep" role="separator"></div>';
    if(it.label && it.header) return `<div class="menu-label">${esc(it.label)}</div>`;
    const tag = it.href ? 'a' : 'button';
    return `<${tag} class="menu-item${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}" ${it.href ? `href="${esc(it.href)}"` : ''} ${it.disabled ? 'disabled' : ''}
      ${it.tip ? `data-tip="${esc(it.tip)}"` : ''}>${I(it.icon || 'chevronRight')}<span>${esc(it.label)}</span>${it.hint ? `<span class="kbd-right">${esc(it.hint)}</span>` : ''}</${tag}>`;
  }).join('');
  $('#layer').appendChild(el);
  place(el, anchor, opts.align);
  anchor.setAttribute('aria-expanded', 'true');
  openLayer = { el, anchor };
  const list = items.filter(Boolean);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]'); if(!b || b.disabled) return;
    const it = list[+b.dataset.i];
    closeLayer();
    if(it && it.onClick){ e.preventDefault(); it.onClick(); }
  });
  el.addEventListener('keydown', (e) => {
    const btns = $$('.menu-item:not([disabled])', el);
    const idx = btns.indexOf(document.activeElement);
    if(e.key === 'ArrowDown'){ e.preventDefault(); (btns[idx + 1] || btns[0]).focus(); }
    if(e.key === 'ArrowUp'){ e.preventDefault(); (btns[idx - 1] || btns[btns.length - 1]).focus(); }
    if(e.key === 'Tab'){ closeLayer(); }
  });
  const first = $('.menu-item:not([disabled])', el); if(first && opts.focus !== false) first.focus({ preventScroll: true });
}
function openPopover(anchor, html, onMount){
  if(openLayer && openLayer.anchor === anchor){ closeLayer(); return; }
  closeLayer();
  const el = document.createElement('div');
  el.className = 'popover'; el.setAttribute('role', 'dialog');
  el.innerHTML = html;
  $('#layer').appendChild(el);
  place(el, anchor);
  anchor.setAttribute('aria-expanded', 'true');
  openLayer = { el, anchor };
  if(onMount) onMount(el);
  return el;
}
document.addEventListener('mousedown', (e) => {
  if(openLayer && !openLayer.el.contains(e.target) && !openLayer.anchor.contains(e.target)) closeLayer();
});
addEventListener('resize', closeLayer);

/* ---------------- modal ---------------- */
let modalStack = 0;
function modal({ icon, tone = 'gray', title, desc, body = '', confirmLabel = 'Confirm', confirmClass = 'btn-primary', cancelLabel = 'Cancel',
                 requireText, onConfirm, hideConfirm, wide }){
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'overlay';
    const tid = 'm' + Math.random().toString(36).slice(2, 8);
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${tid}" ${wide ? 'style="max-width:520px"' : ''}>
      <div class="modal-body">
        ${icon ? `<div class="modal-icon tone-${tone}">${I(icon)}</div>` : ''}
        <h2 id="${tid}">${esc(title)}</h2>
        ${desc ? `<p class="desc">${desc}</p>` : ''}
        ${body}
        ${requireText ? `<div class="field"><label for="${tid}-c">Type <b class="mono" style="color:var(--text)">${esc(requireText)}</b> to confirm</label>
          <input class="input" id="${tid}-c" autocomplete="off" spellcheck="false"></div>` : ''}
        <div class="field err-host" hidden><span class="err"></span></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-act="cancel">${esc(cancelLabel)}</button>
        ${hideConfirm ? '' : `<button class="btn ${confirmClass}" data-act="ok" ${requireText ? 'disabled' : ''}>${esc(confirmLabel)}</button>`}
      </div></div>`;
    document.body.appendChild(ov);
    modalStack++;
    closeLayer();
    const m = $('.modal', ov), ok = $('[data-act="ok"]', ov);
    const close = (val) => {
      ov.remove(); modalStack--;
      document.removeEventListener('keydown', onKey, true);
      if(prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      resolve(val);
    };
    const showErr = (msg) => { const h = $('.err-host', ov); h.hidden = !msg; $('.err', h).textContent = msg || ''; };
    if(requireText){
      const inp = $(`#${tid}-c`, ov);
      inp.addEventListener('input', () => { ok.disabled = inp.value.trim().toLowerCase() !== requireText.toLowerCase(); });
    }
    const submit = async () => {
      if(!ok || ok.disabled) return;
      showErr('');
      if(onConfirm){
        ok.classList.add('loading'); ok.disabled = true;
        try{
          const r = await onConfirm(m);
          if(r === false){ ok.classList.remove('loading'); ok.disabled = false; return; }
          close(r === undefined ? true : r);
        }catch(e){
          ok.classList.remove('loading'); ok.disabled = false;
          showErr(errText(e));
        }
      } else close(true);
    };
    const onKey = (e) => {
      if(!ov.isConnected) return;
      if(e.key === 'Escape'){ e.stopPropagation(); close(false); }
      if(e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON'){ e.preventDefault(); submit(); }
      if(e.key === 'Tab'){
        const f = $$('button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])', m);
        if(!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if(e.target === ov) close(false); });
    $('[data-act="cancel"]', ov).onclick = () => close(false);
    if(ok) ok.onclick = submit;
    const firstInput = $('input:not([type=radio]):not([type=checkbox]), textarea', m);
    (firstInput || $('[data-act="cancel"]', ov)).focus();
  });
}
const userCard = (u) => `<div class="modal-user">${avatar(u)}<div class="user-cell"><div class="meta"><div class="name">${esc(displayName(u))}</div><div class="sub">${esc(u.email || '')}</div></div></div><span style="margin-left:auto">${statusPill(u.status)}</span></div>`;
const reasonField = (placeholder) => `<div class="field"><label for="reasonInput">Reason <span class="faint">(optional, saved to the audit log)</span></label>
  <textarea class="input" id="reasonInput" maxlength="300" rows="2" placeholder="${esc(placeholder || '')}"></textarea></div>`;
const readReason = (m) => { const r = $('#reasonInput', m); return r ? r.value.trim() : ''; };

/* ---------------- user actions (shared by every page) ---------------- */
const isMe = (u) => me && u && u.id === me.id;
const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;

const Actions = {
  async approve(list){
    list = [].concat(list);
    const one = list.length === 1 ? list[0] : null;
    const ok = await modal({
      icon:'userCheck', tone:'green',
      title: one ? `Approve ${displayName(one)}?` : `Approve ${plural(list.length, 'user')}?`,
      desc: one ? 'They’ll be able to sign in and start journaling right away.' : 'Each of them will be able to sign in and start journaling right away.',
      body: one ? userCard(one) : '',
      confirmLabel: one ? 'Approve user' : `Approve ${list.length}`,
      onConfirm: () => B.setStatus(list.map(u => u.id), 'approved'),
    });
    if(ok){ toast('success', one ? `${displayName(one)} approved` : `${plural(list.length, 'user')} approved`, 'They can sign in now.'); refreshAfterChange(); }
    return ok;
  },
  async reject(list){
    list = [].concat(list);
    const one = list.length === 1 ? list[0] : null;
    const ok = await modal({
      icon:'userX', tone:'red',
      title: one ? `Reject ${displayName(one)}?` : `Reject ${plural(list.length, 'user')}?`,
      desc: 'Their account is deactivated and they won’t be able to sign in. You can reactivate it later if this was a mistake.',
      body: (one ? userCard(one) : '') + reasonField('e.g. Not on the invite list'),
      confirmLabel: 'Reject', confirmClass: 'btn-danger',
      onConfirm: (m) => B.setStatus(list.map(u => u.id), 'deactivated', readReason(m)),
    });
    if(ok){ toast('success', one ? `${displayName(one)} rejected` : `${plural(list.length, 'user')} rejected`); refreshAfterChange(); }
    return ok;
  },
  async activate(list){
    list = [].concat(list);
    const one = list.length === 1 ? list[0] : null;
    const ok = await modal({
      icon:'checkCircle', tone:'green',
      title: one ? `Activate ${displayName(one)}?` : `Activate ${plural(list.length, 'user')}?`,
      desc: 'Access is restored immediately. Their journal data was kept, so everything is where they left it.',
      body: one ? userCard(one) : '',
      confirmLabel: 'Activate',
      onConfirm: () => B.setStatus(list.map(u => u.id), 'approved'),
    });
    if(ok){ toast('success', one ? `${displayName(one)} is active again` : `${plural(list.length, 'user')} activated`); refreshAfterChange(); }
    return ok;
  },
  async suspend(list){
    list = [].concat(list);
    const one = list.length === 1 ? list[0] : null;
    const revoke = !settings.security || settings.security.revoke_sessions_on_suspend !== false;
    const ok = await modal({
      icon:'ban', tone:'red',
      title: one ? `Suspend ${displayName(one)}?` : `Suspend ${plural(list.length, 'user')}?`,
      desc: `They’ll lose access immediately${revoke ? ' and be signed out on every device' : ''}. Journal data is kept so you can lift the suspension later.`,
      body: (one ? userCard(one) : '') + reasonField('e.g. Shared login credentials'),
      confirmLabel: 'Suspend', confirmClass: 'btn-danger',
      onConfirm: (m) => B.setStatus(list.map(u => u.id), 'suspended', readReason(m)),
    });
    if(ok){ toast('success', one ? `${displayName(one)} suspended` : `${plural(list.length, 'user')} suspended`); refreshAfterChange(); }
    return ok;
  },
  async deactivate(list){
    list = [].concat(list);
    const one = list.length === 1 ? list[0] : null;
    const ok = await modal({
      icon:'power', tone:'amber',
      title: one ? `Deactivate ${displayName(one)}?` : `Deactivate ${plural(list.length, 'user')}?`,
      desc: 'Use this for accounts that are closed rather than in trouble. They can’t sign in, and their data is kept until you delete it.',
      body: (one ? userCard(one) : '') + reasonField('e.g. Requested account closure'),
      confirmLabel: 'Deactivate', confirmClass: 'btn-warn',
      onConfirm: (m) => B.setStatus(list.map(u => u.id), 'deactivated', readReason(m)),
    });
    if(ok){ toast('success', one ? `${displayName(one)} deactivated` : `${plural(list.length, 'user')} deactivated`); refreshAfterChange(); }
    return ok;
  },
  async remove(list, after){
    list = [].concat(list);
    const one = list.length === 1 ? list[0] : null;
    const trades = list.reduce((a, u) => a + (+u.trades || 0), 0);
    const ok = await modal({
      icon:'trash', tone:'red',
      title: one ? `Delete ${displayName(one)}?` : `Delete ${plural(list.length, 'user')}?`,
      desc: `This permanently deletes ${one ? 'their' : 'these'} login${one ? '' : 's'}, profile${one ? '' : 's'} and all journal data${trades ? ` (${plural(trades, 'trade')})` : ''}. <b style="color:var(--text)">This can’t be undone.</b>`,
      body: one ? userCard(one) : '',
      requireText: 'delete',
      confirmLabel: one ? 'Delete user' : `Delete ${list.length} users`, confirmClass: 'btn-danger',
      onConfirm: () => B.deleteUsers(list.map(u => u.id)),
    });
    if(ok){
      toast('success', one ? `${displayName(one)} deleted` : `${plural(list.length, 'user')} deleted`);
      invalidate();
      if(after) after(); else refreshAfterChange();
    }
    return ok;
  },
  async resetPassword(u){
    const ok = await modal({
      icon:'key', tone:'amber',
      title: 'Send a password reset link?',
      desc: `We’ll email <b style="color:var(--text)">${esc(u.email)}</b> a secure, single-use link to choose a new password. You never see or set their password.`,
      body: userCard(u),
      confirmLabel: 'Send reset link',
      onConfirm: () => B.resetPassword(u),
    });
    if(ok) toast('success', 'Reset link sent', `Sent to ${u.email}.`);
  },
  async changeRole(u){
    const opts = Object.entries(ROLES).map(([k, r]) => `<label class="radio-card"><input type="radio" name="role" value="${k}" ${u.role === k ? 'checked' : ''}>
      <div><b>${esc(r.label)}</b><span>${esc(r.desc)}</span></div></label>`).join('');
    const ok = await modal({
      icon:'shield', tone:'violet', title:`Change ${displayName(u)}’s role`,
      desc: 'Role changes apply the next time they load a page, and are recorded in the audit log.',
      body: `<div class="radio-list">${opts}</div><div class="notice notice-amber" id="adminWarn" hidden>${I('alert')}<span>Admins can delete users, change roles and edit every setting. Only grant this to people you fully trust.</span></div>`,
      confirmLabel: 'Save role',
      onConfirm: async (m) => {
        const role = ($('input[name=role]:checked', m) || {}).value;
        if(role === u.role) return true;
        await B.setRole(u.id, role);
        return role;
      },
    }).catch(() => false);
    if(ok && ok !== true){ toast('success', 'Role updated', `${displayName(u)} is now ${ROLES[ok].label === 'Admin' ? 'an' : 'a'} ${ROLES[ok].label}.`); refreshAfterChange(); }
  },
  async edit(u){
    const ok = await modal({
      icon:'pencil', tone:'sky', title:'Edit user',
      body: `<div class="field"><label for="unameInput">Username</label>
          <input class="input" id="unameInput" value="${esc(u.username || '')}" maxlength="20" autocomplete="off" spellcheck="false" pattern="[A-Za-z0-9_]{2,20}">
          <span class="hint">2–20 letters, numbers or underscores. Used to sign in.</span></div>
        <div class="field"><label>Email</label><input class="input" value="${esc(u.email || '')}" disabled>
          <span class="hint">Users change their own email from account settings, so it stays verified.</span></div>`,
      confirmLabel: 'Save changes',
      onConfirm: async (m) => {
        const v = $('#unameInput', m).value.trim();
        if(v && !/^[A-Za-z0-9_]{2,20}$/.test(v)) throw new Error('Usernames are 2–20 letters, numbers or underscores.');
        await B.updateProfile(u.id, v);
      },
    });
    if(ok){ toast('success', 'User updated'); refreshAfterChange(); }
  },
  async revokeSessions(u){
    const ok = await modal({
      icon:'logOut', tone:'amber', title:`Sign ${displayName(u)} out everywhere?`,
      desc: 'Ends every active session on all devices. They can sign straight back in if their account is active.',
      body: userCard(u), confirmLabel: 'Sign out everywhere', confirmClass: 'btn-warn',
      onConfirm: () => B.revokeSessions(u.id),
    });
    if(ok !== false){ toast('success', 'Signed out everywhere', `${plural(+ok || 0, 'session')} ended.`); refreshAfterChange(); }
  },
};

/* the contextual "…" menu for one user */
function userMenuItems(u, { fromDetail } = {}){
  const s = uiStatus(u.status);
  const self = isMe(u);
  const selfTip = self ? 'You can’t change your own account' : '';
  return [
    !fromDetail && { label:'View user', icon:'eye', onClick: () => go(`#/users/${u.id}`) },
    can('manage_users') && { label:'Edit user', icon:'pencil', onClick: () => Actions.edit(u) },
    'sep',
    s === 'pending' && can('approve_users') && { label:'Approve', icon:'userCheck', onClick: () => Actions.approve(u) },
    s === 'pending' && can('approve_users') && { label:'Reject', icon:'userX', onClick: () => Actions.reject(u) },
    (s === 'suspended' || s === 'deactivated') && can('manage_users') && { label:'Activate', icon:'checkCircle', onClick: () => Actions.activate(u), disabled: self },
    s === 'active' && can('manage_users') && { label:'Suspend', icon:'ban', onClick: () => Actions.suspend(u), disabled: self, tip: selfTip },
    (s === 'active' || s === 'suspended') && can('manage_users') && { label:'Deactivate', icon:'power', onClick: () => Actions.deactivate(u), disabled: self, tip: selfTip },
    can('manage_roles') && { label:'Change role', icon:'shield', onClick: () => Actions.changeRole(u), disabled: self, tip: selfTip },
    can('manage_users') && u.email && { label:'Reset password', icon:'key', onClick: () => Actions.resetPassword(u) },
    can('manage_users') && +u.active_sessions > 0 && { label:'Sign out everywhere', icon:'logOut', onClick: () => Actions.revokeSessions(u), disabled: self },
    can('delete_users') && 'sep',
    can('delete_users') && { label:'Delete user', icon:'trash', danger: true, onClick: () => Actions.remove(u, fromDetail ? () => go('#/users') : null), disabled: self, tip: selfTip },
  ].filter(Boolean).filter((it, i, arr) => it !== 'sep' || (i > 0 && arr[i - 1] !== 'sep' && i < arr.length - 1));
}

/* ---------------- shared bits ---------------- */
const sk = (w, h) => `<span class="sk" style="width:${w};${h ? `height:${h}px` : ''}"></span>`;
const emptyState = ({ icon = 'inbox', title, text, action, error, compact }) => `<div class="empty${error ? ' error' : ''}${compact ? ' compact' : ''}">
  <div class="empty-icon">${I(error ? 'alert' : icon)}</div><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action || ''}</div>`;
const errorState = (e, retry = 'retry') => emptyState({ error: true, title: 'Couldn’t load this', text: esc(errText(e)), action: `<button class="btn btn-sm" data-act="${retry}">${I('refresh')}Try again</button>` });

function delta(cur, prev, { invert } = {}){
  if(!prev && !cur) return `<span class="delta flat">—</span>`;
  if(!prev) return `<span class="delta up">${I('arrowUp')}New</span>`;
  const d = (cur - prev) / prev * 100;
  if(Math.abs(d) < 0.5) return `<span class="delta flat">0%</span>`;
  const up = d > 0;
  return `<span class="delta ${(up !== !!invert) ? 'up' : 'down'}">${I(up ? 'arrowUp' : 'arrowDown')}${pct(Math.abs(d))}</span>`;
}
function statCard({ label, value, icon, foot, attention, href }){
  return `<${href ? `a href="${href}"` : 'div'} class="card stat${attention ? ' attention' : ''}" ${href ? 'style="text-decoration:none"' : ''}>
    <div class="stat-top"><span class="stat-label">${esc(label)}</span><span class="stat-icon">${I(icon)}</span></div>
    <div class="stat-value">${value}</div><div class="stat-foot">${foot || ''}</div></${href ? 'a' : 'div'}>`;
}
const statSkeleton = () => `<div class="card stat"><div class="stat-top">${sk('55%')}<span class="sk" style="width:28px;height:28px;border-radius:7px"></span></div>${sk('40%', 24)}${sk('70%')}</div>`;
const feedRow = (a, { showTime = true } = {}) => { const m = evMeta(a.event);
  return `<div class="feed-row"><span class="feed-icon tone-${m.tone}">${I(m.icon)}</span><div class="feed-text">${describe(a)}</div>${showTime ? `<span class="feed-time">${relTip(a.created_at)}</span>` : ''}</div>`; };
const feedSkeleton = (n) => Array.from({length: n}, () => `<div class="feed-row"><span class="sk sk-circle" style="width:28px;height:28px"></span><div style="flex:1;display:flex;flex-direction:column;gap:6px;padding-top:3px">${sk('70%')}</div>${sk('48px')}</div>`).join('');

function statusBreakdown(c){
  const rows = [
    ['Active', c.active, '--c-green'], ['Pending', c.pending, '--c-amber'],
    ['Suspended', c.suspended, '--c-red'], ['Deactivated', c.deactivated, '--c-gray'],
  ];
  const total = rows.reduce((a, r) => a + r[1], 0) || 1;
  return `<div class="status-bar" role="img" aria-label="${rows.map(r => `${r[0]} ${r[1]}`).join(', ')}">${rows.filter(r => r[1]).map(r => `<div style="flex-grow:${r[1]};background:var(${r[2]})" data-tip="${r[0]}: ${num(r[1])}"></div>`).join('')}</div>
    <div class="status-legend">${rows.map(r => `<div class="row"><span class="sw" style="background:var(${r[2]})"></span>${r[0]}<b>${num(r[1])}</b><small>${pct(r[1] / total * 100)}</small></div>`).join('')}</div>`;
}

/* ---------------- shell ---------------- */
const NAV = [
  { id:'dashboard', label:'Dashboard',       icon:'dashboard', href:'#/dashboard' },
  { id:'users',     label:'Users',           icon:'users',     href:'#/users' },
  { id:'pending',   label:'Pending Users',   icon:'userClock', href:'#/pending', badge: true },
  { id:'support',   label:'Support',         icon:'inbox',     href:'#/support', admin: true },
  { id:'access',    label:'Tab Access',      icon:'tabs',      href:'#/access', perm:'manage_users' },
  { id:'activity',  label:'Activity',        icon:'activity',  href:'#/activity', perm:'view_activity' },
  { id:'analytics', label:'Analytics',       icon:'chart',     href:'#/analytics' },
  { id:'errors',    label:'Error Log',       icon:'alert',     href:'#/errors', admin: true },
  { id:'settings',  label:'System Settings', icon:'settings',  href:'#/settings' },
  { id:'app',       label:'Open Clarity Journal', icon:'external', href:'/' },
];
// pages a role can open: perm-gated ones need that permission, admin-only ones need the admin role
const allowed = (n) => (!n.perm || can(n.perm)) && (!n.admin || (me && me.role === 'admin'));
// the sidebar item a page belongs to (a user's profile → Users, a ticket → Support)
const navId = (id) => id === 'user' ? 'users' : id === 'ticket' ? 'support' : id;
/* collapsible sidebar (wide screens only; narrow screens use the slide-out menu) */
const wideScreen = matchMedia('(min-width:1025px)');
const isCollapsed = () => $('#app').classList.contains('collapsed') && wideScreen.matches;
const sideTip = (label) => isCollapsed() ? `data-tip="${esc(label)}" data-tip-side="right"` : '';
const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
function setCollapsed(on, save){
  $('#app').classList.toggle('collapsed', on);
  const b = $('#collapseBtn'), label = on ? 'Expand sidebar' : 'Collapse sidebar';
  b.setAttribute('aria-expanded', String(!on));
  b.setAttribute('aria-label', label);
  b.dataset.tip = `${label} (${modKey} B)`;
  b.dataset.tipSide = 'right';
  // the icon-only items get their names back as tooltips
  [['#meBtn', 'Account'], ['#signOutBtn', 'Sign out']].forEach(([sel, l]) => {
    const el = $(sel);
    if(isCollapsed()){ el.dataset.tip = l; el.dataset.tipSide = 'right'; }
    else { delete el.dataset.tip; delete el.dataset.tipSide; }
  });
  if(save) localStorageSet('cj-admin-sidebar', on ? 'collapsed' : '');
  hideTip();
  if(currentRoute.id) renderNav(navId(currentRoute.id));
}
const toggleSidebar = () => setCollapsed(!$('#app').classList.contains('collapsed'), true);

function renderNav(active){
  const pending = cache.users ? cache.users.filter(u => u.status === 'pending').length : 0;
  const waiting = cache.supportOpen || 0; // tickets waiting for a reply
  const badge = (n) => n.badge && pending ? `<span class="nav-badge" aria-label="${pending} pending">${pending}</span>`
    : n.id === 'support' && waiting ? `<span class="nav-badge" aria-label="${waiting} waiting for a reply">${waiting}</span>` : '';
  $('#nav').innerHTML = NAV.filter(allowed).map(n => `<a class="nav-item${active === n.id ? ' active' : ''}" href="${n.href}" ${active === n.id ? 'aria-current="page"' : ''} ${sideTip(n.label)}>
    ${I(n.icon)}<span>${n.label}</span>${badge(n)}</a>`).join('');
}
async function refreshSupportCount(){
  if(!me || me.role !== 'admin' || !B.supportOpenCount) return;
  try{ cache.supportOpen = await B.supportOpenCount(); renderNav(navId(currentRoute.id)); }catch(e){}
}
function updateBadges(){
  renderNav(navId(currentRoute.id));
  const pending = cache.users ? cache.users.filter(u => u.status === 'pending').length : 0;
  const lastSeen = +localStorageGet('cj-admin-notif-seen') || 0;
  const newest = cache.users ? Math.max(0, ...cache.users.filter(u => u.status === 'pending').map(u => Date.parse(u.created_at))) : 0;
  $('#notifDot').hidden = !(pending && newest > lastSeen);
}
function localStorageGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function localStorageSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

function setCrumbs(parts){
  $('#crumbs').innerHTML = parts.map((p, i) => i < parts.length - 1
    ? `<a href="${p.href}">${esc(p.label)}</a>${I('chevronRight')}` : `<span class="cur">${esc(p.label)}</span>`).join('');
}

function accountMenu(anchor){
  openMenu(anchor, [
    { label:'My profile', icon:'user', onClick: () => go(`#/users/${me.id}`) },
    can('manage_settings') && { label:'System settings', icon:'settings', onClick: () => go('#/settings') },
    { label:'Open Clarity Journal', icon:'external', href:'/' },
    'sep',
    { label:'Sign out', icon:'logOut', danger: true, onClick: signOut },
  ], { head: `<div class="menu-head">${avatar(me)}<div style="min-width:0"><div style="font-weight:600;font-size:13px">${esc(displayName(me))}</div><div class="faint" style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${esc(me.email || '')}</div></div></div>`,
       align: anchor.id === 'meBtn' ? 'left' : 'right' });
}
async function signOut(){
  const ok = await modal({ icon:'logOut', title:'Sign out of the admin panel?', confirmLabel:'Sign out' });
  if(ok) B.signOut();
}

async function openNotifications(anchor){
  localStorageSet('cj-admin-notif-seen', String(Date.now()));
  $('#notifDot').hidden = true;
  const el = openPopover(anchor, `<div class="popover-head"><h3>Notifications</h3><a class="link-btn" href="#/activity">View all ${I('arrowUpRight')}</a></div>
    <div class="popover-body" id="notifBody">${feedSkeleton(4)}</div>`);
  if(!el) return;
  const body = $('#notifBody', el);
  try{
    const users = await getUsers();
    const pending = users.filter(u => u.status === 'pending').sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    let html = pending.slice(0, 5).map(u => `<a class="notif-row unread" href="#/users/${u.id}">${avatar(u, 'sm')}
      <div class="feed-text"><b>${esc(displayName(u))}</b> is waiting for approval<div class="faint" style="font-size:12px">${esc(rel(u.created_at))}</div></div></a>`).join('');
    if(can('view_activity')){
      const { rows } = await B.activity({ pageSize: 8, event: 'user_registered,user_approved,user_rejected,user_suspended,user_deleted,role_changed,settings_updated' });
      html += rows.map(a => { const m = evMeta(a.event);
        return `<div class="notif-row"><span class="feed-icon tone-${m.tone}">${I(m.icon)}</span><div class="feed-text">${describe(a)}<div class="faint" style="font-size:12px">${esc(rel(a.created_at))}</div></div></div>`; }).join('');
    }
    body.innerHTML = html || emptyState({ icon:'bell', title:'You’re all caught up', text:'New sign-ups and important changes show up here.', compact: true });
  }catch(e){ body.innerHTML = emptyState({ error: true, title:'Couldn’t load notifications', text: esc(errText(e)), compact: true }); }
  body.addEventListener('click', (e) => { if(e.target.closest('a')) closeLayer(); });
}

/* command palette */
async function openPalette(){
  if($('.palette')) return;
  closeLayer();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Search">
    <div class="palette-input">${I('search')}<input id="palIn" placeholder="Search users by name or email, or jump to a page…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palList"><kbd>Esc</kbd></div>
    <div class="palette-list" id="palList" role="listbox"></div>
    <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div></div>`;
  document.body.appendChild(ov);
  const prevFocus = document.activeElement;
  const input = $('#palIn', ov), list = $('#palList', ov);
  let items = [], sel = 0, users = cache.users || [];
  const close = () => { ov.remove(); if(prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const pages = NAV.filter(allowed).filter(n => !q || n.label.toLowerCase().includes(q))
      .map(n => ({ group:'Pages', icon:n.icon, label:n.label, href:n.href }));
    const us = users.filter(u => !q || (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      .slice(0, q ? 8 : 5).map(u => ({ group: q ? 'Users' : 'Recent sign-ups', user:u, label:displayName(u), hint:u.email, href:`#/users/${u.id}` }));
    items = [...us, ...pages];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let g = '';
    list.innerHTML = items.length ? items.map((it, i) => {
      const head = it.group !== g ? `<div class="palette-group">${esc(g = it.group)}</div>` : '';
      return head + `<button class="palette-item${i === sel ? ' on' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">
        ${it.user ? avatar(it.user, 'sm') : I(it.icon)}<span>${esc(it.label)}</span>${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}${it.user ? `<span style="margin-left:${it.hint ? '10px' : 'auto'}">${statusPill(it.user.status)}</span>` : ''}</button>`;
    }).join('') : emptyState({ icon:'search', title:'No results', text:`Nothing matches “${esc(input.value)}”.`, compact: true });
    const on = $('.palette-item.on', list); if(on) on.scrollIntoView({ block:'nearest' });
  };
  const choose = (i) => { const it = items[i]; if(!it) return; close(); go(it.href); };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if(e.key === 'ArrowDown'){ e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    if(e.key === 'ArrowUp'){ e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    if(e.key === 'Enter'){ e.preventDefault(); choose(sel); }
    if(e.key === 'Escape'){ e.preventDefault(); close(); }
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if(b) choose(+b.dataset.i); });
  ov.addEventListener('mousedown', (e) => { if(e.target === ov) close(); });
  draw(); input.focus();
  if(!cache.users){ try{ users = await getUsers(); if(ov.isConnected) draw(); }catch(e){} }
}

/* idle sign-out (Settings → Authentication) */
function startIdleTimer(){
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  ['pointerdown', 'keydown', 'scroll', 'pointermove'].forEach(ev => addEventListener(ev, bump, { passive: true, capture: true }));
  setInterval(() => {
    const mins = +perms.idle_timeout_min || 30;
    if(Date.now() - last > mins * 60000){
      toast('info', 'Signed out for inactivity', `No activity for ${mins} minutes.`);
      setTimeout(() => B.signOut(), 1200);
      last = Infinity;
    }
  }, 20000);
}

/* ---------------- router ---------------- */
const ROUTES = [
  { id:'dashboard', re:/^#?\/?(dashboard)?$/,     view: viewDashboard },
  { id:'users',     re:/^#\/users$/,              view: viewUsers },
  { id:'user',      re:/^#\/users\/([\w-]{8,})$/, view: viewUser },
  { id:'pending',   re:/^#\/pending$/,            view: viewPending },
  { id:'access',    re:/^#\/access$/,             view: viewAccess, perm:'manage_users' },
  { id:'activity',  re:/^#\/activity$/,           view: viewActivity, perm:'view_activity' },
  { id:'analytics', re:/^#\/analytics$/,          view: viewAnalytics },
  { id:'support',   re:/^#\/support$/,            view: viewSupport, admin: true },
  { id:'ticket',    re:/^#\/support\/(\d+)$/,     view: viewTicket, admin: true },
  { id:'errors',    re:/^#\/errors$/,             view: viewErrors, admin: true },
  { id:'settings',  re:/^#\/settings$/,           view: viewSettings },
];
let currentRoute = { id:'' }, renderToken = 0, dirtyGuard = null;
const go = (hash) => {
  if(!hash.startsWith('#')){ location.href = hash; return; } // a real page, like the app itself
  if(location.hash === hash) rerender(); else location.hash = hash;
};
async function route(){
  if(dirtyGuard && !dirtyGuard()){ history.replaceState(null, '', currentRoute.hash); return; }
  dirtyGuard = null;
  closeLayer(); hideTip();
  $('#app').classList.remove('nav-open');
  const hash = location.hash || '#/dashboard';
  let match = null, r = ROUTES[0];
  for(const x of ROUTES){ match = hash.match(x.re); if(match){ r = x; break; } }
  if(!match){ location.replace('#/dashboard'); return; }
  const scrollTop = currentRoute.hash !== hash;
  currentRoute = { id: r.id, hash, params: match.slice(1) };
  renderNav(navId(r.id));
  const view = $('#view');
  const token = ++renderToken;
  if(!allowed(r)){
    setCrumbs([{ label:'Restricted' }]);
    view.innerHTML = `<div class="page">${emptyState({ icon:'lock', title:'You don’t have access to this page', text: r.admin ? 'Only admins can open this page.' : 'Ask an admin to grant your role this permission in System Settings.', action:`<a class="btn btn-sm" href="#/dashboard">Back to dashboard</a>` })}</div>`;
    return;
  }
  if(scrollTop) window.scrollTo(0, 0);
  try{ await r.view(view, currentRoute.params, () => token === renderToken); }
  catch(e){
    if(token !== renderToken) return;
    console.error(e);
    view.innerHTML = `<div class="page">${errorState(e)}</div>`;
    const b = $('[data-act="retry"]', view); if(b) b.onclick = rerender;
  }
}
const rerender = () => { currentRoute.hash = null; route(); };

/* ================================================================
   Pages
   ================================================================ */

/* ---------- Dashboard ---------- */
async function viewDashboard(view, _, alive){
  setCrumbs([{ label:'Dashboard' }]);
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Admin Dashboard</h1><p>Manage your ${esc((settings.general && settings.general.platform_name) || 'Clarity Journal')} platform.</p></div>
      <div class="page-actions" id="dashActions"></div></div>
    <div class="grid grid-stats" id="stats">${Array.from({length: 6}, statSkeleton).join('')}</div>
    <div class="grid grid-2">
      <div class="card"><div class="card-head"><div><h2>New users</h2><p>Sign-ups over the last 30 days</p></div><a class="link-btn" href="#/analytics">Analytics ${I('arrowUpRight')}</a></div>
        <div class="card-body"><div id="signupKpi" class="chart-kpi">${sk('80px', 22)}</div><div class="chart" id="signupChart"><span class="sk" style="height:100%;width:100%;border-radius:8px;opacity:.5"></span></div></div></div>
      <div class="card"><div class="card-head"><div><h2>Pending approvals</h2><p id="pendingSub">Waiting for review</p></div><a class="link-btn" href="#/pending">View all ${I('arrowUpRight')}</a></div>
        <div class="card-body" style="padding:8px 0 4px"><div id="pendingMini">${feedSkeleton(4)}</div></div></div>
    </div>
    <div class="grid grid-2 mt">
      <div class="card"><div class="card-head"><div><h2>Recent activity</h2><p>Important platform events</p></div>${can('view_activity') ? `<a class="link-btn" href="#/activity">View log ${I('arrowUpRight')}</a>` : ''}</div>
        <div class="card-body" style="padding:8px 0 4px" id="recent">${feedSkeleton(6)}</div></div>
      <div class="card"><div class="card-head"><div><h2>Account status</h2><p>Every account by current status</p></div></div>
        <div class="card-body" id="statusMini">${sk('100%', 10)}<div style="height:16px"></div>${sk('80%')}<div style="height:10px"></div>${sk('60%')}</div>
        <div class="card-head" style="border-top:1px solid var(--border);padding-top:14px"><div><h2>Recently joined</h2></div><a class="link-btn" href="#/users">All users ${I('arrowUpRight')}</a></div>
        <div class="card-body" style="padding:8px 0 4px" id="joined">${feedSkeleton(3)}</div></div>
    </div></div>`;

  const [ov, users, an, act] = await Promise.allSettled([
    B.overview(), getUsers(true), B.analytics(30),
    can('view_activity') ? B.activity({ pageSize: 7, event: 'user_registered,user_approved,user_rejected,user_suspended,user_deactivated,user_activated,user_deleted,role_changed,password_reset_sent,sessions_revoked,settings_updated' }) : Promise.resolve(null),
  ]);
  if(!alive()) return;

  if(ov.status === 'fulfilled'){
    const o = ov.value;
    const totalPrev = +o.total_30d_ago;
    $('#stats').innerHTML = [
      statCard({ label:'Total Users', value: num(o.total), icon:'users', href:'#/users', foot: `${delta(+o.total, totalPrev)}<span>vs 30 days ago</span>` }),
      statCard({ label:'Active Users', value: num(o.active), icon:'userCheck', foot: `<span>${o.total ? pct(o.active / o.total * 100) : '0%'} of all accounts</span>` }),
      statCard({ label:'Pending Users', value: num(o.pending), icon:'userClock', attention: +o.pending > 0, href:'#/pending', foot: +o.pending ? '<span style="color:var(--amber)">Awaiting your review</span>' : '<span>All caught up</span>' }),
      statCard({ label:'Suspended Users', value: num(o.suspended), icon:'ban', foot: `<span>${num(o.deactivated)} deactivated</span>` }),
      statCard({ label:'Total Trades Logged', value: num(o.trades), icon:'trendUp', foot: `${delta(+o.trades_7d, +o.trades_prev_7d)}<span>trades this week</span>` }),
      statCard({ label:'Active Sessions', value: num(o.sessions), icon:'monitor', foot: `<span>${plural(+o.sessions_users, 'user')} in the last 24 h</span>` }),
    ].join('');
    $('#dashActions').innerHTML = +o.pending && can('approve_users') ? `<a class="btn btn-warn" href="#/pending">${I('userClock')}Review ${plural(+o.pending, 'pending user')}</a>` : '';
  } else $('#stats').innerHTML = `<div class="card" style="grid-column:1/-1">${errorState(ov.reason)}</div>`;

  if(users.status === 'fulfilled'){
    const pend = users.value.filter(u => u.status === 'pending').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    $('#pendingSub').textContent = pend.length ? `${num(pend.length)} ${pend.length === 1 ? 'person' : 'people'} waiting, oldest first` : 'Waiting for review';
    $('#pendingMini').innerHTML = pend.length ? `<ul class="list">${pend.slice(0, 5).map(u => `<li class="list-row">
        <a href="#/users/${u.id}" class="user-cell grow" style="text-decoration:none">${avatar(u, 'sm')}<div class="meta"><div class="name">${esc(displayName(u))}</div><div class="sub">${esc(u.email)} · ${esc(rel(u.created_at))}</div></div></a>
        ${can('approve_users') ? `<button class="btn btn-sm btn-icon btn-ghost" data-reject="${u.id}" data-tip="Reject" aria-label="Reject ${esc(displayName(u))}">${I('x')}</button>
        <button class="btn btn-sm" data-approve="${u.id}">${I('check')}Approve</button>` : ''}</li>`).join('')}</ul>`
      : emptyState({ icon:'checkCircle', title:'All caught up', text:'No one is waiting for approval.', compact: true });
    $('#pendingMini').onclick = (e) => {
      const a = e.target.closest('[data-approve]'), r = e.target.closest('[data-reject]');
      const u = a ? pend.find(x => x.id === a.dataset.approve) : r ? pend.find(x => x.id === r.dataset.reject) : null;
      if(u) (a ? Actions.approve : Actions.reject)(u);
    };
    const recent = users.value.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 4);
    $('#joined').innerHTML = recent.length ? `<ul class="list">${recent.map(u => `<li class="list-row">
        <a href="#/users/${u.id}" class="user-cell grow" style="text-decoration:none">${avatar(u, 'sm')}<div class="meta"><div class="name">${esc(displayName(u))}</div><div class="sub">${esc(rel(u.created_at))}</div></div></a>
        ${statusPill(u.status)}</li>`).join('')}</ul>` : emptyState({ icon:'users', title:'No users yet', compact: true });
  } else { $('#pendingMini').innerHTML = errorState(users.reason); $('#joined').innerHTML = ''; }

  if(an.status === 'fulfilled'){
    const s = an.value.series || [];
    const total = s.reduce((a, d) => a + d.signups, 0);
    $('#signupKpi').innerHTML = `<span class="v">${num(total)}</span><span class="l">new users in 30 days</span>`;
    Charts.render($('#signupChart'), { type:'bar', data:s, x:'day', series:[{ key:'signups', label:'Sign-ups', color:'--c-green' }],
      xFormat: shortDay, tipTitle: d => shortDay(d.day), label:'New users per day, last 30 days' });
    $('#statusMini').innerHTML = statusBreakdown(an.value.status);
  } else { $('#signupChart').innerHTML = errorState(an.reason); $('#signupKpi').innerHTML = ''; $('#statusMini').innerHTML = errorState(an.reason); }

  if(!can('view_activity')) $('#recent').innerHTML = emptyState({ icon:'lock', title:'Activity is restricted', text:'Your role can’t view the audit log.', compact: true });
  else if(act.status === 'fulfilled') $('#recent').innerHTML = act.value.rows.length ? act.value.rows.map(a => feedRow(a)).join('')
    : emptyState({ icon:'activity', title:'No activity yet', text:'Sign-ups, approvals and admin changes will appear here.', compact: true });
  else $('#recent').innerHTML = errorState(act.reason);

  $$('[data-act="retry"]', view).forEach(b => b.onclick = rerender);
}

/* ---------- Users ---------- */
const usersState = { q:'', status:'all', role:'all', sort:'joined', dir:'desc', page:1, size:25, selected:new Set() };
const SORTS = {
  joined:  (u) => Date.parse(u.created_at) || 0,
  active:  (u) => Date.parse(u.last_active_at) || 0,
  trades:  (u) => +u.trades || 0,
  name:    (u) => displayName(u).toLowerCase(),
};
async function viewUsers(view, _, alive){
  setCrumbs([{ label:'Users' }]);
  const S = usersState;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Users</h1><p>Search, filter and manage every Clarity Journal account.</p></div>
      <div class="page-actions"><button class="btn" id="exportBtn">${I('download')}Export CSV</button>
      ${can('approve_users') ? `<a class="btn" href="#/pending">${I('userClock')}Pending</a>` : ''}</div></div>
    <div class="card">
      <div class="toolbar">
        <label class="search-field">${I('search')}<input class="input" id="uq" type="search" placeholder="Search name, username or email" value="${esc(S.q)}" aria-label="Search users"></label>
        <div class="seg" id="statusSeg" role="tablist" aria-label="Filter by status"></div>
        <span class="spacer"></span>
        <select class="select" id="roleSel" aria-label="Filter by role">
          <option value="all">All roles</option>${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${S.role === k ? 'selected' : ''}>${r.label}s</option>`).join('')}
        </select>
        <select class="select" id="sortSel" aria-label="Sort">
          ${[['joined:desc','Newest first'],['joined:asc','Oldest first'],['active:desc','Recently active'],['trades:desc','Most trades'],['name:asc','Name A–Z']]
            .map(([v, l]) => `<option value="${v}" ${`${S.sort}:${S.dir}` === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div id="bulk"></div>
      <div id="tbl"><div class="table-wrap"><table class="tbl"><tbody>${Array.from({length: 8}, () => `<tr><td style="width:40px">${sk('16px', 16)}</td><td><div class="user-cell"><span class="sk sk-circle" style="width:32px;height:32px"></span><div style="display:flex;flex-direction:column;gap:6px;flex:1">${sk('120px')}${sk('80px', 10)}</div></div></td><td>${sk('160px')}</td><td>${sk('64px', 20)}</td><td>${sk('60px')}</td><td>${sk('90px')}</td><td>${sk('40px')}</td></tr>`).join('')}</tbody></table></div></div>
    </div></div>`;

  let users;
  try{ users = await getUsers(); }
  catch(e){ if(alive()){ $('#tbl').innerHTML = errorState(e); $('[data-act="retry"]', view).onclick = () => { invalidate(); rerender(); }; } return; }
  if(!alive()) return;
  // forget selections for users that no longer exist
  const ids = new Set(users.map(u => u.id));
  S.selected.forEach(id => { if(!ids.has(id)) S.selected.delete(id); });

  const filtered = () => {
    const q = S.q.trim().toLowerCase();
    const list = users.filter(u =>
      (S.status === 'all' || uiStatus(u.status) === S.status) &&
      (S.role === 'all' || u.role === S.role) &&
      (!q || (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || u.id === q));
    const f = SORTS[S.sort] || SORTS.joined, m = S.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => { const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * m; });
  };

  const drawSeg = () => {
    const c = { all: users.length }; users.forEach(u => { const k = uiStatus(u.status); c[k] = (c[k] || 0) + 1; });
    $('#statusSeg').innerHTML = [['all','All'], ...Object.entries(STATUS).map(([k, s]) => [k, s.label])].map(([k, l]) =>
      `<button role="tab" aria-selected="${S.status === k}" class="${S.status === k ? 'on' : ''}" data-st="${k}">${l}<span class="count">${c[k] || 0}</span></button>`).join('');
  };

  const draw = () => {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / S.size));
    S.page = Math.min(S.page, pages);
    const rows = list.slice((S.page - 1) * S.size, S.page * S.size);
    const selectable = rows.filter(u => !isMe(u));
    const allOn = selectable.length && selectable.every(u => S.selected.has(u.id));
    const someOn = selectable.some(u => S.selected.has(u.id));
    const th = (key, label, cls) => {
      const on = S.sort === key;
      return `<th class="sortable ${cls || ''}" data-sort="${key}" aria-sort="${on ? (S.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort">${on ? I(S.dir === 'asc' ? 'arrowUp' : 'arrowDown') : ''}</span></th>`;
    };
    if(!list.length){
      $('#tbl').innerHTML = emptyState(S.q || S.status !== 'all' || S.role !== 'all'
        ? { icon:'search', title:'No users match these filters', text:'Try a different search or clear the filters.', action:`<button class="btn btn-sm" data-act="clear">Clear filters</button>` }
        : { icon:'users', title:'No users yet', text:'When people sign up they’ll appear here.' });
      const c = $('[data-act="clear"]', view); if(c) c.onclick = () => { Object.assign(S, { q:'', status:'all', role:'all', page:1 }); $('#uq').value = ''; $('#roleSel').value = 'all'; drawSeg(); draw(); };
      drawBulk(); return;
    }
    $('#tbl').innerHTML = `<div class="table-wrap"><table class="tbl responsive">
      <thead><tr>
        <th class="c-check"><input type="checkbox" class="cb" id="allCb" aria-label="Select all on this page" ${allOn ? 'checked' : ''}></th>
        ${th('name', 'User')}<th class="hide-xl">Email</th><th>Status</th><th class="hide-md">Role</th>${th('joined', 'Joined')}${th('active', 'Last active', 'hide-md')}${th('trades', 'Trades', 'right')}<th class="c-actions"><span class="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>${rows.map(u => {
        const self = isMe(u), on = S.selected.has(u.id);
        return `<tr class="clickable${on ? ' selected' : ''}" data-id="${u.id}">
          <td class="c-check">${self ? `<span data-tip="That’s you" style="display:inline-flex"><input type="checkbox" class="cb" disabled aria-label="Your account"></span>` : `<input type="checkbox" class="cb" data-sel="${u.id}" ${on ? 'checked' : ''} aria-label="Select ${esc(displayName(u))}">`}</td>
          <td class="c-main"><div class="user-cell">${avatar(u)}<div class="meta"><div class="name">${esc(displayName(u))}${self ? '<span class="tag tag-you">You</span>' : ''}</div><div class="sub"><span class="on-wide">${u.username ? '@' + esc(u.username) : esc(u.email)}</span><span class="on-narrow">${esc(u.email || '')}</span></div></div></div></td>
          <td class="hide-xl m-hide muted" data-label="Email">${esc(u.email || '—')}</td>
          <td data-label="Status">${statusPill(u.status)}</td>
          <td class="hide-md${u.role === 'user' ? ' m-hide' : ''}" data-label="Role">${roleBadge(u.role)}</td>
          <td data-label="Joined"><span data-tip="${esc(fmtDateTime(u.created_at))}">${esc(fmtDate(u.created_at))}</span></td>
          <td class="hide-md muted" data-label="Last active">${relTip(u.last_active_at)}</td>
          <td class="right num" data-label="Trades">${num(u.trades)}</td>
          <td class="c-actions"><button class="btn btn-ghost btn-sm btn-icon" data-menu="${u.id}" aria-label="Actions for ${esc(displayName(u))}" aria-haspopup="menu">${I('more')}</button></td>
        </tr>`; }).join('')}</tbody></table></div>
      <div class="pager"><span>${num((S.page - 1) * S.size + 1)}–${num(Math.min(S.page * S.size, list.length))} of ${num(list.length)}</span>
        <div class="ctrl"><label class="faint" for="sizeSel">Rows</label><select class="select" id="sizeSel">${[10, 25, 50, 100].map(n => `<option ${S.size === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span>Page ${S.page} of ${pages}</span>
        <button class="btn btn-sm btn-icon" data-pg="-1" ${S.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${I('chevronLeft')}</button>
        <button class="btn btn-sm btn-icon" data-pg="1" ${S.page >= pages ? 'disabled' : ''} aria-label="Next page">${I('chevronRight')}</button></div></div>`;
    const all = $('#allCb'); if(all) all.indeterminate = !allOn && someOn;
    drawBulk();
  };

  const drawBulk = () => {
    const sel = users.filter(u => S.selected.has(u.id));
    if(!sel.length){ $('#bulk').innerHTML = ''; return; }
    const st = (k) => sel.filter(u => uiStatus(u.status) === k);
    const b = (act, icon, label, n, cls) => n ? `<button class="btn btn-sm ${cls || ''}" data-bulk="${act}">${I(icon)}${label}${n !== sel.length ? ` <span class="faint">(${n})</span>` : ''}</button>` : '';
    $('#bulk').innerHTML = `<div class="bulkbar" role="toolbar" aria-label="Bulk actions"><span class="count">${num(sel.length)} selected</span>
      ${can('approve_users') ? b('approve', 'userCheck', 'Approve', st('pending').length) : ''}
      ${can('manage_users') ? b('activate', 'checkCircle', 'Activate', st('suspended').length + st('deactivated').length) : ''}
      ${can('manage_users') ? b('suspend', 'ban', 'Suspend', st('active').length) : ''}
      ${can('manage_users') ? b('deactivate', 'power', 'Deactivate', st('active').length + st('suspended').length) : ''}
      ${can('delete_users') ? b('delete', 'trash', 'Delete', sel.length, 'btn-danger') : ''}
      <span class="spacer" style="flex:1"></span><button class="btn btn-sm btn-ghost" data-bulk="clear">Clear selection</button></div>`;
  };

  drawSeg(); draw();

  $('#uq').addEventListener('input', debounce((e) => { S.q = e.target.value; S.page = 1; draw(); }, 120));
  $('#statusSeg').onclick = (e) => { const b = e.target.closest('[data-st]'); if(!b) return; S.status = b.dataset.st; S.page = 1; drawSeg(); draw(); };
  $('#roleSel').onchange = (e) => { S.role = e.target.value; S.page = 1; draw(); };
  $('#sortSel').onchange = (e) => { [S.sort, S.dir] = e.target.value.split(':'); draw(); };
  $('#exportBtn').onclick = () => exportCsv(filtered());

  $('#tbl').addEventListener('click', (e) => {
    const t = e.target;
    if(t.closest('[data-menu]')){
      const btn = t.closest('[data-menu]'); const u = users.find(x => x.id === btn.dataset.menu);
      openMenu(btn, userMenuItems(u)); return;
    }
    if(t.closest('[data-sort]')){
      const k = t.closest('[data-sort]').dataset.sort;
      if(S.sort === k) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = k; S.dir = k === 'name' ? 'asc' : 'desc'; }
      $('#sortSel').value = `${S.sort}:${S.dir}`; draw(); return;
    }
    if(t.closest('[data-pg]')){ S.page += +t.closest('[data-pg]').dataset.pg; draw(); $('#tbl').scrollIntoView({ block:'nearest' }); return; }
    if(t.closest('.c-check') || t.closest('input,select,button,a')) return;
    const tr = t.closest('tr[data-id]'); if(tr) go(`#/users/${tr.dataset.id}`);
  });
  $('#tbl').addEventListener('change', (e) => {
    if(e.target.id === 'sizeSel'){ S.size = +e.target.value; S.page = 1; draw(); return; }
    if(e.target.id === 'allCb'){
      const rows = $$('[data-sel]', $('#tbl'));
      rows.forEach(cb => e.target.checked ? S.selected.add(cb.dataset.sel) : S.selected.delete(cb.dataset.sel));
      draw(); return;
    }
    const id = e.target.dataset.sel; if(!id) return;
    e.target.checked ? S.selected.add(id) : S.selected.delete(id);
    draw();
  });
  $('#bulk').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bulk]'); if(!b) return;
    const sel = users.filter(u => S.selected.has(u.id) && !isMe(u));
    const by = (...ks) => sel.filter(u => ks.includes(uiStatus(u.status)));
    const done = (ok) => { if(ok) S.selected.clear(); };
    switch(b.dataset.bulk){
      case 'clear': S.selected.clear(); draw(); break;
      case 'approve': Actions.approve(by('pending')).then(done); break;
      case 'activate': Actions.activate(by('suspended', 'deactivated')).then(done); break;
      case 'suspend': Actions.suspend(by('active')).then(done); break;
      case 'deactivate': Actions.deactivate(by('active', 'suspended')).then(done); break;
      case 'delete': Actions.remove(sel).then(done); break;
    }
  });
}
function exportCsv(list){
  const cols = ['id','username','email','status','role','joined','last_active','trades','journal_entries'];
  const cell = (v) => { let s = String(v == null ? '' : v); if(/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = list.map(u => [u.id, u.username, u.email, STATUS[uiStatus(u.status)] ? STATUS[uiStatus(u.status)].label : u.status, u.role, u.created_at, u.last_active_at, u.trades, u.journal_entries].map(cell).join(','));
  const blob = new Blob([[cols.join(','), ...rows].join('\n')], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `clarity-users-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  B.logEvent('users_exported', null, { count: list.length }).catch(() => {});
  toast('success', 'Export ready', `${plural(list.length, 'user')} exported.`);
}

/* ---------- Pending ---------- */
async function viewPending(view, _, alive){
  setCrumbs([{ label:'Users', href:'#/users' }, { label:'Pending Users' }]);
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Pending Users</h1><p>People who signed up and are waiting for access.</p></div><div class="page-actions" id="pendActions"></div></div>
    <div class="card" id="pendCard"><ul class="list pending-list">${Array.from({length: 4}, () => `<li class="list-row"><span class="sk sk-circle" style="width:32px;height:32px"></span><div class="grow" style="display:flex;flex-direction:column;gap:7px">${sk('180px')}${sk('260px', 10)}</div>${sk('180px', 28)}</li>`).join('')}</ul></div>
    ${can('approve_users') ? '' : `<div class="notice notice-info mt">${I('info')}<span>Your role can view pending users but not approve them.</span></div>`}</div>`;
  let users;
  try{ users = await getUsers(true); }
  catch(e){ if(alive()){ $('#pendCard').innerHTML = errorState(e); $('[data-act="retry"]', view).onclick = rerender; } return; }
  if(!alive()) return;
  const pend = users.filter(u => u.status === 'pending').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  if(!pend.length){
    $('#pendCard').innerHTML = emptyState({ icon:'checkCircle', title:'You’re all caught up', text:'No one is waiting for approval. New sign-ups will show up here.', action:`<a class="btn btn-sm" href="#/users">View all users</a>` });
    return;
  }
  if(can('approve_users') && pend.length > 1) $('#pendActions').innerHTML = `<button class="btn btn-primary" id="approveAll">${I('userCheck')}Approve all ${pend.length}</button>`;
  $('#pendCard').innerHTML = `<div class="card-head" style="padding-bottom:12px;border-bottom:1px solid var(--border)"><div><h2>${plural(pend.length, 'request')}</h2><p>Oldest first, so nobody waits too long.</p></div></div>
    <ul class="list pending-list">${pend.map(u => `<li class="list-row">
      ${avatar(u)}
      <div class="grow">
        <div class="user-cell"><div class="meta"><div class="name">${esc(displayName(u))} ${statusPill(u.status)}</div><div class="sub">${esc(u.email)}</div></div></div>
        <div class="pending-meta" style="margin-top:6px">
          <span data-tip="${esc(fmtDateTime(u.created_at))}">${I('calendar')}Registered ${esc(fmtDate(u.created_at))}</span>
          <span>${I('clock')}Waiting ${esc(rel(u.created_at).replace(' ago', '').toLowerCase())}</span>
          <span style="color:${u.email_confirmed ? 'var(--green)' : 'var(--text-3)'}">${I(u.email_confirmed ? 'checkCircle' : 'mail')}${u.email_confirmed ? 'Email verified' : 'Email not verified'}</span>
        </div>
      </div>
      <div class="pending-actions">
        <a class="btn btn-sm btn-ghost" href="#/users/${u.id}">${I('eye')}View details</a>
        ${can('approve_users') ? `<button class="btn btn-sm" data-reject="${u.id}">${I('x')}Reject</button><button class="btn btn-sm btn-primary" data-approve="${u.id}">${I('check')}Approve</button>` : ''}
      </div></li>`).join('')}</ul>`;
  $('#pendCard').onclick = (e) => {
    const a = e.target.closest('[data-approve]'), r = e.target.closest('[data-reject]');
    const u = a ? pend.find(x => x.id === a.dataset.approve) : r ? pend.find(x => x.id === r.dataset.reject) : null;
    if(u) (a ? Actions.approve : Actions.reject)(u);
  };
  const all = $('#approveAll'); if(all) all.onclick = () => Actions.approve(pend);
}

/* ---------- User detail ---------- */
async function viewUser(view, [id], alive){
  setCrumbs([{ label:'Users', href:'#/users' }, { label:'…' }]);
  view.innerHTML = `<div class="page"><a class="back-link" href="#/users">${I('arrowLeft')}All users</a>
    <div class="card"><div class="profile-head"><span class="sk sk-circle" style="width:56px;height:56px"></span><div class="who" style="display:flex;flex-direction:column;gap:8px">${sk('200px', 18)}${sk('260px')}</div></div>
    <div class="mini-stats">${Array.from({length: 4}, () => `<div class="mini-stat">${sk('60%', 10)}<div style="height:8px"></div>${sk('40%', 16)}</div>`).join('')}</div></div>
    <div class="grid grid-detail mt"><div class="card" style="height:360px"></div><div class="card" style="height:360px"></div></div></div>`;
  let d;
  try{ d = await B.userDetail(id); }
  catch(e){ if(alive()){ view.innerHTML = `<div class="page"><a class="back-link" href="#/users">${I('arrowLeft')}All users</a><div class="card">${errorState(e)}</div></div>`; $('[data-act="retry"]', view).onclick = rerender; } return; }
  if(!alive()) return;
  const u = d && d.user;
  if(!u){
    setCrumbs([{ label:'Users', href:'#/users' }, { label:'Not found' }]);
    view.innerHTML = `<div class="page"><a class="back-link" href="#/users">${I('arrowLeft')}All users</a><div class="card">${emptyState({ icon:'userX', title:'User not found', text:'This account may have been deleted.', action:`<a class="btn btn-sm" href="#/users">Back to users</a>` })}</div></div>`;
    return;
  }
  setCrumbs([{ label:'Users', href:'#/users' }, { label: displayName(u) }]);
  const s = uiStatus(u.status), self = isMe(u);
  let primary = '';
  if(!self){
    if(s === 'pending' && can('approve_users')) primary = `<button class="btn" data-a="reject">${I('x')}Reject</button><button class="btn btn-primary" data-a="approve">${I('userCheck')}Approve</button>`;
    else if((s === 'suspended' || s === 'deactivated') && can('manage_users')) primary = `<button class="btn btn-primary" data-a="activate">${I('checkCircle')}Activate</button>`;
    else if(s === 'active' && can('manage_users')) primary = `<button class="btn" data-a="suspend">${I('ban')}Suspend</button>`;
  }
  const rolePerms = permissionsForRole(u.role);
  const weekly = d.weekly_trades || [];
  const sessions = d.sessions || [];
  const events = d.events || [];

  view.innerHTML = `<div class="page"><a class="back-link" href="#/users">${I('arrowLeft')}All users</a>
    ${s === 'suspended' || s === 'deactivated' ? `<div class="notice ${s === 'suspended' ? 'notice-red' : 'notice-amber'}" style="margin-bottom:16px">${I(s === 'suspended' ? 'ban' : 'power')}<span>
      <b>${s === 'suspended' ? 'Suspended' : 'Deactivated'}${u.status_changed_at ? ' ' + esc(rel(u.status_changed_at).toLowerCase()) : ''}.</b>
      ${u.status_reason ? `Reason: “${esc(u.status_reason)}”.` : 'No reason was recorded.'} They can’t sign in until the account is activated.</span></div>` : ''}
    ${s === 'pending' ? `<div class="notice notice-amber" style="margin-bottom:16px">${I('userClock')}<span><b>Waiting for approval</b> since ${esc(fmtDate(u.created_at))}. They can’t use Clarity Journal until approved.</span></div>` : ''}
    <div class="card">
      <div class="profile-head">${avatar(u, 'lg')}
        <div class="who"><h1>${esc(displayName(u))}${self ? '<span class="tag tag-you">You</span>' : ''} ${statusPill(u.status)}</h1>
          <div class="sub"><span>${esc(u.email || '')}</span><span class="faint">·</span>${roleBadge(u.role)}</div></div>
        <div class="page-actions">${primary}
          <button class="btn btn-icon" id="moreBtn" aria-label="More actions" aria-haspopup="menu">${I('more')}</button></div>
      </div>
      <div class="mini-stats">
        <div class="mini-stat"><div class="k">Trades logged</div><div class="v">${num(u.trades)}</div></div>
        <div class="mini-stat"><div class="k">Journal entries</div><div class="v">${num(u.journal_entries)}</div></div>
        <div class="mini-stat"><div class="k">Trading days</div><div class="v">${num(d.trading_days || 0)}</div></div>
        <div class="mini-stat"><div class="k">Last trade</div><div class="v" style="font-size:15px;padding-top:3px">${d.last_trade ? esc(fmtDate(d.last_trade + 'T12:00:00Z')) : '<span class="faint">None yet</span>'}</div></div>
      </div>
    </div>

    <div class="grid grid-detail mt">
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Account</h2></div><div class="card-body" style="padding-top:8px">
          <dl class="dl">
            <dt>User ID</dt><dd><span class="copyable"><span class="mono">${esc(u.id.slice(0, 8))}…${esc(u.id.slice(-4))}</span><button class="btn btn-ghost btn-sm btn-icon" data-copy="${esc(u.id)}" data-tip="Copy ID" aria-label="Copy user ID">${I('copy')}</button></span></dd>
            <dt>Username</dt><dd>${u.username ? '@' + esc(u.username) : '<span class="faint">Not set</span>'}</dd>
            <dt>Email</dt><dd>${esc(u.email || '—')}</dd>
            <dt>Email verified</dt><dd>${u.email_confirmed ? `<span style="color:var(--green)">Verified</span>` : '<span class="faint">Not verified</span>'}</dd>
            <dt>Status</dt><dd>${statusPill(u.status)}</dd>
            <dt>Role</dt><dd>${roleBadge(u.role)}</dd>
            <dt>Registered</dt><dd>${esc(fmtDateTime(u.created_at))}</dd>
            <dt>Last login</dt><dd>${u.last_sign_in_at ? `<span data-tip="${esc(fmtDateTime(u.last_sign_in_at))}">${esc(rel(u.last_sign_in_at))}</span>` : '<span class="faint">Never</span>'}</dd>
            <dt>Last active</dt><dd>${relTip(u.last_active_at)}</dd>
          </dl></div></div>

        <div class="card"><div class="card-head"><div><h2>Permissions</h2><p>What the ${esc(ROLES[u.role] ? ROLES[u.role].label : u.role)} role allows</p></div>
          ${can('manage_roles') && !self ? `<button class="btn btn-sm" data-a="role">${I('shield')}Change role</button>` : ''}</div>
          <div class="card-body" style="padding-top:8px">${rolePerms.map(([ok, label]) => `<div class="perm ${ok ? 'yes' : 'no'}">${I(ok ? 'check' : 'x')}${esc(label)}</div>`).join('')}</div></div>

        <div class="card"><div class="card-head"><div><h2>Admin controls</h2><p>${self ? 'You can’t change your own account here.' : 'Every action is recorded in the audit log.'}</p></div></div>
          <div class="card-body" style="display:flex;flex-wrap:wrap;gap:8px" id="controls"></div></div>
      </div>

      <div class="stack">
        <div class="card"><div class="card-head"><div><h2>Journal activity</h2><p>Trades logged per week, last 12 weeks</p></div></div>
          <div class="card-body"><div class="chart" id="weeklyChart" style="height:180px"></div></div></div>

        <div class="card"><div class="card-head"><div><h2>Active sessions</h2><p>${sessions.length ? `Signed in on ${plural(sessions.length, 'device')}` : 'Not signed in anywhere right now'}</p></div>
          ${sessions.length && can('manage_users') && !self ? `<button class="btn btn-sm" data-a="revoke">${I('logOut')}Sign out everywhere</button>` : ''}</div>
          <div class="card-body" style="padding:8px 0 4px">${sessions.length ? `<ul class="list">${sessions.map(x => `<li class="list-row">
            <span class="feed-icon">${I(isMobileUA(x.user_agent) ? 'phone' : 'monitor')}</span>
            <div class="grow"><div style="font-weight:500">${esc(device(x.user_agent) || 'Unknown device')}</div>
              <div class="faint" style="font-size:12px">${x.ip ? `<span class="mono" style="font-size:12px">${esc(x.ip)}</span> · ` : ''}Signed in ${esc(fmtDate(x.created_at))}</div></div>
            <span class="feed-time">${relTip(x.last_seen)}</span></li>`).join('')}</ul>`
            : emptyState({ icon:'monitor', title:'No active sessions', compact: true })}</div></div>

        <div class="card"><div class="card-head"><div><h2>Recent activity</h2><p>Changes to this account</p></div></div>
          ${!can('view_activity') ? emptyState({ icon:'lock', title:'Restricted', text:'Your role can’t view the audit log.', compact: true })
            : events.length ? `<ul class="timeline">${events.map(a => { const m = evMeta(a.event); return `<li><span class="feed-icon tone-${m.tone}">${I(m.icon)}</span>
              <div class="feed-text">${describe(a)}<div class="faint" style="font-size:12px">${esc(fmtDateTime(a.created_at))}${a.ip ? ` · <span class="mono" style="font-size:11.5px">${esc(a.ip)}</span>` : ''}</div></div></li>`; }).join('')}</ul>`
            : emptyState({ icon:'activity', title:'No activity yet', compact: true })}
        </div>
      </div>
    </div></div>`;

  Charts.render($('#weeklyChart'), { type:'bar', data: weekly, x:'week', series:[{ key:'n', label:'Trades', color:'--c-green' }],
    xFormat: shortDay, tipTitle: (r) => `Week of ${shortDay(r.week)}`, xLabel:'Week', label:'Trades logged per week' });

  // admin controls: explicit, labelled buttons for each action this admin may take
  const ctl = [];
  if(!self){
    if(s === 'pending' && can('approve_users')) ctl.push(['approve', 'userCheck', 'Approve'], ['reject', 'userX', 'Reject']);
    if((s === 'suspended' || s === 'deactivated') && can('manage_users')) ctl.push(['activate', 'checkCircle', 'Activate']);
    if(s === 'active' && can('manage_users')) ctl.push(['suspend', 'ban', 'Suspend']);
    if((s === 'active' || s === 'suspended') && can('manage_users')) ctl.push(['deactivate', 'power', 'Deactivate']);
    if(can('manage_roles')) ctl.push(['role', 'shield', 'Change role']);
  }
  if(can('manage_users') && u.email) ctl.push(['reset', 'key', 'Reset password']);
  if(can('manage_users')) ctl.push(['edit', 'pencil', 'Edit']);
  if(can('delete_users') && !self) ctl.push(['delete', 'trash', 'Delete account', 'btn-danger']);
  $('#controls').innerHTML = ctl.length ? ctl.map(([a, i, l, cls]) => `<button class="btn btn-sm ${cls || ''}" data-a="${a}">${I(i)}${l}</button>`).join('')
    : '<span class="faint" style="font-size:13px">Your role has no actions available for this account.</span>';

  const run = {
    approve: () => Actions.approve(u), reject: () => Actions.reject(u), activate: () => Actions.activate(u),
    suspend: () => Actions.suspend(u), deactivate: () => Actions.deactivate(u), role: () => Actions.changeRole(u),
    reset: () => Actions.resetPassword(u), edit: () => Actions.edit(u), revoke: () => Actions.revokeSessions(u),
    delete: () => Actions.remove(u, () => go('#/users')),
  };
  $('.page', view).addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]'); if(a && run[a.dataset.a]){ run[a.dataset.a](); return; }
    const c = e.target.closest('[data-copy]');
    if(c){ navigator.clipboard.writeText(c.dataset.copy).then(() => toast('success', 'User ID copied'), () => toast('error', 'Couldn’t copy')); }
  });
  $('#moreBtn').onclick = (e) => openMenu(e.currentTarget, userMenuItems(u, { fromDetail: true }));
}
function permissionsForRole(role){
  const m = (settings.permissions && settings.permissions.moderator) || {};
  const staff = role === 'admin' || role === 'moderator';
  const mod = (k) => role === 'admin' || (role === 'moderator' && !!m[k]);
  return [
    [true, 'Use the Clarity Journal app'],
    [staff, 'Open the admin panel and view users'],
    [mod('approve_users'), 'Approve and reject sign-ups'],
    [mod('manage_users'), 'Suspend, activate, reset passwords and set tab access'],
    [mod('view_activity'), 'View the audit log'],
    [role === 'admin', 'Change roles and delete accounts'],
    [role === 'admin', 'Change system settings'],
  ];
}

/* ---------- Tab access ---------- */
// the Clarity Journal tabs that can be switched off per account (Dashboard and Settings always stay)
const APP_TABS = [
  ['analytics', 'Trade Analytics'], ['journal', 'Trade Journal'], ['notes', 'Notes'], ['expenses', 'Expense Tracker'], ['payouts', 'Payouts'],
  ['consistency', 'Consistency Calculator'], ['tax', 'Tax Calculator'], ['econ', 'Economic Calendar'], ['checklist', 'Checklist'],
];
// extra delete rights an admin can hand out (journal pages and Expense Tracker entries are deletable by everyone already)
const DEL_PERMS = [['payouts', 'Delete payouts'], ['trades', 'Delete trades']];
const tabName = (k) => (APP_TABS.find(t => t[0] === k) || [k, k])[1];
const accessState = { q:'' };
async function viewAccess(view, _, alive){
  setCrumbs([{ label:'Users', href:'#/users' }, { label:'Tab Access' }]);
  const S = accessState;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Tab Access</h1><p>Choose who can use each Clarity Journal tab, and who can delete their own payouts and trades. Dashboard and Settings are always available, and new accounts start with every tab.</p></div></div>
    <div class="card">
      <div class="toolbar">
        <label class="search-field">${I('search')}<input class="input" id="tq" type="search" placeholder="Search users" value="${esc(S.q)}" aria-label="Search users"></label>
        <span class="spacer"></span>
        <span class="faint" id="accessCount" style="font-size:12.5px"></span>
      </div>
      <div id="accessBody">${feedSkeleton(6)}</div>
    </div>
    <p class="faint elog-note">${I('info')}<span>A tab you switch off disappears from that person’s sidebar and can’t be opened; their saved data isn’t touched, so switching it back on brings everything back.
      <b>Delete payouts</b> and <b>Delete trades</b> let someone remove their own entries, for example a payout typed with the wrong amount. They start off for everyone, and admins can always delete.
      Changes apply the next time they open Clarity Journal.</span></p></div>`;

  let users, access;
  try{ [users, access] = await Promise.all([getUsers(), B.tabAccess()]); }
  catch(e){ if(alive()){ $('#accessBody').innerHTML = errorState(e); $('[data-act="retry"]', view).onclick = rerender; } return; }
  if(!alive()) return;
  const hidden = new Map(), deletes = new Map();
  (access || []).forEach(r => { hidden.set(r.id, new Set(r.hidden_tabs || [])); deletes.set(r.id, new Set(r.delete_perms || [])); });
  const setOf = (map, id) => { if(!map.has(id)) map.set(id, new Set()); return map.get(id); };
  const isAdmin = (u) => u.role === 'admin';

  // one model for both kinds of column: does this person have it, can it be changed, and how to save it
  const COLS = [
    ...APP_TABS.map(([k, l]) => ({ kind:'tab', k, l,
      has: (u) => !setOf(hidden, u.id).has(k), locked: () => false,
      set: (u, on) => on ? setOf(hidden, u.id).delete(k) : setOf(hidden, u.id).add(k),
      save: (ids, on) => B.setTabAccess(ids, k, on) })),
    ...DEL_PERMS.map(([k, l]) => ({ kind:'del', k, l,
      has: (u) => isAdmin(u) || setOf(deletes, u.id).has(k), locked: isAdmin,
      set: (u, on) => on ? setOf(deletes, u.id).add(k) : setOf(deletes, u.id).delete(k),
      save: (ids, on) => B.setDeleteAccess(ids, k, on) })),
  ];
  const colOf = (id) => COLS[+id];
  const turnedText = (c, on) => c.kind === 'tab' ? `${c.l} turned ${on ? 'on' : 'off'}` : `${c.l} ${on ? 'allowed' : 'removed'}`;
  let shown = [];

  const updateHeaders = () => {
    COLS.forEach((c, i) => {
      const on = shown.filter(c.has).length;
      const cb = $(`[data-col="${i}"]`, view); if(!cb) return;
      cb.checked = shown.length > 0 && on === shown.length;
      cb.indeterminate = on > 0 && on < shown.length;
      $(`[data-colcount="${i}"]`, view).textContent = `${num(on)} of ${num(shown.length)}`;
    });
  };
  const draw = () => {
    const q = S.q.trim().toLowerCase();
    shown = users.filter(u => !q || (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    $('#accessCount').textContent = q ? `${plural(shown.length, 'user')} shown` : plural(shown.length, 'user');
    if(!shown.length){
      $('#accessBody').innerHTML = emptyState(q ? { icon:'search', title:'No matching users', text:`Nobody matches “${esc(S.q.trim())}”.` } : { icon:'users', title:'No users yet' });
      return;
    }
    const firstDel = COLS.findIndex(c => c.kind === 'del');
    $('#accessBody').innerHTML = `<div class="table-wrap"><table class="tbl access-tbl">
      <thead><tr><th>User</th>${COLS.map((c, i) => `<th class="c-tab${c.kind === 'del' ? ' c-del' : ''}${i === firstDel ? ' c-del-first' : ''}"><label class="th-check">
        <span>${esc(c.l)}</span><input type="checkbox" class="cb" data-col="${i}" aria-label="${esc(c.l)} for everyone shown"><small class="faint" data-colcount="${i}"></small></label></th>`).join('')}</tr></thead>
      <tbody>${shown.map(u => `<tr>
        <td><a href="#/users/${u.id}" class="user-cell" style="text-decoration:none">${avatar(u, 'sm')}<div class="meta"><div class="name">${esc(displayName(u))}${isMe(u) ? ' <span class="tag tag-you">You</span>' : ''}</div><div class="sub">${esc(u.email || '')}</div></div></a></td>
        ${COLS.map((c, i) => { const lock = c.locked(u);
          return `<td class="c-tab${c.kind === 'del' ? ' c-del' : ''}${i === firstDel ? ' c-del-first' : ''}">${lock
            ? `<span class="locked-cell" data-tip="Admins can always delete"><input type="checkbox" class="cb" checked disabled aria-label="${esc(displayName(u))}: ${esc(c.l)} (admins can always delete)"></span>`
            : `<input type="checkbox" class="cb" data-u="${u.id}" data-c="${i}" ${c.has(u) ? 'checked' : ''} aria-label="${esc(displayName(u))}: ${esc(c.l)}">`}</td>`; }).join('')}
      </tr>`).join('')}</tbody></table></div>`;
    updateHeaders();
  };

  $('#accessBody').addEventListener('change', async (e) => {
    const cb = e.target;
    if(cb.dataset.u){
      // one person, one column
      const u = users.find(x => x.id === cb.dataset.u), c = colOf(cb.dataset.c), on = cb.checked;
      cb.disabled = true;
      try{
        await c.save([u.id], on);
        c.set(u, on);
        toast('success', turnedText(c, on), `For ${displayName(u)}.`);
      }catch(err){ cb.checked = !on; toast('error', 'Couldn’t change access', errText(err)); }
      cb.disabled = false;
      updateHeaders();
    } else if(cb.dataset.col){
      // a whole column: everyone currently shown (admins are skipped where they're locked on)
      const c = colOf(cb.dataset.col);
      const editable = shown.filter(u => !c.locked(u));
      const on = !editable.every(c.has);
      updateHeaders(); // put the header box back until this is confirmed
      const targets = editable.filter(u => c.has(u) !== on);
      if(!targets.length) return;
      const tab = c.kind === 'tab';
      const ok = await modal({
        icon: on ? 'checkCircle' : (tab ? 'lock' : 'trash'), tone: on ? 'green' : 'amber',
        title: tab ? `Turn ${on ? 'on' : 'off'} ${c.l} for ${plural(targets.length, 'user')}?`
                   : `${on ? 'Allow' : 'Remove'} “${c.l}” ${on ? 'for' : 'from'} ${plural(targets.length, 'user')}?`,
        desc: tab
          ? (on ? 'They’ll see this tab the next time they open Clarity Journal.' : 'It disappears from their sidebar the next time they open Clarity Journal. Their saved data isn’t touched.')
          : (on ? 'They’ll be able to delete their own entries the next time they open Clarity Journal.' : 'They won’t be able to delete these entries any more. Nothing they’ve saved is removed.'),
        confirmLabel: tab ? `Turn ${on ? 'on' : 'off'}` : (on ? 'Allow' : 'Remove'), confirmClass: on ? 'btn-primary' : 'btn-warn',
        onConfirm: () => c.save(targets.map(u => u.id), on),
      });
      if(ok){
        targets.forEach(u => c.set(u, on));
        draw();
        toast('success', turnedText(c, on), `For ${plural(targets.length, 'user')}.`);
      }
    }
  });
  $('#tq').addEventListener('input', debounce((e) => { S.q = e.target.value; draw(); }, 150));
  draw();
}

/* ---------- Activity ---------- */
const actState = { q:'', event:'', since:30, page:1, size:25 };
async function viewActivity(view, _, alive){
  setCrumbs([{ label:'Activity' }]);
  const S = actState;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Activity</h1><p>An append-only audit log of important platform and admin events.</p></div>
      <div class="page-actions"><button class="btn" id="actRefresh">${I('refresh')}Refresh</button></div></div>
    <div class="card">
      <div class="toolbar">
        <label class="search-field">${I('search')}<input class="input" id="aq" type="search" placeholder="Search user, admin or IP" value="${esc(S.q)}" aria-label="Search activity"></label>
        <select class="select" id="evSel" aria-label="Filter by event">${EVENT_GROUPS.map(([v, l]) => `<option value="${v}" ${S.event === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="spacer"></span>
        <div class="seg" id="sinceSeg" aria-label="Time range">${[[1,'24h'],[7,'7d'],[30,'30d'],[90,'90d'],[0,'All']].map(([v, l]) => `<button class="${S.since === v ? 'on' : ''}" data-since="${v}">${l}</button>`).join('')}</div>
      </div>
      <div id="actBody"></div>
    </div>
    <p class="faint" style="font-size:12.5px;margin-top:12px;display:flex;gap:6px;align-items:center">${I('lock')}Entries are written by the database itself and can’t be edited or deleted from the panel.</p></div>`;

  const skeleton = `<div class="table-wrap"><table class="tbl"><tbody>${Array.from({length: 10}, () => `<tr><td><div class="event-cell"><span class="sk sk-circle" style="width:26px;height:26px"></span>${sk('120px')}</div></td><td>${sk('110px')}</td><td>${sk('80px')}</td><td>${sk('130px')}</td><td>${sk('150px')}</td></tr>`).join('')}</tbody></table></div>`;
  let seq = 0;
  const load = async () => {
    const my = ++seq;
    $('#actBody').innerHTML = skeleton;
    let res;
    try{ res = await B.activity({ search: S.q, event: S.event, sinceDays: S.since, page: S.page, pageSize: S.size }); }
    catch(e){ if(my === seq && alive()){ $('#actBody').innerHTML = errorState(e); $('[data-act="retry"]', view).onclick = load; } return; }
    if(my !== seq || !alive()) return;
    const { rows, total } = res;
    const pages = Math.max(1, Math.ceil(total / S.size));
    if(!rows.length){
      $('#actBody').innerHTML = emptyState(S.q || S.event || S.since
        ? { icon:'search', title:'No matching events', text:'Try widening the time range or clearing filters.', action:`<button class="btn btn-sm" data-act="clear">Clear filters</button>` }
        : { icon:'activity', title:'No activity yet', text:'Events appear here as soon as people sign up or admins make changes.' });
      const c = $('[data-act="clear"]', view); if(c) c.onclick = () => { Object.assign(S, { q:'', event:'', since:0, page:1 }); rerender(); };
      return;
    }
    $('#actBody').innerHTML = `<div class="table-wrap"><table class="tbl responsive no-check">
      <thead><tr><th>Event</th><th>User</th><th>Admin</th><th>Date &amp; time</th><th class="hide-md">IP / device</th></tr></thead>
      <tbody>${rows.map(a => { const m = evMeta(a.event); const d = a.detail || {};
        const extra = a.event === 'role_changed' ? `${(ROLES[d.from] || {label:d.from}).label} → ${(ROLES[d.to] || {label:d.to}).label}`
          : a.event === 'settings_updated' ? (SECTION_TITLES[a.target_label] || a.target_label)
          : a.event === 'tab_access_changed' ? `${tabName(d.tab)} ${d.allowed ? 'on' : 'off'}`
          : a.event === 'delete_access_changed' ? `Delete ${d.perm} ${d.allowed ? 'on' : 'off'}` : d.reason ? `“${d.reason}”` : '';
        const userCell = a.event === 'settings_updated' || !a.target_label ? '<span class="faint">—</span>'
          : a.target_id && a.event !== 'user_deleted' ? `<a href="#/users/${a.target_id}" style="text-decoration:none;font-weight:500">${esc(a.target_label)}</a>` : `<span>${esc(a.target_label)}</span>`;
        return `<tr>
          <td class="c-main"><div class="event-cell"><span class="feed-icon tone-${m.tone}">${I(m.icon)}</span><div><div style="font-weight:500">${esc(m.label)}</div>${extra ? `<div class="c-sub" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(extra)}</div>` : ''}</div></div></td>
          <td data-label="User">${userCell}</td>
          <td data-label="Admin">${a.actor_label ? esc(a.actor_label) : '<span class="faint">System</span>'}</td>
          <td data-label="Date &amp; time"><span data-tip="${esc(rel(a.created_at))}">${esc(fmtDateTime(a.created_at))}</span></td>
          <td class="hide-md m-hide">${a.ip || a.user_agent ? `<div class="mono" style="font-size:12px">${esc(a.ip || '—')}</div><div class="c-sub">${esc(device(a.user_agent))}</div>` : '<span class="faint">—</span>'}</td>
        </tr>`; }).join('')}</tbody></table></div>
      <div class="pager"><span>${num((S.page - 1) * S.size + 1)}–${num(Math.min(S.page * S.size, total))} of ${num(total)} events</span>
        <div class="ctrl"><span>Page ${S.page} of ${pages}</span>
        <button class="btn btn-sm btn-icon" data-pg="-1" ${S.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${I('chevronLeft')}</button>
        <button class="btn btn-sm btn-icon" data-pg="1" ${S.page >= pages ? 'disabled' : ''} aria-label="Next page">${I('chevronRight')}</button></div></div>`;
  };
  $('#aq').addEventListener('input', debounce((e) => { S.q = e.target.value; S.page = 1; load(); }, 250));
  $('#evSel').onchange = (e) => { S.event = e.target.value; S.page = 1; load(); };
  $('#sinceSeg').onclick = (e) => { const b = e.target.closest('[data-since]'); if(!b) return; S.since = +b.dataset.since; S.page = 1;
    $$('#sinceSeg button').forEach(x => x.classList.toggle('on', x === b)); load(); };
  $('#actBody').addEventListener('click', (e) => { const p = e.target.closest('[data-pg]'); if(p){ S.page += +p.dataset.pg; load(); } });
  $('#actRefresh').onclick = load;
  await load();
}

/* ---------- Analytics ---------- */
let anDays = 90;
function bucket(series, days){
  if(days <= 90) return series;
  const out = []; // weekly buckets for long ranges so bars stay readable
  for(let i = 0; i < series.length; i += 7){
    const ch = series.slice(i, i + 7);
    out.push({ day: ch[0].day, signups: ch.reduce((a, d) => a + d.signups, 0), trades: ch.reduce((a, d) => a + d.trades, 0),
      events: ch.reduce((a, d) => a + d.events, 0), active: Math.round(ch.reduce((a, d) => a + d.active, 0) / ch.length * 10) / 10, users: ch[ch.length - 1].users });
  }
  return out;
}
async function viewAnalytics(view, _, alive){
  setCrumbs([{ label:'Analytics' }]);
  const chartCard = (id, title, sub, extra) => `<div class="card"><div class="card-head"><div><h2>${title}</h2><p>${sub}</p></div>${extra || ''}</div>
    <div class="card-body"><div class="chart-kpi" id="${id}Kpi">${sk('90px', 22)}</div><div class="chart" id="${id}"><span class="sk" style="height:100%;width:100%;border-radius:8px;opacity:.5"></span></div></div></div>`;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Analytics</h1><p>Growth, engagement and retention across the platform.</p></div>
      <div class="seg" id="rangeSeg" aria-label="Date range">${[[30,'30 days'],[90,'90 days'],[180,'180 days']].map(([v, l]) => `<button class="${anDays === v ? 'on' : ''}" data-d="${v}">${l}</button>`).join('')}</div></div>
    <div class="grid grid-stats" id="anStats" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">${Array.from({length: 4}, statSkeleton).join('')}</div>
    <div class="grid grid-2-even">
      ${chartCard('cNew', 'New users over time', 'Sign-ups per day')}
      ${chartCard('cActive', 'Active users', 'Users who logged at least one trade that day')}
      ${chartCard('cTrades', 'Trades logged over time', 'All trades across every journal')}
      ${chartCard('cEvents', 'Daily activity', 'Platform and admin events per day')}
    </div>
    <div class="grid grid-2 mt">
      <div class="card"><div class="card-head"><div><h2>User retention</h2><p>Share of each weekly sign-up cohort that logged a trade, by weeks since joining</p></div></div>
        <div class="card-body" id="cohorts" style="overflow-x:auto">${sk('100%', 160)}</div></div>
      <div class="card"><div class="card-head"><div><h2>Pending vs active users</h2><p>Every account by status right now</p></div></div>
        <div class="card-body" id="anStatus">${sk('100%', 10)}</div></div>
    </div></div>`;
  $('#rangeSeg').onclick = (e) => { const b = e.target.closest('[data-d]'); if(!b) return; anDays = +b.dataset.d; rerender(); };

  let a;
  try{ a = await B.analytics(anDays); }
  catch(e){ if(alive()){ $('#anStats').innerHTML = `<div class="card" style="grid-column:1/-1">${errorState(e)}</div>`; $$('[data-act="retry"]', view).forEach(b => b.onclick = rerender); } return; }
  if(!alive()) return;
  const raw = a.series || [];
  const s = bucket(raw, anDays);
  const per = anDays > 90 ? 'week' : 'day';
  const sum = (k) => raw.reduce((x, d) => x + (+d[k] || 0), 0);
  const half = Math.floor(raw.length / 2);
  const sumRange = (k, from, to) => raw.slice(from, to).reduce((x, d) => x + (+d[k] || 0), 0);
  const avgActive = raw.length ? sum('active') / raw.length : 0;
  $('#anStats').innerHTML = [
    statCard({ label:'New users', value: num(sum('signups')), icon:'userPlus', foot: `${delta(sumRange('signups', half), sumRange('signups', 0, half))}<span>vs first half of range</span>` }),
    statCard({ label:'Weekly active', value: num(a.wau), icon:'activity', foot: `<span>logged a trade in the last 7 days</span>` }),
    statCard({ label:'Monthly active', value: num(a.mau), icon:'users', foot: `<span>${a.status && a.status.active ? pct(a.mau / a.status.active * 100) : '0%'} of active accounts</span>` }),
    statCard({ label:'Trades logged', value: num(sum('trades')), icon:'trendUp', foot: `${delta(sumRange('trades', half), sumRange('trades', 0, half))}<span>vs first half of range</span>` }),
  ].join('');

  const xf = (v) => shortDay(v);
  const tt = (d) => per === 'week' ? `Week of ${shortDay(d.day)}` : shortDay(d.day);
  $('#cNewKpi').innerHTML = `<span class="v">${num(sum('signups'))}</span><span class="l">sign-ups · ${num(raw.length ? raw[raw.length - 1].users : 0)} accounts total</span>`;
  Charts.render($('#cNew'), { type:'bar', data:s, x:'day', series:[{ key:'signups', label:'Sign-ups', color:'--c-green' }], xFormat:xf, tipTitle:tt, label:`New users per ${per}` });
  $('#cActiveKpi').innerHTML = `<span class="v">${(Math.round(avgActive * 10) / 10).toString()}</span><span class="l">average daily active traders</span>`;
  Charts.render($('#cActive'), { type:'area', data:s, x:'day', series:[{ key:'active', label: per === 'week' ? 'Avg daily active' : 'Active users', color:'--c-violet' }], xFormat:xf, tipTitle:tt, label:'Active users' });
  $('#cTradesKpi').innerHTML = `<span class="v">${num(sum('trades'))}</span><span class="l">trades in ${anDays} days</span>`;
  Charts.render($('#cTrades'), { type:'area', data:s, x:'day', series:[{ key:'trades', label:'Trades', color:'--c-green' }], xFormat:xf, tipTitle:tt, label:`Trades logged per ${per}` });
  $('#cEventsKpi').innerHTML = `<span class="v">${num(sum('events'))}</span><span class="l">events recorded</span>`;
  Charts.render($('#cEvents'), { type:'bar', data:s, x:'day', series:[{ key:'events', label:'Events', color:'--c-violet' }], xFormat:xf, tipTitle:tt, label:`Platform events per ${per}` });

  // cohort heatmap — one hue, light → strong with the share
  const cohorts = a.cohorts || [];
  const maxW = Math.max(0, ...cohorts.map(c => c.weeks.length));
  $('#cohorts').innerHTML = cohorts.length ? `<table class="heat"><thead><tr><th class="l">Cohort</th><th>Users</th>${Array.from({length: maxW}, (_, k) => `<th>W${k}</th>`).join('')}</tr></thead>
    <tbody>${cohorts.map(c => `<tr><td class="l">${esc(shortDay(c.week))}</td><td class="l" style="text-align:center">${num(c.size)}</td>${Array.from({length: maxW}, (_, k) => {
      if(k >= c.weeks.length) return '<td class="na"></td>';
      const p = c.size ? c.weeks[k] / c.size : 0;
      return `<td style="background:rgba(0,168,127,${(0.06 + p * 0.74).toFixed(2)})" data-tip="${esc(`${num(c.weeks[k])} of ${num(c.size)} logged a trade in week ${k}`)}">${Math.round(p * 100)}%</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`
    : emptyState({ icon:'chart', title:'Not enough data yet', text:'Retention appears once people have been signed up for a week or more.', compact: true });
  $('#anStatus').innerHTML = statusBreakdown(a.status) + `<p class="faint" style="font-size:12.5px;margin:16px 0 0">${a.status.pending ? `${plural(a.status.pending, 'account')} waiting for approval. <a href="#/pending" style="color:var(--text)">Review now</a>` : 'Nobody is waiting for approval.'}</p>`;
}

/* ---------- Error log ---------- */
const ERROR_KINDS = {
  error:    { label:'Crash',       tone:'red',    tab:'crash',    icon:'alert' },
  promise:  { label:'Crash',       tone:'red',    tab:'crash',    icon:'alert' },
  resource: { label:'Failed load', tone:'amber',  tab:'resource', icon:'file' },
  console:  { label:'App error',   tone:'violet', tab:'console',  icon:'info' },
  warning:  { label:'Warning',     tone:'gray',   tab:'warning',  icon:'info' },
};
const ERROR_TABS = [['all','All'], ['crash','Crashes'], ['resource','Failed loads'], ['console','App errors'], ['warning','Warnings']];
const errKind = (x) => ERROR_KINDS[x.kind] || ERROR_KINDS.error;
const errState = { q:'', tab:'all' };
async function viewErrors(view, _, alive){
  setCrumbs([{ label:'Error Log' }]);
  const S = errState;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Error Log</h1><p id="errSummary">Problems people ran into on the site. Kept for 30 days.</p></div>
      <div class="page-actions"><button class="btn" id="errRefresh">${I('refresh')}Refresh</button><button class="btn btn-ghost" id="errClear">${I('trash')}Clear all</button></div></div>
    <div class="card">
      <div class="toolbar">
        <label class="search-field">${I('search')}<input class="input" id="eq" type="search" placeholder="Search errors, pages or users" value="${esc(S.q)}" aria-label="Search the error log"></label>
        <span class="spacer"></span>
        <div class="seg" id="errTabs" aria-label="Filter by type"></div>
      </div>
      <div id="errBody">${feedSkeleton(6)}</div>
    </div>
    <p class="faint elog-note">${I('info')}<span><b>Crash</b>: the code stopped with an error. <b>Failed load</b>: an image, script or style file couldn’t be loaded, often a missing upload.
      <b>App error</b>: something the app caught and logged, like a failed save. <b>Warning</b>: worth a look, but the app kept working.
      Reports never include what people typed, their journal or their screenshots.</span></p></div>`;

  let rows = [], names = new Map();
  const who = (x) => x.user_id ? (names.get(x.user_id) || 'Deleted user') : 'Signed out';
  const draw = () => {
    const dayAgo = Date.now() - DAY;
    const lastDay = rows.filter(x => Date.parse(x.last_seen) >= dayAgo);
    const hits = lastDay.reduce((a, x) => a + (x.hits || 1), 0);
    $('#errSummary').textContent = rows.length
      ? `${plural(lastDay.length, 'problem')} in the last 24 hours (${plural(hits, 'time')} in total). Kept for 30 days.`
      : 'Problems people ran into on the site. Kept for 30 days.';
    const counts = { all: rows.length };
    rows.forEach(x => { const t = errKind(x).tab; counts[t] = (counts[t] || 0) + 1; });
    $('#errTabs').innerHTML = ERROR_TABS.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}" aria-pressed="${S.tab === k}">${l}<span class="count">${num(counts[k] || 0)}</span></button>`).join('');

    const q = S.q.trim().toLowerCase();
    const list = rows.filter(x => (S.tab === 'all' || errKind(x).tab === S.tab)
      && (!q || [x.message, x.page, x.detail, who(x), device(x.browser)].join(' ').toLowerCase().includes(q)));
    if(!list.length){
      const tabName = ERROR_TABS.find(t => t[0] === S.tab)[1].toLowerCase();
      $('#errBody').innerHTML = emptyState(q ? { icon:'search', title:'No matches', text:`Nothing in the log matches “${esc(S.q.trim())}”.` }
        : rows.length ? { icon:'checkCircle', title:'Nothing here', text:`No ${esc(tabName)} in the last 30 days.` }
        : { icon:'checkCircle', title:'No errors', text:'Nothing has gone wrong in the last 30 days.' });
      return;
    }
    $('#errBody').innerHTML = `<ul class="list">${list.map(x => { const k = errKind(x); return `<li class="list-row elog-row">
        <span class="feed-icon tone-${k.tone}">${I(k.icon)}</span>
        <div class="grow">
          <div class="elog-msg"><span class="tag tone-${k.tone}">${esc(k.label)}</span><span>${esc(x.message)}</span></div>
          <div class="elog-meta"><span>Page <b>${esc(x.page || '—')}</b></span><span>User <b>${esc(who(x))}</b></span>${x.browser ? `<span>${esc(device(x.browser))}</span>` : ''}${x.hits > 1 ? `<span>First seen ${relTip(x.first_seen)}</span>` : ''}</div>
          ${x.detail || x.browser ? `<details class="elog-detail"><summary>Details</summary><pre class="code">${esc([x.detail, x.browser ? 'Browser: ' + x.browser : ''].filter(Boolean).join('\n\n'))}</pre></details>` : ''}
        </div>
        <div class="elog-side"><span class="feed-time">${relTip(x.last_seen)}</span><span class="elog-hits" data-tip="How many times this happened">×${num(x.hits || 1)}</span>
          <button class="btn btn-sm btn-ghost btn-icon" data-del="${esc(x.id)}" aria-label="Delete this entry" data-tip="Delete">${I('x')}</button></div>
      </li>`; }).join('')}</ul>`;
  };
  const load = async () => {
    let r;
    try{
      [r] = await Promise.all([B.errors(), getUsers().then(us => { names = new Map(us.map(u => [u.id, displayName(u)])); }).catch(() => {})]);
    }catch(e){
      if(alive()){ $('#errBody').innerHTML = errorState(e); $('[data-act="retry"]', view).onclick = load; }
      return false;
    }
    if(!alive()) return false;
    rows = r; draw();
    return true;
  };

  $('#eq').addEventListener('input', debounce((e) => { S.q = e.target.value; draw(); }, 150));
  $('#errTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if(!b) return; S.tab = b.dataset.tab; draw(); };
  $('#errRefresh').onclick = async () => { if(await load()) toast('success', 'Error log refreshed'); };
  $('#errClear').onclick = async () => {
    if(!rows.length){ toast('info', 'The error log is already empty'); return; }
    const ok = await modal({
      icon:'trash', tone:'red', title:'Clear the error log?',
      desc:`This deletes all ${num(rows.length)} entr${rows.length === 1 ? 'y' : 'ies'}. New errors will keep coming in as they happen.`,
      confirmLabel:'Clear all', confirmClass:'btn-danger', onConfirm: () => B.clearErrors(),
    });
    if(ok){ toast('success', 'Error log cleared'); load(); }
  };
  $('#errBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]'); if(!b) return;
    b.disabled = true; hideTip();
    try{ await B.deleteError(Number(b.dataset.del)); rows = rows.filter(x => String(x.id) !== b.dataset.del); draw(); }
    catch(err){ b.disabled = false; toast('error', 'Couldn’t delete that entry', errText(err)); }
  });
  await load();
}

/* ---------- Support (bug reports and questions sent from the app's Support page) ---------- */
const TICKET_TYPES = { bug:'Bug report', question:'Question', other:'Other' };
const TICKET_STATUS = { open:{ label:'Open', tone:'amber' }, answered:{ label:'Answered', tone:'green' }, closed:{ label:'Closed', tone:'gray' } };
const SUPPORT_TABS = [['open','Open'], ['answered','Answered'], ['closed','Closed'], ['all','All']];
const supportState = { q:'', tab:'open' };
const ticketPill = (s) => { const m = TICKET_STATUS[s] || { label:s, tone:'gray' }; return `<span class="pill tone-${m.tone}">${esc(m.label)}</span>`; };
const ticketUser = (t) => ({ id: t.user_id, username: t.username, email: t.email });

async function viewSupport(view, _, alive){
  setCrumbs([{ label:'Support' }]);
  const S = supportState;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Support</h1><p>Bug reports and questions sent from the app. Your replies are signed “Clarity Journal Support”.</p></div>
      <div class="page-actions"><button class="btn" id="tkRefresh">${I('refresh')}Refresh</button></div></div>
    <div class="card">
      <div class="toolbar">
        <label class="search-field">${I('search')}<input class="input" id="tkq" type="search" placeholder="Search tickets or people" value="${esc(S.q)}" aria-label="Search tickets"></label>
        <span class="spacer"></span>
        <div class="seg" id="tkTabs" aria-label="Filter by status"></div>
      </div>
      <div id="tkBody">${feedSkeleton(5)}</div>
    </div></div>`;

  let rows = [];
  const draw = () => {
    const counts = { all: rows.length };
    rows.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
    $('#tkTabs').innerHTML = SUPPORT_TABS.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}" aria-pressed="${S.tab === k}">${l}<span class="count">${num(counts[k] || 0)}</span></button>`).join('');
    const q = S.q.trim().toLowerCase();
    const list = rows.filter(t => (S.tab === 'all' || t.status === S.tab)
      && (!q || [t.subject, t.username, t.email, '#' + t.id].join(' ').toLowerCase().includes(q)));
    if(!list.length){
      $('#tkBody').innerHTML = emptyState(q ? { icon:'search', title:'No matches', text:`No tickets match “${esc(S.q.trim())}”.` }
        : rows.length ? { icon:'checkCircle', title: S.tab === 'open' ? 'All caught up' : 'Nothing here', text: S.tab === 'open' ? 'No tickets are waiting for a reply.' : 'No tickets with this status.' }
        : { icon:'inbox', title:'No tickets yet', text:'When someone sends a bug report or a question from the app, it shows up here.' });
      return;
    }
    $('#tkBody').innerHTML = `<div class="list">${list.map(t => `<a class="list-row tk-row${t.unread ? ' unread' : ''}" href="#/support/${t.id}">
        <span class="tk-dot" ${t.unread ? 'role="img" aria-label="New message"' : 'aria-hidden="true"'}></span>
        ${avatar(ticketUser(t), 'sm')}
        <div class="grow"><div class="tk-subject">${esc(t.subject)}</div>
          <div class="elog-meta"><span>#${t.id}</span><span>${esc(TICKET_TYPES[t.type] || 'Other')}</span><span>From <b>${esc(displayName(ticketUser(t)))}</b></span><span>${plural(t.messages, 'message')}</span></div></div>
        <div class="elog-side">${ticketPill(t.status)}<span class="feed-time">${relTip(t.updated_at)}</span></div></a>`).join('')}</div>`;
  };
  const load = async () => {
    let r;
    try{ r = await B.supportList(); }
    catch(e){
      if(alive()){ $('#tkBody').innerHTML = errorState(e); $('[data-act="retry"]', view).onclick = load; }
      return false;
    }
    if(!alive()) return false;
    rows = r || [];
    cache.supportOpen = rows.filter(t => t.status === 'open').length;
    renderNav('support');
    draw();
    return true;
  };

  $('#tkq').addEventListener('input', debounce((e) => { S.q = e.target.value; draw(); }, 150));
  $('#tkTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if(!b) return; S.tab = b.dataset.tab; draw(); };
  $('#tkRefresh').onclick = async () => { if(await load()) toast('success', 'Tickets refreshed'); };
  await load();
}

async function viewTicket(view, [id], alive){
  setCrumbs([{ label:'Support', href:'#/support' }, { label:'#' + id }]);
  view.innerHTML = `<div class="page"><div class="card"><div class="card-body">${feedSkeleton(3)}</div></div></div>`;
  const load = async () => {
    let t;
    try{ t = await B.supportTicket(Number(id)); }
    catch(e){
      if(alive()){ view.innerHTML = `<div class="page">${errorState(e)}</div>`; const b = $('[data-act="retry"]', view); if(b) b.onclick = load; }
      return;
    }
    if(!alive()) return;
    const who = displayName(ticketUser(t));
    view.innerHTML = `<div class="page tk-page">
      <div class="page-head"><div><h1 class="tk-title">${esc(t.subject)}</h1>
        <p>#${t.id} · ${esc(TICKET_TYPES[t.type] || 'Other')} · from <a href="#/users/${esc(t.user_id)}">${esc(who)}</a> · opened ${esc(fmtDateTime(t.created_at))}</p></div>
        <div class="page-actions">${ticketPill(t.status)}${t.status === 'closed'
          ? `<button class="btn" id="tkReopen">${I('refresh')}Reopen</button>`
          : `<button class="btn" id="tkCloseT">${I('check')}Close ticket</button>`}</div></div>
      ${t.device ? `<p class="faint tk-device">${I('monitor')}<span>${esc(t.device)}</span></p>` : ''}
      <div class="tk-thread">${(t.messages || []).map(m => `<article class="tk-msg${m.from_staff ? ' staff' : ''}">
          <header>${m.from_staff
            ? `<b>Clarity Journal Support</b>${m.author ? `<span class="faint">by ${esc(m.author)}</span>` : ''}`
            : `${avatar(ticketUser(t), 'sm')}<b>${esc(who)}</b>`}<span class="feed-time">${esc(fmtDateTime(m.created_at))}</span></header>
          <p>${esc(m.body)}</p>
          ${m.image && /^data:image\//.test(m.image) ? `<button type="button" class="tk-img" aria-label="Open the screenshot at full size"><img src="${esc(m.image)}" alt="Screenshot from ${esc(who)}"></button>` : ''}
        </article>`).join('')}</div>
      <div class="card tk-reply"><div class="card-body">
        <label class="tk-label" for="tkReplyIn">Reply</label>
        <textarea class="input" id="tkReplyIn" rows="5" maxlength="4000" placeholder="Write your reply…"></textarea>
        <div class="tk-reply-foot"><span class="faint">${esc(who)} sees this signed “Clarity Journal Support”. Sending marks the ticket Answered.</span>
          <button class="btn btn-primary" id="tkSend">${I('mail')}Send reply</button></div>
      </div></div></div>`;

    $$('.tk-img', view).forEach(b => { b.onclick = () => viewScreenshot(b.querySelector('img').src); });
    const setStatus = async (status, done) => {
      try{ await B.supportSetStatus(t.id, status); toast('success', done); refreshSupportCount(); load(); }
      catch(e){ toast('error', 'Couldn’t update the ticket', errText(e)); }
    };
    if($('#tkReopen', view)) $('#tkReopen', view).onclick = () => setStatus('open', 'Ticket reopened');
    if($('#tkCloseT', view)) $('#tkCloseT', view).onclick = () => setStatus('closed', 'Ticket closed');
    $('#tkSend', view).onclick = async () => {
      const input = $('#tkReplyIn', view), body = input.value.trim();
      if(!body){ toast('error', 'Write a reply first'); input.focus(); return; }
      const b = $('#tkSend', view);
      b.classList.add('loading'); b.disabled = true;
      try{
        await B.supportReply(t.id, body);
        input.value = '';
        toast('success', 'Reply sent', `${who} will see it on their Support page.`);
        refreshSupportCount();
        load();
      }catch(e){ toast('error', 'Couldn’t send the reply', errText(e)); b.classList.remove('loading'); b.disabled = false; }
    };
    // don't lose a reply that's typed but not sent
    dirtyGuard = () => { const i = $('#tkReplyIn'); return !i || !i.value.trim() || confirm('You have a reply you haven’t sent. Leave without sending it?'); };
  };
  await load();
}
function viewScreenshot(src){
  const ov = document.createElement('div');
  ov.className = 'overlay tk-lightbox';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Screenshot at full size');
  ov.innerHTML = `<img src="${esc(src)}" alt="Screenshot at full size">`;
  const close = () => { ov.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if(e.key === 'Escape'){ e.stopPropagation(); close(); } };
  ov.onclick = close;
  addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
}

/* ---------- Settings ---------- */
const TIMEZONES = ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Toronto','Europe/London','Europe/Berlin','Europe/Paris','Asia/Dubai','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];
function supabaseDash(path){
  const ref = (typeof SUPABASE_URL === 'string' && SUPABASE_URL.match(/^https:\/\/([^.]+)\./)) || null;
  return ref ? `https://supabase.com/dashboard/project/${ref[1]}/${path}` : 'https://supabase.com/dashboard';
}
const SETTINGS_SCHEMA = [
  { key:'general', icon:'sliders', desc:'How the platform identifies itself, and how dates appear in this panel.', fields:[
    { k:'platform_name', type:'text', label:'Platform name', help:'Shown in the admin panel header and page titles.' },
    { k:'support_email', type:'email', label:'Support email', help:'Where users should reach you.', placeholder:'support@yourdomain.com' },
    { k:'timezone', type:'select', label:'Default timezone', help:'Used for every date and time in the admin panel.', options: TIMEZONES.map(z => [z, z.replace(/_/g, ' ')]) },
    { k:'date_format', type:'select', label:'Date format', options:[['MMM D, YYYY','Oct 11, 2026'],['D MMM YYYY','11 Oct 2026'],['YYYY-MM-DD','2026-10-11'],['MM/DD/YYYY','10/11/2026']] },
  ]},
  { key:'registration', icon:'userPlus', desc:'Who can create an account. Checked by the database at sign-up, so it can’t be bypassed from the browser.', fields:[
    { k:'open', type:'toggle', label:'Allow new sign-ups', help:'When off, the sign-up form shows an error and no account is created.' },
    { k:'require_approval', type:'toggle', label:'Require admin approval', help:'New accounts start as Pending and can’t use the app until approved.' },
    { k:'allowed_domains', type:'list', label:'Allowed email domains', help:'Comma-separated. Leave empty to allow any domain.', placeholder:'e.g. firm.com, partner.io' },
  ]},
  { key:'maintenance', icon:'alert', desc:'Shows a maintenance screen to everyone except admins while you roll out an update. You can keep using the app, and this panel stays open.', fields:[
    { k:'enabled', type:'toggle', label:'Maintenance mode', help:'Turn it on before you push a larger update, and off again once it’s live.' },
    { k:'title', type:'text', wide:true, max:120, label:'Headline', placeholder:'We’re making Clarity Journal better' },
    { k:'message', type:'textarea', wide:true, max:600, label:'Message', help:'Say what’s happening and what people can expect. Up to 600 characters.', placeholder:'Clarity Journal is offline for a short while so we can roll out a larger update.' },
    { type:'link', label:'Preview the screen', help:'Opens the maintenance page as visitors see it, even while it’s off. Save your wording first.', href: () => '/maintenance?preview', cta:'Preview' },
  ]},
  { key:'authentication', icon:'lock', desc:'Admin session behaviour. Passwords are handled entirely by Supabase Auth and are never visible here.', fields:[
    { k:'admin_idle_timeout_min', type:'select', number:true, label:'Admin idle timeout', help:'Signs staff out of this panel after a period of inactivity.', options:[[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour'],[120,'2 hours']] },
    { type:'link', label:'Password policy & multi-factor auth', help:'Minimum length, leaked-password protection and MFA live in Supabase Auth.', href: () => supabaseDash('auth/providers'), cta:'Open Supabase Auth' },
  ]},
  { key:'email', icon:'mail', desc:'Verification and password-reset emails are sent by Supabase Auth.', fields:[
    { k:'sender_name', type:'text', label:'Sender name', help:'Name used on platform emails.' },
    { k:'reply_to', type:'email', label:'Reply-to address', placeholder:'support@yourdomain.com' },
    { k:'notify_admins_on_signup', type:'toggle', label:'Email admins about new sign-ups', help:'Saved now; takes effect once an outbound email function is connected.' },
    { type:'link', label:'Email templates', help:'Edit the wording of verification and reset emails.', href: () => supabaseDash('auth/templates'), cta:'Edit templates' },
  ]},
  { key:'security', icon:'shield', desc:'Protections applied automatically by the database.', fields:[
    { k:'revoke_sessions_on_suspend', type:'toggle', label:'Sign out suspended users', help:'Ends every session the moment an account is suspended or deactivated.' },
    { k:'audit_retention_days', type:'select', number:true, label:'Audit log retention', help:'Older entries are removed automatically.', options:[[90,'90 days'],[180,'180 days'],[365,'1 year'],[730,'2 years']] },
  ]},
  { key:'permissions', icon:'shieldCheck', desc:'What moderators can do. Admins always have every permission. Enforced on the server for every request.' },
];
async function viewSettings(view, _, alive){
  setCrumbs([{ label:'System Settings' }]);
  const readOnly = !can('manage_settings');
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>System Settings</h1><p>Platform-wide configuration. Every change is recorded in the audit log.</p></div></div>
    ${readOnly ? `<div class="notice notice-info" style="margin-bottom:16px">${I('lock')}<span>Only admins can change settings. You’re viewing them read-only.</span></div>` : ''}
    <div class="settings-layout"><nav class="settings-nav" id="setNav">${SETTINGS_SCHEMA.map((s, i) => `<a href="#/settings" data-sec="${s.key}" class="${i === 0 ? 'on' : ''}">${I(s.icon)}${esc(SECTION_TITLES[s.key])}</a>`).join('')}</nav>
    <div id="setBody">${SETTINGS_SCHEMA.map(() => `<div class="card set-section" style="padding:18px;margin-bottom:16px">${sk('30%', 14)}<div style="height:16px"></div>${sk('100%', 34)}<div style="height:10px"></div>${sk('100%', 34)}</div>`).join('')}</div></div></div>`;
  let data;
  try{ data = await B.settings(); }
  catch(e){ if(alive()){ $('#setBody').innerHTML = `<div class="card">${errorState(e)}</div>`; $('[data-act="retry"]', view).onclick = rerender; } return; }
  if(!alive()) return;
  settings = data;
  const working = JSON.parse(JSON.stringify(data));
  const dis = readOnly ? 'disabled' : '';

  const control = (sec, f) => {
    const v = (working[sec] || {})[f.k];
    const id = `f-${sec}-${f.k}`;
    if(f.type === 'toggle') return `<label class="switch"><input type="checkbox" id="${id}" data-sec="${sec}" data-k="${f.k}" data-t="toggle" ${v ? 'checked' : ''} ${dis} aria-label="${esc(f.label)}"><span></span></label>`;
    if(f.type === 'select') return `<select class="select" id="${id}" data-sec="${sec}" data-k="${f.k}" data-t="${f.number ? 'number' : 'text'}" ${dis} aria-label="${esc(f.label)}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
    if(f.type === 'list') return `<input class="input" id="${id}" data-sec="${sec}" data-k="${f.k}" data-t="list" value="${esc((v || []).join(', '))}" placeholder="${esc(f.placeholder || '')}" ${dis} aria-label="${esc(f.label)}">`;
    if(f.type === 'textarea') return `<textarea class="input" id="${id}" rows="4" data-sec="${sec}" data-k="${f.k}" data-t="text" placeholder="${esc(f.placeholder || '')}" maxlength="${f.max || 600}" ${dis} aria-label="${esc(f.label)}">${esc(v || '')}</textarea>`;
    return `<input class="input" id="${id}" type="${f.type === 'email' ? 'email' : 'text'}" data-sec="${sec}" data-k="${f.k}" data-t="text" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}" maxlength="${f.max || 120}" ${dis} aria-label="${esc(f.label)}">`;
  };
  const section = (s) => {
    let body;
    if(s.key === 'permissions'){
      const m = (working.permissions && working.permissions.moderator) || {};
      const rows = [
        ['view_users', 'View users and statistics', 'Dashboard, user list and profiles', 'always'],
        ['approve_users', 'Approve and reject sign-ups', 'Act on the Pending Users queue'],
        ['manage_users', 'Manage accounts', 'Suspend, activate, deactivate, edit, reset passwords and set tab access'],
        ['view_activity', 'View the audit log', 'Activity page and per-user history'],
        ['manage_roles', 'Change roles', 'Promote or demote staff', 'never'],
        ['delete_users', 'Delete accounts', 'Permanently remove users and their data', 'never'],
        ['manage_settings', 'Change system settings', 'Everything on this page', 'never'],
      ];
      const lock = (on) => on ? `<span class="lockcheck" data-tip="Always on">${I('check')}</span>` : `<span class="faint" data-tip="Admins only" style="display:inline-flex">${I('lock')}</span>`;
      body = `<div class="table-wrap"><table class="matrix"><thead><tr><th>Permission</th><th>Moderator</th><th>Admin</th></tr></thead><tbody>${rows.map(([k, l, sub, fixed]) => `<tr>
        <td>${esc(l)}<span>${esc(sub)}</span></td>
        <td>${fixed === 'always' ? lock(true) : fixed === 'never' ? lock(false) : `<label class="switch"><input type="checkbox" data-sec="permissions" data-k="moderator.${k}" data-t="toggle" ${m[k] ? 'checked' : ''} ${dis} aria-label="Moderators: ${esc(l)}"><span></span></label>`}</td>
        <td>${lock(true)}</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      body = s.fields.map(f => f.type === 'link'
        ? `<div class="set-row"><div class="lbl"><b>${esc(f.label)}</b><span>${esc(f.help)}</span></div><div class="ctl"><a class="btn btn-sm" href="${esc(f.href())}" target="_blank" rel="noopener noreferrer">${esc(f.cta)}${I('external')}</a></div></div>`
        : `<div class="set-row${f.wide ? ' set-row-wide' : ''}"><div class="lbl"><b><label for="f-${s.key}-${f.k}">${esc(f.label)}</label></b>${f.help ? `<span>${esc(f.help)}</span>` : ''}</div><div class="ctl">${control(s.key, f)}</div></div>`).join('');
    }
    return `<section class="card set-section" id="sec-${s.key}" aria-labelledby="h-${s.key}">
      <div class="card-head" style="padding-bottom:14px;border-bottom:1px solid var(--border)"><div><h2 id="h-${s.key}">${esc(SECTION_TITLES[s.key])}</h2><p>${esc(s.desc)}</p></div></div>
      <div>${body}</div>
      ${readOnly ? '' : `<div class="set-foot"><span class="dirty" hidden>Unsaved changes</span><button class="btn btn-sm btn-ghost" data-reset="${s.key}" disabled>Discard</button><button class="btn btn-sm btn-primary" data-save="${s.key}" disabled>Save changes</button></div>`}
    </section>`;
  };
  $('#setBody').innerHTML = SETTINGS_SCHEMA.map(section).join('');

  const isDirty = (k) => JSON.stringify(working[k]) !== JSON.stringify(settings[k]);
  const syncDirty = (k) => {
    const sec = $(`#sec-${k}`); if(!sec || readOnly) return;
    const d = isDirty(k);
    $('.dirty', sec).hidden = !d; $(`[data-save="${k}"]`, sec).disabled = !d; $(`[data-reset="${k}"]`, sec).disabled = !d;
  };
  const anyDirty = () => SETTINGS_SCHEMA.some(s => isDirty(s.key));
  dirtyGuard = () => !anyDirty() || confirm('You have unsaved settings. Leave without saving?');
  const onUnload = (e) => { if(anyDirty()){ e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', onUnload);

  $('#setBody').addEventListener('input', (e) => {
    const el = e.target; const sec = el.dataset.sec; if(!sec) return;
    let v = el.dataset.t === 'toggle' ? el.checked : el.dataset.t === 'number' ? +el.value
      : el.dataset.t === 'list' ? el.value.split(/[\s,]+/).map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean) : el.value;
    working[sec] = working[sec] || {};
    if(el.dataset.k.includes('.')){
      const [a, b] = el.dataset.k.split('.');
      working[sec][a] = { ...(working[sec][a] || {}), [b]: v };
    } else working[sec][el.dataset.k] = v;
    syncDirty(sec);
  });
  $('#setBody').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-reset]');
    if(r){
      const k = r.dataset.reset;
      working[k] = JSON.parse(JSON.stringify(settings[k]));
      const sec = $(`#sec-${k}`);
      sec.outerHTML = section(SETTINGS_SCHEMA.find(s => s.key === k));
      syncDirty(k); return;
    }
    const b = e.target.closest('[data-save]'); if(!b) return;
    const k = b.dataset.save;
    const val = working[k];
    if(k === 'general' && val.support_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.support_email)){ toast('error', 'Check the support email', 'That doesn’t look like a valid address.'); return; }
    if(k === 'email' && val.reply_to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.reply_to)){ toast('error', 'Check the reply-to address', 'That doesn’t look like a valid address.'); return; }
    if(k === 'registration' && val.open === false && settings.registration && settings.registration.open !== false){
      const ok = await modal({ icon:'alert', tone:'amber', title:'Close registration?', desc:'Nobody new will be able to create an account until you turn sign-ups back on. Existing users aren’t affected.', confirmLabel:'Close registration', confirmClass:'btn-warn' });
      if(!ok) return;
    }
    if(k === 'maintenance' && val.enabled && !(settings.maintenance && settings.maintenance.enabled)){
      const ok = await modal({ icon:'alert', tone:'amber', title:'Turn on maintenance mode?', desc:'Everyone except admins is sent to the maintenance screen the next time they open Clarity Journal. People who already have it open stay on their page until they refresh. Remember to turn it off when you’re done.', confirmLabel:'Turn on', confirmClass:'btn-warn' });
      if(!ok) return;
    }
    if(k === 'registration' && val.require_approval === false && settings.registration && settings.registration.require_approval !== false){
      const ok = await modal({ icon:'alert', tone:'amber', title:'Turn off approval?', desc:'New sign-ups will get access to Clarity Journal immediately, without review.', confirmLabel:'Turn off approval', confirmClass:'btn-warn' });
      if(!ok) return;
    }
    b.classList.add('loading'); b.disabled = true;
    try{
      await B.updateSettings(k, val);
      settings[k] = JSON.parse(JSON.stringify(val));
      if(k === 'authentication') perms.idle_timeout_min = val.admin_idle_timeout_min;
      if(k === 'general') applyGeneral();
      toast('success', `${SECTION_TITLES[k]} settings saved`);
    }catch(err){ toast('error', 'Couldn’t save settings', errText(err)); }
    b.classList.remove('loading'); syncDirty(k);
  });
  // section nav: smooth scroll + highlight
  $('#setNav').addEventListener('click', (e) => {
    const a = e.target.closest('[data-sec]'); if(!a) return; e.preventDefault();
    $(`#sec-${a.dataset.sec}`).scrollIntoView({ behavior:'smooth', block:'start' });
  });
  const io = new IntersectionObserver((ents) => {
    ents.forEach(en => { if(en.isIntersecting){ const k = en.target.id.slice(4); $$('#setNav a').forEach(a => a.classList.toggle('on', a.dataset.sec === k)); } });
  }, { rootMargin:'-80px 0px -65% 0px' });
  $$('.set-section').forEach(s => io.observe(s));
  const stop = () => { if(!view.contains($('#setBody'))){ io.disconnect(); removeEventListener('beforeunload', onUnload); removeEventListener('hashchange', stop); } };
  addEventListener('hashchange', stop);
}
function applyGeneral(){
  const g = settings.general || {};
  try{ if(g.timezone){ new Intl.DateTimeFormat('en-US', { timeZone: g.timezone }); tz = g.timezone; } }catch(e){ tz = undefined; }
  dateStyle = g.date_format || dateStyle;
  document.title = `Admin · ${g.platform_name || 'Clarity Journal'}`;
}

/* ---------------- setup-needed / boot ---------------- */
function renderSetupNeeded(){
  $('#app').dataset.state = 'ready';
  $('#nav').innerHTML = '';
  setCrumbs([{ label:'Setup' }]);
  $('#view').innerHTML = `<div class="page center-state"><div class="card"><div class="card-body" style="padding:28px">
    <div class="modal-icon tone-violet">${I('database')}</div>
    <h1 style="font-size:18px;margin:0 0 6px">Finish the database setup</h1>
    <p class="muted" style="margin:0 0 6px;font-size:13.5px">The admin panel uses secure database functions that aren’t installed on this project yet.
      Run <span class="mono" style="color:var(--text)">admin-schema.sql</span> in the Supabase SQL editor, then reload this page.</p>
    <p class="faint" style="font-size:12.5px;margin:0 0 18px">It adds roles, the audit log and settings. It doesn’t change or remove any existing user or journal data.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-primary" href="${esc(supabaseDash('sql/new'))}" target="_blank" rel="noopener noreferrer">${I('external')}Open SQL editor</a>
      <button class="btn" onclick="location.reload()">${I('refresh')}Reload</button></div>
  </div></div></div>`;
}
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function boot(){
  window.hydrateIcons();
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  if(local && new URLSearchParams(location.search).has('demo')){
    await loadScript('/admin-demo.js');
    B = window.DemoBackend;
    $('#demoBanner').hidden = false;
  }

  // 1. who is this? (redirects mirror requireAdmin() in shared-auth.js)
  me = await B.me();
  if(!me){ location.replace('/signin'); return; }
  if(me.status !== 'approved'){ if(!B.demo) await sb.auth.signOut(); location.replace('/signin?state=' + encodeURIComponent(me.status)); return; }
  if(me.role !== 'admin' && me.role !== 'moderator'){ location.replace('/'); return; }

  // 2. what may they do? (server-computed)
  try{ perms = await B.perms(); }
  catch(e){
    if(schemaMissing(e) && me.role === 'admin'){ renderSetupNeeded(); fillMe(); return; }
    $('#app').dataset.state = 'ready';
    $('#view').innerHTML = `<div class="page center-state">${errorState(e)}</div>`;
    $('[data-act="retry"]').onclick = () => location.reload();
    return;
  }
  if(!perms || !perms.role){ location.replace('/'); return; }
  try{ settings = await B.settings(); applyGeneral(); }catch(e){}

  fillMe();
  B.logEvent('admin_signed_in').catch(() => {});
  startIdleTimer();

  // shell wiring
  setCollapsed(localStorageGet('cj-admin-sidebar') === 'collapsed');
  $('#collapseBtn').onclick = toggleSidebar;
  wideScreen.addEventListener('change', () => setCollapsed($('#app').classList.contains('collapsed')));
  $('#menuBtn').onclick = () => $('#app').classList.toggle('nav-open');
  $('#scrim').onclick = () => $('#app').classList.remove('nav-open');
  $('#meBtn').onclick = (e) => accountMenu(e.currentTarget);
  $('#topAvatarBtn').onclick = (e) => accountMenu(e.currentTarget);
  $('#signOutBtn').onclick = signOut;
  $('#searchBtn').onclick = openPalette;
  $('#notifBtn').onclick = (e) => openNotifications(e.currentTarget);
  $('#searchKbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  document.addEventListener('keydown', (e) => {
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); openPalette(); return; }
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && wideScreen.matches && !modalStack
       && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){ e.preventDefault(); toggleSidebar(); return; }
    if(e.key === '/' && !modalStack && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('.palette')){ e.preventDefault(); openPalette(); }
    if(e.key === 'Escape'){ closeLayer(); $('#app').classList.remove('nav-open'); }
  });

  $('#app').dataset.state = 'ready';
  addEventListener('hashchange', route);
  route();
  getUsers().catch(() => {});
  refreshSupportCount();
  // keep the pending and support badges fresh while the tab is visible
  setInterval(() => { if(document.visibilityState === 'visible'){ getUsers(true).catch(() => {}); refreshSupportCount(); } }, 60000);
}
function fillMe(){
  $('#meAvatar').outerHTML = avatar(me, 'sm');
  $('#topAvatar').outerHTML = avatar(me, 'sm');
  $('#meName').textContent = displayName(me);
  $('#meRole').textContent = (ROLES[me.role] || {}).label || me.role;
}

boot().catch((e) => {
  console.error(e);
  $('#app').dataset.state = 'ready';
  $('#view').innerHTML = `<div class="page center-state">${errorState(e)}</div>`;
  const b = $('[data-act="retry"]'); if(b) b.onclick = () => location.reload();
});
})();
