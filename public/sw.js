const APP_SHELL_CACHE = 'hamster-nest-app-shell-v1'
const RUNTIME_CACHE = 'hamster-nest-runtime-v1'

const APP_SHELL_URLS = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(APP_SHELL_CACHE)
        return cache.match('./')
      }),
    )
    return
  }

  if (url.origin !== self.location.origin) {
    return
  }

  const isStaticAsset = ['style', 'script', 'worker', 'font', 'image'].includes(request.destination)

  if (!isStaticAsset) {
    return
  }

  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(request)
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone())
          }
          return response
        })
        .catch(() => cached)

      return cached ?? networkFetch
    }),
  )
})
