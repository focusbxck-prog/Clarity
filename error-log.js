/* ============================================================
   Clarity Journal — error reporting
   Loaded first on every page. Sends problems to the Error log on the admin page:
   crashes, failed promises, the app's own console.error / console.warn messages, and
   images, scripts or styles that fail to load.
   Never sent: anything typed into the app, journal text, screenshots, passwords or sign-in
   tokens. Messages are trimmed, data:/blob: URLs and quoted JSON snippets are blanked, and
   query strings are dropped from URLs.
   ============================================================ */
(function(){
  const API = 'https://riqlhyzahqjjasisnwxj.supabase.co/rest/v1/rpc/log_client_error';
  const KEY = 'sb_publishable_PmPLs3GaJwlHAvgwFXs5Ew_-LI43j0q'; // public key, same as shared-auth.js
  const MAX_PER_PAGE = 15;   // one broken page shouldn't flood the log
  const seen = new Set();
  const queue = [];
  let sentCount = 0, timer = null;

  function clean(s, max){
    return String(s == null ? '' : s)
      .replace(/\b(data|blob):[^\s"'`)]+/g, '$1:…')                     // the user's own pictures
      .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[token]')      // sign-in tokens
      .replace(/(https?:\/\/[^\s"'`?#)]+)[?#][^\s"'`)]*/g, '$1')         // query strings and fragments
      .slice(0, max);
  }

  // one console/promise argument as text; objects only give their message and code (never their details)
  function describe(x){
    if(x == null) return String(x);
    if(typeof x === 'string') return x;
    if(x instanceof Error){
      const msg = x.name === 'SyntaxError' ? String(x.message).replace(/"[^"]*"/g, '"…"') : x.message; // JSON errors quote the data
      return `${x.name}: ${msg}`;
    }
    if(typeof Event !== 'undefined' && x instanceof Event) return `${x.type} event`;
    if(typeof x === 'object'){
      if(typeof x.message === 'string') return x.message + (x.code ? ` (${x.code})` : '');
      return '[object]';
    }
    return String(x);
  }
  const stackOf = (list) => { const e = list.find(a => a instanceof Error); return e && e.stack ? e.stack : ''; };

  function report(kind, message, detail){
    message = clean(message, 500).trim();
    if(!message || sentCount >= MAX_PER_PAGE) return;
    const key = kind + '|' + message;
    if(seen.has(key)) return;
    seen.add(key); sentCount++;
    queue.push({
      p_kind: kind,
      p_message: message,
      p_page: clean(location.pathname + location.hash, 200),
      p_detail: detail ? clean(detail, 1500) : null,
      p_browser: String(navigator.userAgent || '').slice(0, 300),
    });
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }

  async function flush(){
    const items = queue.splice(0);
    let token = null;
    try{ // signed in? then the report is tied to the account (sb comes from shared-auth.js, if the page has it)
      if(typeof sb !== 'undefined' && sb.auth) token = ((await sb.auth.getSession()).data.session || {}).access_token || null;
    }catch(e){}
    for(const body of items){
      try{
        const headers = { 'Content-Type': 'application/json', apikey: KEY };
        if(token) headers.Authorization = 'Bearer ' + token;
        await fetch(API, { method: 'POST', headers, body: JSON.stringify(body), keepalive: true });
      }catch(e){ /* never report the reporter */ }
    }
  }

  // crashes, and files that fail to load (capture phase, since load errors don't bubble)
  window.addEventListener('error', (e) => {
    const t = e.target;
    if(t && t !== window && t.tagName){
      const src = t.currentSrc || t.src || t.href || '';
      if(!src || /^(data|blob):/.test(src)) return;   // the user's own pictures aren't a site problem
      report('resource', `Couldn't load ${t.tagName.toLowerCase()}: ${src}`);
      return;
    }
    const file = e.filename || '';
    if(!e.message || (file && !/^https?:/.test(file))) return;            // browser extensions
    if(/ResizeObserver loop/.test(e.message)) return;                      // harmless browser notice
    if(e.message === 'Script error.' && !file) return;                     // no details to go on
    const where = file ? `${file}:${e.lineno}:${e.colno}` : '';
    const msg = e.error ? describe(e.error)
      : /SyntaxError/.test(e.message) ? e.message.replace(/"[^"]*"/g, '"…"') : e.message;
    report('error', msg, [where, e.error && e.error.stack].filter(Boolean).join('\n'));
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report('promise', describe(r), r && r.stack ? r.stack : '');
  });

  // the app's own error and warning messages
  [['error', 'console'], ['warn', 'warning']].forEach(([level, kind]) => {
    const original = console[level];
    if(typeof original !== 'function') return;
    console[level] = function(...args){
      try{ report(kind, args.map(describe).join(' '), stackOf(args)); }catch(e){}
      return original.apply(this, args);
    };
  });
})();
