// ShopKart app install ke liye. Kuch cache nahi karta, isliye purana code kabhi nahi atkega.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () {});
