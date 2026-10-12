/* Clarity Journal admin — in-memory demo backend.
   Only loaded on localhost with ?demo in the URL. Mirrors the shape of the
   Supabase RPCs in schema.sql so every screen can be previewed without an
   admin login. Nothing here touches the network. */
(function(){
  let seed = 20261011;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(rnd() * 16).toString(16));
  const DAY = 86400000;
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
  const wait = (ms) => new Promise(r => setTimeout(r, ms ?? (180 + rnd() * 260)));

  const FIRST = ['Ava','Liam','Noah','Mia','Ethan','Zoe','Lucas','Chloe','Mason','Aria','Leo','Nora','Owen','Ivy','Eli','Maya','Kai','Ruby','Jude','Iris','Theo','Luna','Finn','Elena','Caleb','Sofia','Jonah','Hazel','Miles','Stella','Adam','Leah','Ryan','Clara','Omar','Nina','Victor','Grace','Isaac','Jade','Felix','Ella','Hugo','Alice','Marco','Ines','Dmitri','Priya','Kenji','Sara','Tariq','Yuki','Mateo','Lena','Arjun','Freya','Diego','Hana'];
  const LAST  = ['Chen','Patel','Novak','Reyes','Kowalski','Okafor','Laurent','Silva','Haas','Morgan','Ito','Brennan','Duarte','Fischer','Kim','Rossi','Varga','Nguyen','Ahmed','Lindqvist','Moreau','Costa','Becker','Tanaka','Walsh','Romero','Singh','Jensen'];
  const DOMAINS = ['gmail.com','outlook.com','icloud.com','proton.me','fastmail.com','yahoo.com'];
  const UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  ];
  const ip = () => pick(['203.0.113.','198.51.100.','192.0.2.']) + Math.floor(rnd() * 250 + 2);

  // ---------- users ----------
  const me = { id: uuid(), email: 'focus@clarityjournal.trade', username: 'focus', role: 'admin', status: 'approved' };
  const users = [];
  users.push({ ...me, created_at: iso(now - 190 * DAY), status_reason: null, status_changed_at: null });
  users.push({ id: uuid(), email: 'marcus.hale@proton.me', username: 'marcus_h', role: 'moderator', status: 'approved', created_at: iso(now - 160 * DAY) });
  const used = new Set();
  for(let i = 0; i < 64; i++){
    let f, l; do { f = pick(FIRST); l = pick(LAST); } while(used.has(f + l)); used.add(f + l);
    const age = Math.pow(rnd(), 1.6) * 175 + 0.2;           // more recent sign-ups than old ones
    const r = rnd();
    let status = r < .72 ? 'approved' : r < .84 ? 'pending' : r < .93 ? 'suspended' : 'deactivated';
    if(age < 3 && rnd() < .7) status = 'pending';
    if(status === 'pending' && age > 25) status = 'approved';
    const uname = (f + (rnd() < .5 ? '_' + l : l.slice(0, 1) + Math.floor(rnd() * 90 + 10))).toLowerCase().slice(0, 20);
    users.push({
      id: uuid(), email: `${f}.${l}`.toLowerCase() + (rnd() < .3 ? Math.floor(rnd() * 99) : '') + '@' + pick(DOMAINS),
      username: rnd() < .93 ? uname : null, role: 'user', status,
      created_at: iso(now - age * DAY),
      status_reason: status === 'suspended' ? pick(['Chargeback on subscription', 'Shared account credentials', 'Repeated abuse reports']) : null,
      status_changed_at: status === 'suspended' || status === 'deactivated' ? iso(now - age * DAY * rnd() * .5) : null,
    });
  }

  // ---------- trading activity ----------
  const tradeDays = []; // {user_id, day, n}
  const lastData = {};
  users.forEach(u => {
    if(u.status === 'pending') return;
    const created = Date.parse(u.created_at);
    const engagement = u.id === me.id ? .7 : rnd();
    const churnAt = engagement < .35 ? created + rnd() * 40 * DAY : now;
    for(let t = created; t < Math.min(now, churnAt); t += DAY){
      const wd = new Date(t).getUTCDay();
      if(wd === 0 || wd === 6) continue;
      if(rnd() < engagement * .75){
        tradeDays.push({ user_id: u.id, day: dayStr(t), n: 1 + Math.floor(rnd() * (2 + engagement * 6)) });
        lastData[u.id] = Math.max(lastData[u.id] || 0, t + rnd() * DAY * .6);
      }
    }
  });

  const sessions = {};
  users.forEach(u => {
    if(u.status !== 'approved') return;
    const k = u.id === me.id ? 2 : rnd() < .55 ? 1 + Math.floor(rnd() * 2) : 0;
    sessions[u.id] = Array.from({length: k}, () => {
      const created = now - rnd() * 20 * DAY;
      return { id: uuid(), created_at: iso(created), last_seen: iso(Math.max(created, now - rnd() * 3 * DAY)), ip: ip(), user_agent: pick(UAS), aal: 'aal1' };
    });
  });
  const lastSignIn = {};
  users.forEach(u => {
    if(u.status === 'pending' && rnd() < .5) return;
    const created = Date.parse(u.created_at);
    lastSignIn[u.id] = Math.min(now, Math.max(created + DAY * .01, (lastData[u.id] || created) - rnd() * DAY));
  });
  const journalCount = {};
  users.forEach(u => { journalCount[u.id] = u.status === 'pending' ? 0 : Math.floor(rnd() * 40); });
  const emailConfirmed = {};
  users.forEach(u => { emailConfirmed[u.id] = u.status !== 'pending' || rnd() < .6; });

  // ---------- audit log ----------
  let auditSeq = 1;
  const audit = [];
  const label = (u) => u ? (u.username || u.email) : null;
  const byId = (id) => users.find(u => u.id === id);
  const mod = users[1];
  function pushAudit(at, event, actor, target, detail, meta){
    audit.push({
      id: auditSeq++, created_at: iso(Math.min(at, Date.now() - 60000)), event,
      actor_id: actor ? actor.id : null, actor_label: label(actor),
      target_id: target ? target.id : null, target_label: target ? label(target) : (detail && detail.__label) || null,
      detail: detail ? Object.fromEntries(Object.entries(detail).filter(([k]) => k !== '__label')) : {},
      ip: meta === null ? null : (meta && meta.ip) || ip(), user_agent: meta === null ? null : (meta && meta.ua) || pick(UAS),
    });
  }
  users.forEach(u => {
    const t = Date.parse(u.created_at);
    pushAudit(t, 'user_registered', null, u, { status: 'pending' }, null);
    if(u.status !== 'pending' && u.id !== me.id){
      const approver = rnd() < .75 ? users[0] : mod;
      pushAudit(t + rnd() * DAY * 1.5, 'user_approved', approver, u, { from: 'pending', to: 'approved' });
    }
    if(u.status === 'suspended') pushAudit(Date.parse(u.status_changed_at || u.created_at) + DAY, 'user_suspended', users[0], u, { from: 'approved', to: 'suspended', reason: u.status_reason });
    if(u.status === 'deactivated') pushAudit(Date.parse(u.status_changed_at || u.created_at) + DAY, 'user_deactivated', users[0], u, { from: 'approved', to: 'deactivated' });
  });
  pushAudit(now - 150 * DAY, 'role_changed', users[0], mod, { from: 'user', to: 'moderator' });
  for(let i = 0; i < 9; i++){ const u = pick(users.filter(x => x.status === 'approved')); pushAudit(now - rnd() * 60 * DAY, 'password_reset_sent', pick([users[0], mod]), u, {}); }
  for(let i = 0; i < 3; i++){ pushAudit(now - rnd() * 90 * DAY, 'user_deleted', users[0], null, { __label: pick(FIRST).toLowerCase() + '_' + pick(LAST).toLowerCase(), email: 'removed@example.com', role: 'user' }); }
  for(let i = 0; i < 40; i++){ const a = rnd() < .7 ? users[0] : mod; pushAudit(now - rnd() * 90 * DAY, 'admin_signed_in', a, null, {}); }
  pushAudit(now - 12 * DAY, 'settings_updated', users[0], null, { __label: 'registration', changed: ['require_approval'] });
  pushAudit(now - 30 * DAY, 'settings_updated', users[0], null, { __label: 'security', changed: ['audit_retention_days'] });
  pushAudit(now - 4 * DAY, 'sessions_revoked', users[0], pick(users.filter(x => x.status === 'suspended')) || users[2], { sessions: 2 });
  audit.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).forEach((a, i) => a.id = i + 1);
  auditSeq = audit.length + 1;

  let settings = {
    general:        { platform_name: 'Clarity Journal', support_email: 'support@clarityjournal.trade', timezone: 'America/New_York', date_format: 'MMM D, YYYY' },
    registration:   { open: true, require_approval: true, allowed_domains: [] },
    authentication: { admin_idle_timeout_min: 30, username_login: true },
    email:          { sender_name: 'Clarity Journal', reply_to: '', notify_admins_on_signup: false },
    security:       { revoke_sessions_on_suspend: true, audit_retention_days: 365 },
    permissions:    { moderator: { approve_users: true, view_activity: true, manage_users: false } },
  };

  // ---------- site error reports ----------
  let errSeq = 1;
  const errUser = () => rnd() < .35 ? null : pick(users.filter(u => u.status === 'approved')).id;
  const errors = [
    ['error',    "Cannot read properties of undefined (reading 'pnl')", '/', 'at renderCalendar (index.html:5012:18)', 6, 0.2],
    ['resource', 'Failed to load image: /feature-econ.webp',            '/login', 'IMG src=/feature-econ.webp', 14, 1.5],
    ['console',  'Save failed: network request timed out',               '/', 'Store.set journalPages', 3, 3],
    ['promise',  'Unhandled rejection: Failed to fetch',                 '/', 'econ-calendar function', 2, 8],
    ['warning',  'Economic calendar served from the saved copy',         '/', '', 9, 12],
    ['resource', 'Failed to load script: /admin-charts.js',              '/admin', 'SCRIPT src=/admin-charts.js', 1, 26],
  ].map(([kind, message, page, detail, hits, daysAgo]) => {
    const last = now - daysAgo * DAY;
    return { id: errSeq++, kind, message, page, detail, hits, user_id: errUser(), browser: pick(UAS),
      last_seen: iso(last), first_seen: iso(last - (hits > 1 ? rnd() * 4 * DAY : 0)) };
  });

  // ---------- helpers mirroring SQL ----------
  const fail = (msg) => { const e = new Error(msg); e.code = 'P0001'; throw e; };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const activeAdmins = () => users.filter(u => u.role === 'admin' && u.status === 'approved');
  function writeAudit(event, target, detail){ pushAudit(Date.now(), event, byId(me.id), target, detail, { ip: '203.0.113.24', ua: navigator.userAgent }); }
  function row(u){
    const td = tradeDays.filter(t => t.user_id === u.id);
    const s = (sessions[u.id] || []);
    const seen = Math.max(lastSignIn[u.id] || 0, lastData[u.id] || 0, ...s.map(x => Date.parse(x.last_seen)));
    return {
      id: u.id, email: u.email, username: u.username, role: u.role, status: u.status, created_at: u.created_at,
      status_reason: u.status_reason || null, status_changed_at: u.status_changed_at || null,
      last_sign_in_at: lastSignIn[u.id] ? iso(lastSignIn[u.id]) : null,
      last_active_at: seen ? iso(seen) : null,
      email_confirmed: !!emailConfirmed[u.id],
      trades: td.reduce((a, t) => a + t.n, 0), journal_entries: journalCount[u.id] || 0, active_sessions: s.length,
    };
  }
  function guardChange(u, next){
    if(u.id === me.id) fail('You can\'t change your own role or status.');
    if(u.role === 'admin' && u.status === 'approved' && (next.role !== 'admin' || next.status !== 'approved') && activeAdmins().length <= 1) fail('At least one active admin is required.');
  }
  function setStatusOne(id, status, reason){
    const u = byId(id); if(!u) fail('User not found.');
    guardChange(u, { role: u.role, status });
    const from = u.status;
    if(from === status) return;
    u.status = status; u.status_reason = reason || null; u.status_changed_at = iso(Date.now());
    const ev = from === 'pending' && status === 'approved' ? 'user_approved'
      : from === 'pending' && status === 'deactivated' ? 'user_rejected'
      : status === 'approved' ? 'user_activated' : status === 'suspended' ? 'user_suspended' : status === 'deactivated' ? 'user_deactivated' : 'status_changed';
    const d = { from, to: status }; if(reason) d.reason = reason;
    writeAudit(ev, u, d);
    if((status === 'suspended' || status === 'deactivated') && settings.security.revoke_sessions_on_suspend) sessions[u.id] = [];
  }

  // a few accounts with tabs switched off (Tab Access)
  users.forEach(u => { u.hidden_tabs = u.id !== me.id && rnd() < .18 ? [pick(['tax', 'econ', 'consistency', 'analytics'])] : []; });
  users.forEach(u => { u.delete_perms = u.role !== 'admin' && rnd() < .1 ? ['payouts'] : []; });

  window.DemoBackend = {
    demo: true,
    async me(){ await wait(80); return clone(me); },
    async perms(){ await wait(60); return { role: 'admin', view_users: true, approve_users: true, manage_users: true, view_activity: true, manage_roles: true, delete_users: true, manage_settings: true, idle_timeout_min: settings.authentication.admin_idle_timeout_min }; },
    async overview(){
      await wait();
      const c = (f) => users.filter(f).length;
      const sum = (f) => tradeDays.filter(f).reduce((a, t) => a + t.n, 0);
      const today = dayStr(now);
      const dAgo = (k) => dayStr(now - k * DAY);
      const live = Object.entries(sessions).filter(([, s]) => s.some(x => Date.parse(x.last_seen) > now - DAY));
      return {
        total: users.length, total_30d_ago: c(u => Date.parse(u.created_at) < now - 30 * DAY),
        active: c(u => u.status === 'approved'), pending: c(u => u.status === 'pending'),
        suspended: c(u => u.status === 'suspended'), deactivated: c(u => u.status === 'deactivated'),
        new_7d: c(u => Date.parse(u.created_at) >= now - 7 * DAY), new_prev_7d: c(u => { const t = Date.parse(u.created_at); return t >= now - 14 * DAY && t < now - 7 * DAY; }),
        trades: sum(() => true), trades_7d: sum(t => t.day > dAgo(7) && t.day <= today), trades_prev_7d: sum(t => t.day > dAgo(14) && t.day <= dAgo(7)),
        sessions: live.reduce((a, [, s]) => a + s.filter(x => Date.parse(x.last_seen) > now - DAY).length, 0), sessions_users: live.length,
      };
    },
    async listUsers(){ await wait(); return users.map(row); },
    async userDetail(id){
      await wait();
      const u = byId(id); if(!u) return { user: null };
      const weekStart = (t) => { const d = new Date(t); const wd = (d.getUTCDay() + 6) % 7; d.setUTCHours(0,0,0,0); return d.getTime() - wd * DAY; };
      const cur = weekStart(now);
      const weekly = Array.from({length: 12}, (_, k) => {
        const w = cur - (11 - k) * 7 * DAY;
        return { week: dayStr(w), n: tradeDays.filter(t => t.user_id === id && Date.parse(t.day) >= w && Date.parse(t.day) < w + 7 * DAY).reduce((a, t) => a + t.n, 0) };
      });
      const mine = tradeDays.filter(t => t.user_id === id);
      return {
        user: row(u), sessions: clone(sessions[id] || []), weekly_trades: weekly,
        last_trade: mine.length ? mine.map(t => t.day).sort().pop() : null, trading_days: mine.length,
        events: clone(audit.filter(a => a.target_id === id).sort((a, b) => b.id - a.id).slice(0, 25)),
      };
    },
    async analytics(days){
      await wait(320);
      const series = [];
      for(let k = days - 1; k >= 0; k--){
        const t = now - k * DAY, d = dayStr(t);
        const td = tradeDays.filter(x => x.day === d);
        series.push({
          day: d,
          signups: users.filter(u => u.created_at.slice(0, 10) === d).length,
          users: users.filter(u => u.created_at.slice(0, 10) <= d).length,
          trades: td.reduce((a, x) => a + x.n, 0),
          active: new Set(td.map(x => x.user_id)).size,
          events: audit.filter(a => a.created_at.slice(0, 10) === d).length,
        });
      }
      const distinctSince = (k) => new Set(tradeDays.filter(x => x.day > dayStr(now - k * DAY)).map(x => x.user_id)).size;
      const weekStart = (t) => { const d = new Date(t); const wd = (d.getUTCDay() + 6) % 7; d.setUTCHours(0,0,0,0); return d.getTime() - wd * DAY; };
      const cur = weekStart(now);
      const cohorts = [];
      for(let c = 7; c >= 0; c--){
        const w = cur - c * 7 * DAY;
        const members = users.filter(u => weekStart(Date.parse(u.created_at)) === w);
        if(!members.length) continue;
        const weeks = [];
        for(let k = 0; k <= c; k++){
          const a = w + k * 7 * DAY, b = a + 7 * DAY;
          weeks.push(members.filter(m => tradeDays.some(t => t.user_id === m.id && Date.parse(t.day) >= a && Date.parse(t.day) < b)).length);
        }
        cohorts.push({ week: dayStr(w), size: members.length, weeks });
      }
      const c = (s) => users.filter(u => u.status === s).length;
      return { days, series, wau: distinctSince(7), mau: distinctSince(30), cohorts,
        status: { active: c('approved'), pending: c('pending'), suspended: c('suspended'), deactivated: c('deactivated') } };
    },
    async activity({ search = '', event = '', sinceDays = 0, page = 1, pageSize = 25 } = {}){
      await wait();
      const q = search.trim().toLowerCase();
      let list = audit.slice().sort((a, b) => b.id - a.id);
      if(event) list = list.filter(a => event.split(',').includes(a.event));
      if(sinceDays) list = list.filter(a => Date.parse(a.created_at) >= now - sinceDays * DAY);
      if(q) list = list.filter(a => [a.target_label, a.actor_label, a.ip].join(' ').toLowerCase().includes(q));
      return { rows: clone(list.slice((page - 1) * pageSize, page * pageSize)), total: list.length };
    },
    async settings(){ await wait(); return clone(settings); },

    async setStatus(ids, status, reason){
      await wait(420);
      let n = 0;
      for(const id of ids){ if(id === me.id) continue; setStatusOne(id, status, reason); n++; }
      return n;
    },
    async setRole(id, role){
      await wait(380);
      const u = byId(id); if(!u) fail('User not found.');
      guardChange(u, { role, status: u.status });
      const from = u.role; if(from === role) return;
      u.role = role; writeAudit('role_changed', u, { from, to: role });
    },
    async updateProfile(id, username){
      await wait(380);
      const u = byId(id); if(!u) fail('User not found.');
      const v = (username || '').trim() || null;
      if(v && !/^[A-Za-z0-9_]{2,20}$/.test(v)) fail('Usernames are 2–20 letters, numbers or underscores.');
      if(v && users.some(x => x.id !== id && (x.username || '').toLowerCase() === v.toLowerCase())) fail('That username is already taken.');
      if(v === u.username) return;
      const from = u.username; u.username = v;
      writeAudit('profile_updated', u, { field: 'username', from, to: v });
    },
    async deleteUsers(ids){
      await wait(520);
      if(ids.includes(me.id)) fail('You can\'t delete your own account.');
      let n = 0;
      ids.forEach(id => {
        const i = users.findIndex(u => u.id === id); if(i < 0) return;
        const u = users[i];
        if(u.role === 'admin' && u.status === 'approved' && activeAdmins().length <= 1) fail('At least one active admin is required.');
        writeAudit('user_deleted', u, { email: u.email, role: u.role });
        users.splice(i, 1); delete sessions[id]; n++;
        for(let k = tradeDays.length - 1; k >= 0; k--) if(tradeDays[k].user_id === id) tradeDays.splice(k, 1);
      });
      return n;
    },
    async revokeSessions(id){
      await wait(380);
      const n = (sessions[id] || []).length; sessions[id] = [];
      writeAudit('sessions_revoked', byId(id), { sessions: n });
      return n;
    },
    async resetPassword(u){
      await wait(500);
      writeAudit('password_reset_sent', byId(u.id), {});
    },
    async logEvent(event, targetId, detail){
      if(event === 'admin_signed_in') return;
      writeAudit(event, targetId ? byId(targetId) : null, detail || {});
    },
    async updateSettings(key, value){
      await wait(450);
      const old = settings[key] || {};
      const changed = Object.keys(value).filter(k => JSON.stringify(old[k]) !== JSON.stringify(value[k]));
      settings[key] = clone(value);
      pushAudit(Date.now(), 'settings_updated', byId(me.id), null, { __label: key, changed }, { ip: '203.0.113.24', ua: navigator.userAgent });
    },
    async tabAccess(){ await wait(); return users.map(u => ({ id: u.id, hidden_tabs: clone(u.hidden_tabs || []), delete_perms: clone(u.delete_perms || []) })); },
    async setDeleteAccess(ids, perm, allowed){
      await wait(300);
      let n = 0;
      ids.forEach(id => {
        const u = byId(id); if(!u) return;
        const has = (u.delete_perms || []).includes(perm);
        if(has === allowed) return; // nothing to change
        u.delete_perms = allowed ? [...(u.delete_perms || []), perm] : u.delete_perms.filter(p => p !== perm);
        n++;
      });
      if(n) writeAudit('delete_access_changed', ids.length === 1 ? byId(ids[0]) : null, ids.length === 1 ? { perm, allowed } : { perm, allowed, count: n, __label: n + ' users' });
      return n;
    },
    async setTabAccess(ids, tab, allowed){
      await wait(300);
      let n = 0;
      ids.forEach(id => {
        const u = byId(id); if(!u) return;
        const off = (u.hidden_tabs || []).includes(tab);
        if(off !== allowed) return; // nothing to change
        u.hidden_tabs = allowed ? u.hidden_tabs.filter(t => t !== tab) : [...(u.hidden_tabs || []), tab];
        n++;
      });
      if(n) writeAudit('tab_access_changed', ids.length === 1 ? byId(ids[0]) : null, ids.length === 1 ? { tab, allowed } : { tab, allowed, count: n, __label: n + ' users' });
      return n;
    },
    async errors(){ await wait(); return clone(errors.slice().sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen))); },
    async deleteError(id){ await wait(200); const i = errors.findIndex(x => x.id === id); if(i >= 0) errors.splice(i, 1); },
    async clearErrors(){ await wait(300); errors.length = 0; },
    async signOut(){ location.href = location.pathname + '?demo'; },
  };
})();
