// This is heavily based on Jeremy Keith's minimal viable service worker,
// that you can find here: https://gist.github.com/adactio/3717b7da007a9363ddf21f584aae34af
//
// Things I added:
//  - Lots of comments
//  - Add `install` & `activate` handlers
//  - Support Navigation Preload
//  - Cache HTTP HEAD
//  - Support private Cache-Control response headers
//  - Race the network to avoid slow user experiences on flaky or offline networks
//
// Caching strategy:
//  - HTML requests: prefer the network, fallback to the cache
//  - Other requests: serve from the cache, fallback to the network
//  - Always go to the network in the background to refresh the cache
//
// Caveats:
//  - Your cache will grow bigger and bigger

const cacheName = 'static';

// The first step in the Service Worker lifecycle is the installation.
addEventListener('install', (e) => {
  // Don't wait for any other connected Service Workers to disconnect
  e.waitUntil(self.skipWaiting());
});

// When the Service Worker is installed, it gets activated.
addEventListener('activate', (e) => {
  // Start controlling all open clients without needing a reload.
  // This makes sure the Service Worker connects with any open browser tabs or windows.
  e.waitUntil(self.clients.claim());

  // Enable navigation preloading.
  // This allows browsers to optimize certain navigation requests
  // when the Service Worker still has to boot
  e.waitUntil(
    (async function() {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
    })()
  );
});

// Once the Service Worker is activated,
// it has the ability to act on every HTTP request.
addEventListener('fetch', (e) => {
  const { request } = e;
  const { headers, method, url, mode } = request;

  // It's safer to only touch GET & HEAD requests.
  if (method !== 'GET' && method !== 'HEAD') {
    return;
  }

  return e.respondWith(
    (async function() {
      // Always go to the network to update the cache.
      // This might still hit the disk cache, but we're passing
      // the full responsibility to the browser.
      const response = fetch(request);

      // Using waitUntil here doesn't mean that the request will only
      // receive its response once this work is done.
      // It marks the Service Worker as busy, and it can only be closed
      // once all waitUntil callbacks are resolved.
      e.waitUntil(
        (async function() {
          // A response can be used only once,
          // so we have to clone the response to store it in the cache
          const clone = (await response).clone();

          // Inspect the response headers
          const { headers: responseHeaders } = clone;

          const cacheControl = responseHeaders.get('Cache-Control');

          // Don't store the response if it has a strict cache control header
          // (either `private` or `must-revalidate` or `no-cache` or `max-age=0`)
          if (cacheControl) {
            if (
              cacheControl.includes('private') ||
              cacheControl.includes('must-revalidate') ||
              cacheControl.includes('no-cache') ||
              cacheControl.includes('max-age=0')
            ) {
              return;
            }
          }

          // Store the response in the Service Worker cache
          const cache = await caches.open(cacheName);
          await cache.put(request, clone);
        })()
      );

      if (mode === 'navigate' || headers.get('Accept').includes('text/html')) {
        // When the request is for HTML, we prefer to go over the network
        // to get a fresh response.
        // However, we want to use the Service Worker to provide a good, fast
        // user experience. That's why we can race the network and use the cache
        // to reduce the flakiness of bad networks.
        //
        // This gives us three options:
        // 1. The network responds within 2 seconds, use the fresh response
        // 2. The network hasn't responded within 2 seconds, then:
        // 2.a. If there is a cached version,
        //      return the cached, possibly stale version
        // 2.b. If there is no cached version,
        //      return the pending network request and let the browser handle it
        return Promise.race([
          // If the browser already started preloading the navigation request,
          // use that reponse instead, otherwise wait until the network response returns
          Promise.resolve(e.preloadResponse).then(
            (preloaded) => preloaded || response
          ),

          // A timer that kills the network racing after two seconds
          new Promise((_, reject) => {
            setTimeout(() => reject(), 2000);
          })
        ]).catch(async function() {
          // If the timer won, find a response in the cache
          const cached = await caches.match(request);

          // Return the cached response, if it exists.
          // If it doesn't, return the (still pending) network request
          return cached || response;
        });
      }

      // All other requests (CSS, JavaScript, JSON, …) are cache first
      const cached = await caches.match(request);
      return cached || response;
    })()
  );
});
