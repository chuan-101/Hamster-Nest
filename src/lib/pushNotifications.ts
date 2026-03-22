import { supabase } from '../supabase/client'

const PUSH_SUBSCRIPTIONS_TABLE = 'push_subscriptions'
const PUSH_SUBSCRIPTION_COLUMNS = 'user_id,endpoint,subscription'
const swUrl = `${import.meta.env.BASE_URL}sw.js`

export type NotificationPermissionState = NotificationPermission | 'unsupported'

export type PushSupportStatus = {
  supported: boolean
  reason: string | null
  permission: NotificationPermissionState
  vapidKeyConfigured: boolean
}

const getNotificationPermission = (): NotificationPermissionState => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return Notification.permission
}

const getMissingSupportReason = (): string | null => {
  if (typeof window === 'undefined') {
    return '当前环境不支持推送通知。'
  }
  if (!window.isSecureContext) {
    return '推送通知需要 HTTPS 或本地开发环境。'
  }
  if (!('serviceWorker' in navigator)) {
    return '当前浏览器不支持 Service Worker。'
  }
  if (!('PushManager' in window)) {
    return '当前浏览器不支持 Web Push。'
  }
  if (!('Notification' in window)) {
    return '当前浏览器不支持系统通知权限。'
  }
  return null
}

export const getPushSupportStatus = (): PushSupportStatus => {
  const reason = getMissingSupportReason()
  return {
    supported: reason === null,
    reason,
    permission: getNotificationPermission(),
    vapidKeyConfigured: Boolean(import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY),
  }
}

export const registerPushServiceWorker = async (): Promise<ServiceWorkerRegistration> => {
  if (!('serviceWorker' in navigator)) {
    throw new Error('当前浏览器不支持 Service Worker。')
  }
  return navigator.serviceWorker.register(swUrl)
}

export const getExistingPushSubscription = async (): Promise<PushSubscription | null> => {
  const support = getPushSupportStatus()
  if (!support.supported) {
    return null
  }
  const registration = await registerPushServiceWorker()
  return registration.pushManager.getSubscription()
}

const decodeVapidPublicKey = (publicKey: string): ArrayBuffer => {
  const normalized = publicKey.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = window.atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer
}

const requireSupabase = () => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置。')
  }
  return supabase
}

export const createPushSubscription = async (): Promise<PushSubscription> => {
  const support = getPushSupportStatus()
  if (!support.supported) {
    throw new Error(support.reason ?? '当前环境不支持推送通知。')
  }
  const vapidPublicKey = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY as string | undefined
  if (!vapidPublicKey) {
    throw new Error('缺少 Web Push VAPID 公钥配置。')
  }

  const registration = await registerPushServiceWorker()
  const existingSubscription = await registration.pushManager.getSubscription()
  if (existingSubscription) {
    return existingSubscription
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidPublicKey(vapidPublicKey),
  })
}

export const persistPushSubscription = async (
  userId: string,
  subscription: PushSubscription,
): Promise<void> => {
  const client = requireSupabase()
  const payload = subscription.toJSON()
  const { error } = await client
    .from(PUSH_SUBSCRIPTIONS_TABLE)
    .upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        subscription: payload,
      },
      {
        onConflict: 'endpoint',
      },
    )
    .select(PUSH_SUBSCRIPTION_COLUMNS)
    .single()

  if (error) {
    throw error
  }
}

export const removePushSubscription = async (
  userId: string,
  endpoint: string,
): Promise<void> => {
  const client = requireSupabase()
  const { error } = await client
    .from(PUSH_SUBSCRIPTIONS_TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint)

  if (error) {
    throw error
  }
}

export const enablePushOnCurrentDevice = async (userId: string): Promise<PushSubscription> => {
  const permission = getNotificationPermission()
  if (permission === 'unsupported') {
    throw new Error('当前环境不支持通知权限。')
  }
  if (permission === 'denied') {
    throw new Error('通知权限已被拒绝，请在浏览器或系统设置中重新开启。')
  }

  let resolvedPermission: NotificationPermission = permission
  if (permission === 'default') {
    resolvedPermission = await Notification.requestPermission()
  }
  if (resolvedPermission !== 'granted') {
    throw new Error('没有获得通知权限，因此无法启用推送通知。')
  }

  const subscription = await createPushSubscription()
  try {
    await persistPushSubscription(userId, subscription)
    return subscription
  } catch (error) {
    await subscription.unsubscribe().catch(() => undefined)
    throw error
  }
}

export const disablePushOnCurrentDevice = async (userId: string): Promise<void> => {
  const existingSubscription = await getExistingPushSubscription()
  if (!existingSubscription) {
    return
  }
  await removePushSubscription(userId, existingSubscription.endpoint)
  const unsubscribed = await existingSubscription.unsubscribe()
  if (!unsubscribed) {
    throw new Error('当前设备取消订阅失败，请稍后重试。')
  }
}
