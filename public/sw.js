const APP_SHELL_CACHE = 'hamster-nest-app-shell-v2'
const RUNTIME_CACHE = 'hamster-nest-runtime-v2'
const LETTERS_PATH = '/#/letters'
const DEFAULT_NOTIFICATION_TITLE = 'Hamster Nest'
const DEFAULT_NOTIFICATION_BODY = '你收到了一条新的提醒。'
const DEFAULT_NOTIFICATION_ICON = './icons/pwa-192.png'
const DEFAULT_NOTIFICATION_TAG = 'auto-letter'

const APP_SHELL_URLS = ['./', './index.html', './manifest.webmanifest']

const resolveLettersUrl = () => new URL(LETTERS_PATH, self.location.origin).href

const parsePushPayload = (event) => {
  if (!event.data) {
    return {}
  }

  try {
    return event.data.json()
  } catch (error) {
    return {
      body: event.data.text(),
    }
  }
}

const buildNotificationOptions = (payload = {}) => {
  const targetUrl = typeof payload.url === 'string' && payload.url.trim().length > 0
    ? payload.url
    : resolveLettersUrl()

  return {
    body: payload.body || DEFAULT_NOTIFICATION_BODY,
    icon: payload.icon || DEFAULT_NOTIFICATION_ICON,
    badge: payload.badge || DEFAULT_NOTIFICATION_ICON,
    image: typeof payload.image === 'string' ? payload.image : undefined,
    tag: payload.tag || DEFAULT_NOTIFICATION_TAG,
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.requireInteraction),
    data: {
      url: targetUrl,
    },
  }
}

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

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event)
  const title = payload.title || DEFAULT_NOTIFICATION_TITLE
  const options = buildNotificationOptions(payload)

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || resolveLettersUrl()

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const targetPathname = new URL(targetUrl, self.location.origin).pathname
      const matchingClient = clients.find((client) => {
        if (!('focus' in client)) {
          return false
        }

        try {
          return new URL(client.url).pathname === targetPathname
        } catch (error) {
          return false
        }
      }) ?? clients.find((client) => 'focus' in client)

      if (matchingClient) {
        return matchingClient.focus().then(() => {
          if ('navigate' in matchingClient) {
            return matchingClient.navigate(targetUrl)
          }
          return undefined
        })
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }

      return undefined
    }),
  )
})
