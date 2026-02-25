export type DecorativeWidget =
  | {
      id: string
      type: 'text'
      text: string
      size?: '1x1' | '2x1'
    }
  | {
      id: string
      type: 'image'
      imageKey?: string
      imageDataUrl?: string
      fit?: 'cover' | 'contain'
      size?: '1x1' | '2x1'
    }
  | {
      id: string
      type: 'spacer'
      size?: '1x1' | '2x1'
    }

export type AppIconConfig =
  | {
      type: 'emoji'
      emoji: string
    }
  | {
      type: 'image'
      imageKey?: string
      imageDataUrl?: string
    }

export type HomeSettingsState = {
  iconOrder: string[]
  widgetOrder: string[]
  widgets: DecorativeWidget[]
  checkinSize?: '1x1' | '2x1'
  showEmptySlots?: boolean
  iconTileBgColor?: string
  iconTileBgOpacity?: number
  pageOverlayColor?: string
  pageOverlayOpacity?: number
  homeBackgroundImageKey?: string | null
  homeBackgroundImageDataUrl?: string | null
  appIconConfigs?: Record<string, AppIconConfig>
}

const HOME_SETTINGS_STORAGE_KEY = 'hamster_home_settings_v1'
const LEGACY_HOME_LAYOUT_STORAGE_KEY = 'hamster.home.layout.v1'
const IMAGE_DB_NAME = 'hamster-home-db'
const IMAGE_STORE_NAME = 'home_assets'
const IMAGE_DB_VERSION = 2
const IMAGE_FALLBACK_STORAGE_KEY = 'hamster_home_assets_fallback_v1'

let schemaUpgradeLogged = false
let activeImageDbVersion = IMAGE_DB_VERSION

const getFallbackAssetMap = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(IMAGE_FALLBACK_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>
    }
  } catch (error) {
    console.warn('读取本地图片回退缓存失败', error)
  }
  return {}
}

const setFallbackAssetMap = (map: Record<string, string>) => {
  localStorage.setItem(IMAGE_FALLBACK_STORAGE_KEY, JSON.stringify(map))
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('读取 Blob 数据失败'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取 Blob 数据失败'))
    reader.readAsDataURL(blob)
  })

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl)
  return response.blob()
}

const saveImageBlobFallback = async (blob: Blob, key: string) => {
  const map = getFallbackAssetMap()
  map[key] = await blobToDataUrl(blob)
  setFallbackAssetMap(map)
}

const loadImageBlobFallback = async (key: string): Promise<Blob | null> => {
  const map = getFallbackAssetMap()
  const dataUrl = map[key]
  if (!dataUrl) {
    return null
  }
  return dataUrlToBlob(dataUrl)
}

const removeImageBlobFallback = (key: string) => {
  const map = getFallbackAssetMap()
  if (!(key in map)) {
    return
  }
  delete map[key]
  setFallbackAssetMap(map)
}

const ensureImageStore = (db: IDBDatabase) => {
  if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
    db.createObjectStore(IMAGE_STORE_NAME)
  }
}

const openImageDb = (version = activeImageDbVersion): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, version)
    request.onupgradeneeded = () => {
      const db = request.result
      ensureImageStore(db)
      if (!schemaUpgradeLogged) {
        schemaUpgradeLogged = true
        console.info('Home 本地图片缓存结构已升级')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败'))
  })

const withImageStore = async <T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const runTransaction = async (allowRepairRetry: boolean): Promise<T> => {
    const db = await openImageDb()

    if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
      db.close()
      if (allowRepairRetry) {
        activeImageDbVersion += 1
        const repairedDb = await openImageDb(activeImageDbVersion)
        repairedDb.close()
        return runTransaction(false)
      }
      throw new Error(`IndexedDB 缺少对象仓库: ${IMAGE_STORE_NAME}`)
    }

    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE_NAME, mode)
      const store = transaction.objectStore(IMAGE_STORE_NAME)
      const request = handler(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'))
      transaction.oncomplete = () => db.close()
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
    })
  }

  try {
    return await runTransaction(true)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      activeImageDbVersion += 1
      const repairedDb = await openImageDb(activeImageDbVersion)
      repairedDb.close()
      return runTransaction(false)
    }
    throw error
  }
}

const parseHomeSettings = (raw: string | null): HomeSettingsState | null => {
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as HomeSettingsState
  } catch (error) {
    console.warn('解析 Home 配置失败', error)
    return null
  }
}

export const loadHomeSettings = (): HomeSettingsState | null => {
  const current = parseHomeSettings(localStorage.getItem(HOME_SETTINGS_STORAGE_KEY))
  if (current) {
    return current
  }

  const legacy = parseHomeSettings(localStorage.getItem(LEGACY_HOME_LAYOUT_STORAGE_KEY))
  if (legacy) {
    localStorage.setItem(HOME_SETTINGS_STORAGE_KEY, JSON.stringify(legacy))
    localStorage.removeItem(LEGACY_HOME_LAYOUT_STORAGE_KEY)
  }
  return legacy
}

export const saveHomeSettings = (state: HomeSettingsState) => {
  localStorage.setItem(HOME_SETTINGS_STORAGE_KEY, JSON.stringify(state))
  window.dispatchEvent(new Event('hamster-home-settings-changed'))
}

export const loadHomeLayout = (): HomeSettingsState | null => {
  return loadHomeSettings()
}

export const saveHomeLayout = (state: HomeSettingsState) => {
  saveHomeSettings(state)
}

export const createImageKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}-${Math.random().toString(16).slice(2)}`

export const saveImageBlob = async (blob: Blob, key = createImageKey()): Promise<string> => {
  try {
    await withImageStore('readwrite', (store) => store.put(blob, key))
  } catch (error) {
    console.warn('IndexedDB 保存图片失败，已回退到 localStorage', error)
    await saveImageBlobFallback(blob, key)
  }
  return key
}

export const loadImageBlob = async (key: string): Promise<Blob | null> => {
  try {
    const result = await withImageStore<Blob | undefined>('readonly', (store) => store.get(key))
    return result ?? null
  } catch (error) {
    console.warn('IndexedDB 读取图片失败，尝试 localStorage 回退缓存', error)
    return loadImageBlobFallback(key)
  }
}

export const removeImageBlob = async (key: string): Promise<void> => {
  try {
    await withImageStore('readwrite', (store) => store.delete(key))
  } catch (error) {
    console.warn('IndexedDB 删除图片失败，清理 localStorage 回退缓存', error)
  } finally {
    removeImageBlobFallback(key)
  }
}
