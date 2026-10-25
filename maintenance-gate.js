/* Public pages (the front page and sign-up): while maintenance mode is on, send visitors to /maintenance.
   Sign-in, FAQ, Terms, Privacy and the admin panel stay open (the sign-in page lets staff through).
   If the check can't run, the page just stays as it is, so a failed check never blocks anyone. */
(function(){
  var API = 'https://riqlhyzahqjjasisnwxj.supabase.co/rest/v1/rpc/maintenance_status';
  var KEY = 'sb_publishable_PmPLs3GaJwlHAvgwFXs5Ew_-LI43j0q'; // the same public key as shared-auth.js
  if(!window.fetch) return;
  fetch(API, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(m){ if(m && m.enabled === true) location.replace('/maintenance'); })
    .catch(function(){});
})();
