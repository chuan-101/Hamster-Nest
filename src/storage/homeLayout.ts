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
      imageKey: string
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
      imageKey: string
    }

export type HomeLayoutState = {
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
  appIconConfigs?: Record<string, AppIconConfig>
}

const HOME_LAYOUT_STORAGE_KEY = 'hamster.home.layout.v1'
const IMAGE_DB_NAME = 'hamster-home-db'
const IMAGE_STORE_NAME = 'images'

const openImageDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        db.createObjectStore(IMAGE_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败'))
  })

const withImageStore = async <T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openImageDb()
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

export const loadHomeLayout = (): HomeLayoutState | null => {
  const raw = localStorage.getItem(HOME_LAYOUT_STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as HomeLayoutState
    return parsed
  } catch (error) {
    console.warn('解析 Home 布局失败', error)
    return null
  }
}

export const saveHomeLayout = (state: HomeLayoutState) => {
  localStorage.setItem(HOME_LAYOUT_STORAGE_KEY, JSON.stringify(state))
}

export const createImageKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}-${Math.random().toString(16).slice(2)}`

export const saveImageBlob = async (blob: Blob, key = createImageKey()): Promise<string> => {
  await withImageStore('readwrite', (store) => store.put(blob, key))
  return key
}

export const loadImageBlob = async (key: string): Promise<Blob | null> => {
  const result = await withImageStore<Blob | undefined>('readonly', (store) => store.get(key))
  return result ?? null
}

export const removeImageBlob = async (key: string): Promise<void> => {
  await withImageStore('readwrite', (store) => store.delete(key))
}
