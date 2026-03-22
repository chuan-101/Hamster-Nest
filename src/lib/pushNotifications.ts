import { supabase } from '../supabase/client'
import {
  registerAppServiceWorker,
  type AppServiceWorkerRegistration,
} from './serviceWorker'

const PUSH_SUBSCRIPTIONS_TABLE = 'push_subscriptions'
const PUSH_SUBSCRIPTION_COLUMNS = 'user_id,endpoint,p256dh,auth,subscription'
const WEB_PUSH_VAPID_PUBLIC_KEY =
  'BE4i06QAwLCwtbVEQEv1qfCW8a4_vclt6-swUq3Gs3D4CJiv3GgyjX4_g-CFI2zarw-ncgqLTJC0RGMExMaWvDc'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

export type PushSupportStatus = {
  supported: boolean
  reason: string | null
  permission: NotificationPermissionState
  vapidKeyConfigured: boolean
}

type PushSubscriptionRecord = {
  auth: string | null
  endpoint: string
  p256dh: string | null
  subscription: ReturnType<PushSubscription['toJSON']>
  user_id: string
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

const requirePushSupport = (): PushSupportStatus => {
  const support = getPushSupportStatus()
  if (!support.supported) {
    throw new Error(support.reason ?? '当前环境不支持推送通知。')
  }
  return support
}

const requirePushRegistration = async (): Promise<AppServiceWorkerRegistration> => {
  requirePushSupport()
  return registerAppServiceWorker()
}

const decodeVapidPublicKey = (publicKey: string): ArrayBuffer => {
  const normalized = publicKey.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = window.atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

const extractPushKey = (
  subscription: PushSubscription,
  keyName: PushEncryptionKeyName,
): string | null => {
  const key = subscription.getKey(keyName)
  if (!key) {
    return null
  }

  const bytes = new Uint8Array(key)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return window.btoa(binary)
}

const buildSubscriptionRecord = (
  userId: string,
  subscription: PushSubscription,
): PushSubscriptionRecord => ({
  user_id: userId,
  endpoint: subscription.endpoint,
  p256dh: extractPushKey(subscription, 'p256dh'),
  auth: extractPushKey(subscription, 'auth'),
  subscription: subscription.toJSON(),
})

const requireSupabase = () => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置。')
  }
  return supabase
}

const upsertSubscriptionRecord = async (record: PushSubscriptionRecord): Promise<void> => {
  const client = requireSupabase()
  const { data: existingRows, error: lookupError } = await client
    .from(PUSH_SUBSCRIPTIONS_TABLE)
    .select('endpoint')
    .eq('user_id', record.user_id)
    .eq('endpoint', record.endpoint)

  if (lookupError) {
    throw lookupError
  }

  const hasExistingRow = (existingRows?.length ?? 0) > 0
  const duplicateRows = existingRows?.slice(1) ?? []

  const writeQuery = hasExistingRow
    ? client
        .from(PUSH_SUBSCRIPTIONS_TABLE)
        .update(record)
        .eq('user_id', record.user_id)
        .eq('endpoint', record.endpoint)
    : client.from(PUSH_SUBSCRIPTIONS_TABLE).insert(record)

  const { error: writeError } = await writeQuery
    .select(PUSH_SUBSCRIPTION_COLUMNS)
    .limit(1)
    .single()

  if (writeError) {
    throw writeError
  }

  if (duplicateRows.length > 0) {
    const { error: cleanupError } = await client
      .from(PUSH_SUBSCRIPTIONS_TABLE)
      .delete()
      .eq('user_id', record.user_id)
      .eq('endpoint', record.endpoint)

    if (cleanupError) {
      throw cleanupError
    }

    const { error: restoreError } = await client
      .from(PUSH_SUBSCRIPTIONS_TABLE)
      .insert(record)
      .select(PUSH_SUBSCRIPTION_COLUMNS)
      .single()

    if (restoreError) {
      throw restoreError
    }
  }
}

export const getPushSupportStatus = (): PushSupportStatus => {
  const reason = getMissingSupportReason()
  return {
    supported: reason === null,
    reason,
    permission: getNotificationPermission(),
    vapidKeyConfigured: WEB_PUSH_VAPID_PUBLIC_KEY.length > 0,
  }
}

export const registerPushServiceWorker = async (): Promise<ServiceWorkerRegistration> =>
  requirePushRegistration()

export const getExistingPushSubscription = async (): Promise<PushSubscription | null> => {
  const support = getPushSupportStatus()
  if (!support.supported) {
    return null
  }
  const registration = await requirePushRegistration()
  return registration.pushManager.getSubscription()
}

export const createPushSubscription = async (): Promise<PushSubscription> => {
  requirePushSupport()

  const registration = await requirePushRegistration()
  const existingSubscription = await registration.pushManager.getSubscription()
  if (existingSubscription) {
    return existingSubscription
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidPublicKey(WEB_PUSH_VAPID_PUBLIC_KEY),
  })
}

export const persistPushSubscription = async (
  userId: string,
  subscription: PushSubscription,
): Promise<void> => {
  const record = buildSubscriptionRecord(userId, subscription)
  await upsertSubscriptionRecord(record)
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
  if (resolvedPermission === 'denied') {
    throw new Error('通知权限已被拒绝，请在浏览器或系统设置中重新开启。')
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
