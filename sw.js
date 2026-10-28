/* Clarity Journal service worker: shows the daily Checklist reminder that the server sends as a push
   notification (Settings → Notifications). It doesn't cache anything, so the site always loads fresh. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){}
  e.waitUntil(self.registration.showNotification(d.title || 'Clarity Journal', {
    body: d.body || 'Time to go through your checklist.',
    icon: '/favicon-192.png',
    tag: d.tag || 'checklist-daily',
    data: { url: typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//') ? d.url : '/#checklist' },
  }));
});

// clicking it opens the Checklist: in the app if it's already open in a tab, otherwise in a new window
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/#checklist', self.location.origin);
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = tabs.find(c => { const u = new URL(c.url); return u.origin === self.location.origin && (u.pathname === '/' || u.pathname === '/index.html'); });
    if(app){
      await app.focus();
      app.postMessage({ open: url.hash.slice(1) || 'checklist' });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
