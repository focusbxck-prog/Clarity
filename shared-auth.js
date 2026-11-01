/* ============================================================
   Clarity Journal — shared auth layer
   Loaded by login.html, signin.html, signup.html, maintenance.html, index.html and admin.html.
   Requires the Supabase JS library to be loaded first (via CDN).
   ============================================================ */

// --- your project's public config (safe to expose in the browser) ---
const SUPABASE_URL = 'https://riqlhyzahqjjasisnwxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PmPLs3GaJwlHAvgwFXs5Ew_-LI43j0q';

/* Signed in only while the site is open (since 2026-11-01): the session is kept in this tab's sessionStorage, not
   localStorage, so closing the site signs you out and opening it again asks you to sign in. A browser can bring a
   closed tab back together with its sessionStorage (Ctrl+Shift+T, "continue where you left off"), so a session also
   counts as over once no Clarity page has been open for SITE_CLOSED_AFTER_MS - every open page keeps stamping
   LAST_SEEN_KEY. After signing in you're taken back to the page you were last on (LAST_VIEW_KEY, e.g. "journal"). */
const SITE_CLOSED_AFTER_MS = 2 * 60 * 1000;
const LAST_SEEN_KEY = 'clarityJournal:lastSeen';
const LAST_VIEW_KEY = 'clarityJournal:lastView';
const isAuthKey = (k) => /^sb-.*-auth-token/.test(k);   // Supabase's session (and its PKCE verifier)
let sessionStore;
try{
  sessionStore = window.sessionStorage;
  Object.keys(localStorage).filter(isAuthKey).forEach(k => localStorage.removeItem(k));   // sign-ins kept from before
  if(Date.now() - Number(localStorage.getItem(LAST_SEEN_KEY) || 0) > SITE_CLOSED_AFTER_MS)
    Object.keys(sessionStore).filter(isAuthKey).forEach(k => sessionStore.removeItem(k));
}catch(e){}   // storage blocked (some private modes): Supabase then keeps the session in memory, gone on close anyway
(function(){
  const stamp = () => { try{ localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); }catch(e){} };
  stamp();
  setInterval(stamp, 20000);
  addEventListener('pagehide', stamp);
  document.addEventListener('visibilitychange', stamp);   // a tab the browser paused comes back up to date at once
})();

// one shared client for the whole app
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, sessionStore ? { auth: { storage: sessionStore } } : {});

/* Where to go after signing in: the app, on the page you were last on. */
function afterSignInUrl(){
  let v = '';
  try{ v = localStorage.getItem(LAST_VIEW_KEY) || ''; }catch(e){}
  return /^[a-z]+$/.test(v) && v !== 'overview' ? '/#' + v : '/';
}

/* Fetch the signed-in user's profile row (role + status), or null. */
async function getMyProfile(){
  const { data: { user } } = await sb.auth.getUser();
  if(!user) return null;
  const { data, error } = await sb
    .from('profiles')
    .select('id, email, username, role, status')
    .eq('id', user.id)
    .maybeSingle();
  if(error){ console.error('profile error', error); return null; }
  return data ? { ...data, user } : null;
}

/* Guard a normal private page (index.html).
   - not signed in             -> /login (the front page)
   - signed in but not approved -> /signin?state=pending|disabled (the sign-in page explains why)
   Returns the profile if allowed. */
async function requireApprovedUser(){
  const profile = await getMyProfile();
  if(!profile){
    // a link straight to a page (e.g. the checklist reminder's /#checklist) opens that page once they've signed in
    const v = decodeURIComponent(location.hash.slice(1));
    if(/^[a-z]+$/.test(v)){ try{ localStorage.setItem(LAST_VIEW_KEY, v); }catch(e){} }
    window.location.replace('/login');
    return null;
  }
  if(profile.status !== 'approved'){
    await sb.auth.signOut();
    window.location.replace('/signin?state=' + encodeURIComponent(profile.status));
    return null;
  }
  return profile;
}

/* Guard an admin-only page (admin.html).
   - not signed in / not approved -> /signin
   - approved but not admin        -> /  (their own dashboard)
   Returns the admin profile if allowed. */
async function requireAdmin(){
  const profile = await getMyProfile();
  if(!profile){ window.location.replace('/signin'); return null; }
  if(profile.status !== 'approved'){
    await sb.auth.signOut();
    window.location.replace('/signin?state=' + encodeURIComponent(profile.status));
    return null;
  }
  if(profile.role !== 'admin'){ window.location.replace('/'); return null; }
  return profile;
}

/* Sign out and return to the front page. */
async function signOutAndRedirect(){
  await sb.auth.signOut();
  window.location.replace('/login');
}
