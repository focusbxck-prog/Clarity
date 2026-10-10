/* ============================================================
   Clarity Journal — shared auth layer
   Loaded by login.html, index.html, and admin.html.
   Requires the Supabase JS library to be loaded first (via CDN).
   ============================================================ */

// --- your project's public config (safe to expose in the browser) ---
const SUPABASE_URL = 'https://riqlhyzahqjjasisnwxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PmPLs3GaJwlHAvgwFXs5Ew_-LI43j0q';

// one shared client for the whole app
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
  if(!profile){ window.location.replace('/login'); return null; }
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
