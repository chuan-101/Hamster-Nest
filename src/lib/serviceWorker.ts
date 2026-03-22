const APP_SERVICE_WORKER_URL = `${import.meta.env.BASE_URL}sw.js`

export type AppServiceWorkerRegistration = ServiceWorkerRegistration

let serviceWorkerRegistrationPromise: Promise<AppServiceWorkerRegistration> | null = null

export const registerAppServiceWorker = async (): Promise<AppServiceWorkerRegistration> => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('当前浏览器不支持 Service Worker。')
  }

  serviceWorkerRegistrationPromise ??= navigator.serviceWorker.register(APP_SERVICE_WORKER_URL)
  return serviceWorkerRegistrationPromise
}

export const initializeAppServiceWorker = (): void => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    void registerAppServiceWorker().catch((error) => {
      console.error('Service worker registration failed:', error)
      serviceWorkerRegistrationPromise = null
    })
  })
}
