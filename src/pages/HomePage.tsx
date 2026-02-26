import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import {
  createTodayCheckin,
  fetchCheckinTotalCount,
  fetchRecentCheckins,
} from '../storage/supabaseSync'
import {
  createImageKey,
  loadHomeSettings,
  loadImageDataUrl,
  removeImageData,
  saveHomeSettings,
  saveImageDataUrl,
  type AppIconConfig,
  type DecorativeWidget,
} from '../storage/homeLayout'
import './HomePage.css'

type HomePageProps = {
  user: User | null
  onOpenChat: () => void
}

type AppIcon = {
  id: string
  defaultEmoji: string
  label: string
  route?: string
  action?: () => void
}

type WidgetSize = '1x1' | '2x1'
type AppIconState = Record<string, AppIconConfig>

type RenderedWidgetItem = {
  id: string
  size: WidgetSize
  kind: 'checkin' | 'decorative'
  widget?: DecorativeWidget
}

const DEFAULT_ICON_ORDER = ['chat', 'checkin', 'memory', 'snacks', 'syzygy', 'rp', 'settings', 'export']
const CORE_WIDGET_ID = 'widget-checkin'
const MAX_WIDGETS = 6
const DEFAULT_ICON_TILE_BG_COLOR = '#ffffff'
const DEFAULT_ICON_TILE_BG_OPACITY = 0.65
const DEFAULT_PAGE_OVERLAY_COLOR = '#ffffff'
const DEFAULT_PAGE_OVERLAY_OPACITY = 0.2

const imageCache = new Map<string, string>()


const hexToRgb = (hex: string) => {
  const sanitized = hex.replace('#', '').trim()
  const fullHex =
    sanitized.length === 3
      ? sanitized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : sanitized

  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
    return { r: 255, g: 255, b: 255 }
  }

  return {
    r: Number.parseInt(fullHex.slice(0, 2), 16),
    g: Number.parseInt(fullHex.slice(2, 4), 16),
    b: Number.parseInt(fullHex.slice(4, 6), 16),
  }
}

const processBackgroundImage = async (file: File): Promise<Blob> => {
  const imageBitmap = await createImageBitmap(file)
  const maxWidth = 1080
  const scale = Math.min(1, maxWidth / imageBitmap.width)
  const targetWidth = Math.round(imageBitmap.width * scale)
  const targetHeight = Math.round(imageBitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) {
    imageBitmap.close()
    return file
  }
  context.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight)
  imageBitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((output) => resolve(output), 'image/webp', 0.86)
  })

  return blob ?? file
}

const readFileAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null
      if (!result) {
        reject(new Error('读取图片失败'))
        return
      }
      resolve(result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

const formatDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const shiftDateKey = (dateKey: string, daysDelta: number) => {
  const base = new Date(`${dateKey}T00:00:00`)
  base.setDate(base.getDate() + daysDelta)
  return formatDateKey(base)
}

const computeStreak = (dates: string[], todayKey: string) => {
  const uniqueDates = Array.from(new Set(dates)).sort((a, b) => b.localeCompare(a))
  const dateSet = new Set(uniqueDates)
  const startDate = dateSet.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1)
  if (!dateSet.has(startDate)) {
    return 0
  }

  let streak = 0
  let cursor = startDate
  while (dateSet.has(cursor)) {
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}

const HomePage = ({ user, onOpenChat }: HomePageProps) => {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => new Date())
  const [checkinDates, setCheckinDates] = useState<string[]>([])
  const [checkinTotal, setCheckinTotal] = useState(0)
  const [checkinSubmitting, setCheckinSubmitting] = useState(false)
  const [checkinLoading, setCheckinLoading] = useState(false)

  const [editMode, setEditMode] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [iconOrder, setIconOrder] = useState<string[]>(DEFAULT_ICON_ORDER)
  const [widgetOrder, setWidgetOrder] = useState<string[]>([CORE_WIDGET_ID])
  const [widgets, setWidgets] = useState<DecorativeWidget[]>([])
  const [checkinSize, setCheckinSize] = useState<WidgetSize>('1x1')
  const [showEmptySlots, setShowEmptySlots] = useState(false)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [iconTileBgColor, setIconTileBgColor] = useState(DEFAULT_ICON_TILE_BG_COLOR)
  const [iconTileBgOpacity, setIconTileBgOpacity] = useState(DEFAULT_ICON_TILE_BG_OPACITY)
  const [pageOverlayColor, setPageOverlayColor] = useState(DEFAULT_PAGE_OVERLAY_COLOR)
  const [pageOverlayOpacity, setPageOverlayOpacity] = useState(DEFAULT_PAGE_OVERLAY_OPACITY)
  const [homeBackgroundImageKey, setHomeBackgroundImageKey] = useState<string | null>(null)
  const [homeBackgroundImageDataUrl, setHomeBackgroundImageDataUrl] = useState<string | null>(null)
  const [backgroundUploading, setBackgroundUploading] = useState(false)
  const [appIconConfigs, setAppIconConfigs] = useState<AppIconState>({})
  const [appIconImageUrls, setAppIconImageUrls] = useState<Record<string, string>>({})
  const [editingIconId, setEditingIconId] = useState(DEFAULT_ICON_ORDER[0])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const homeBackgroundInputRef = useRef<HTMLInputElement | null>(null)
  const appIconInputRef = useRef<HTMLInputElement | null>(null)

  const holdTimerRef = useRef<number | null>(null)

  const appIcons = useMemo<AppIcon[]>(
    () => [
      { id: 'chat', defaultEmoji: '💬', label: '聊天', action: onOpenChat },
      { id: 'checkin', defaultEmoji: '✅', label: '打卡', route: '/checkin' },
      { id: 'memory', defaultEmoji: '🧠', label: '囤囤库', route: '/memory-vault' },
      { id: 'snacks', defaultEmoji: '🍪', label: '零食罐罐', route: '/snacks' },
      { id: 'syzygy', defaultEmoji: '📘', label: '仓鼠日志', route: '/syzygy' },
      { id: 'rp', defaultEmoji: '🎭', label: 'RP 房间', route: '/rp' },
      { id: 'settings', defaultEmoji: '⚙️', label: '设置', route: '/settings' },
      { id: 'export', defaultEmoji: '📦', label: '导出', route: '/export' },
    ],
    [onOpenChat],
  )

  const iconMap = useMemo(() => new Map(appIcons.map((icon) => [icon.id, icon])), [appIcons])

  const defaultAppIconConfigs = useMemo<AppIconState>(
    () =>
      Object.fromEntries(
        appIcons.map((icon) => [icon.id, { type: 'emoji', emoji: icon.defaultEmoji } satisfies AppIconConfig]),
      ),
    [appIcons],
  )

  const todayKey = useMemo(() => formatDateKey(now), [now])
  const checkedToday = useMemo(() => checkinDates.includes(todayKey), [checkinDates, todayKey])
  const streakDays = useMemo(() => computeStreak(checkinDates, todayKey), [checkinDates, todayKey])
  const dateLabel = useMemo(
    () =>
      now.toLocaleDateString('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }),
    [now],
  )
  const timeLabel = useMemo(
    () =>
      now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [now],
  )

  const decoratedWidgetCount = useMemo(() => widgets.length + 1, [widgets.length])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    const cached = loadHomeSettings()
    if (!cached) {
      setAppIconConfigs(defaultAppIconConfigs)
      return
    }

    const safeIconOrder = DEFAULT_ICON_ORDER.filter((id) => cached.iconOrder.includes(id))
    const missing = DEFAULT_ICON_ORDER.filter((id) => !safeIconOrder.includes(id))
    setIconOrder([...safeIconOrder, ...missing])

    const safeWidgets = cached.widgets.filter(
      (widget) => widget.type === 'image' || widget.type === 'text' || widget.type === 'spacer',
    )
    const widgetIds = safeWidgets.map((widget) => widget.id)
    const restoredOrder = cached.widgetOrder.filter((id) => id === CORE_WIDGET_ID || widgetIds.includes(id))
    setWidgets(safeWidgets)
    setWidgetOrder(Array.from(new Set([CORE_WIDGET_ID, ...restoredOrder])))
    setCheckinSize(cached.checkinSize ?? '1x1')
    setShowEmptySlots(cached.showEmptySlots ?? false)
    setIconTileBgColor(cached.iconTileBgColor ?? DEFAULT_ICON_TILE_BG_COLOR)
    setIconTileBgOpacity(cached.iconTileBgOpacity ?? DEFAULT_ICON_TILE_BG_OPACITY)
    setPageOverlayColor(cached.pageOverlayColor ?? DEFAULT_PAGE_OVERLAY_COLOR)
    setPageOverlayOpacity(cached.pageOverlayOpacity ?? DEFAULT_PAGE_OVERLAY_OPACITY)
    setHomeBackgroundImageKey(cached.homeBackgroundImageKey ?? null)
    setHomeBackgroundImageDataUrl(cached.homeBackgroundImageDataUrl ?? null)
    setAppIconConfigs({ ...defaultAppIconConfigs, ...(cached.appIconConfigs ?? {}) })
  }, [defaultAppIconConfigs])

  useEffect(() => {
    saveHomeSettings({
      iconOrder,
      widgetOrder,
      widgets,
      checkinSize,
      showEmptySlots,
      iconTileBgColor,
      iconTileBgOpacity,
      pageOverlayColor,
      pageOverlayOpacity,
      homeBackgroundImageKey,
      homeBackgroundImageDataUrl,
      appIconConfigs,
    })
  }, [
    appIconConfigs,
    checkinSize,
    homeBackgroundImageKey,
    homeBackgroundImageDataUrl,
    iconOrder,
    iconTileBgColor,
    iconTileBgOpacity,
    pageOverlayColor,
    pageOverlayOpacity,
    showEmptySlots,
    widgetOrder,
    widgets,
  ])

  useEffect(() => {
    const imageWidgets = widgets.filter((widget) => widget.type === 'image')

    const cachedEntries = imageWidgets
      .map((widget) => {
        if (typeof widget.imageDataUrl === 'string' && widget.imageDataUrl.length > 0) {
          imageCache.set(widget.id, widget.imageDataUrl)
          return [widget.id, widget.imageDataUrl] as const
        }
        const imageKey = widget.imageKey
        if (!imageKey) {
          return null
        }
        const cached = imageCache.get(imageKey)
        if (!cached) {
          return null
        }
        return [widget.id, cached] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))

    if (cachedEntries.length > 0) {
      setImageUrls((current) => {
        const next = { ...current }
        let changed = false
        cachedEntries.forEach(([id, url]) => {
          if (next[id] !== url) {
            next[id] = url
            changed = true
          }
        })
        return changed ? next : current
      })
    }

    void Promise.all(
      imageWidgets.map(async (widget) => {
        if (typeof widget.imageDataUrl === 'string' && widget.imageDataUrl.length > 0) {
          return { id: widget.id, url: widget.imageDataUrl }
        }
        if (!widget.imageKey) {
          return null
        }
        const dataUrl = await loadImageDataUrl(widget.imageKey)
        if (!dataUrl) {
          return null
        }
        imageCache.set(widget.imageKey, dataUrl)
        return { id: widget.id, url: dataUrl }
      }),
    ).then((results) => {
      setImageUrls((current) => {
        const next: Record<string, string> = {}
        results.forEach((entry) => {
          if (entry) {
            next[entry.id] = entry.url
          }
        })
        const sameKeys =
          Object.keys(next).length === Object.keys(current).length &&
          Object.entries(next).every(([id, url]) => current[id] === url)
        return sameKeys ? current : next
      })
    })
  }, [widgets])

  useEffect(() => {
    if (homeBackgroundImageDataUrl) {
      if (homeBackgroundImageKey) {
        imageCache.set(homeBackgroundImageKey, homeBackgroundImageDataUrl)
      }
      return
    }

    if (!homeBackgroundImageKey) {
      return
    }

    const cached = imageCache.get(homeBackgroundImageKey)
    if (cached && cached !== homeBackgroundImageDataUrl) {
      setHomeBackgroundImageDataUrl(cached)
    }

    void loadImageDataUrl(homeBackgroundImageKey).then((dataUrl) => {
      if (!dataUrl || dataUrl === homeBackgroundImageDataUrl) {
        return
      }
      imageCache.set(homeBackgroundImageKey, dataUrl)
      setHomeBackgroundImageDataUrl(dataUrl)
    })
  }, [homeBackgroundImageDataUrl, homeBackgroundImageKey])

  useEffect(() => {
    const iconEntries = Object.entries(appIconConfigs).flatMap(([id, config]) =>
      config.type === 'image' ? [{ id, imageKey: config.imageKey, imageDataUrl: config.imageDataUrl }] : [],
    )

    const cachedEntries = iconEntries
      .map(({ id, imageKey, imageDataUrl }) => {
        if (typeof imageDataUrl === 'string' && imageDataUrl.length > 0) {
          if (imageKey) {
            imageCache.set(imageKey, imageDataUrl)
          }
          return [id, imageDataUrl] as const
        }
        if (!imageKey) {
          return null
        }
        const cached = imageCache.get(imageKey)
        if (!cached) {
          return null
        }
        return [id, cached] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))

    if (cachedEntries.length > 0) {
      setAppIconImageUrls((current) => {
        const next = { ...current }
        let changed = false
        cachedEntries.forEach(([id, url]) => {
          if (next[id] !== url) {
            next[id] = url
            changed = true
          }
        })
        return changed ? next : current
      })
    }

    void Promise.all(
      iconEntries.map(async ({ id, imageKey, imageDataUrl }) => {
        if (typeof imageDataUrl === 'string' && imageDataUrl.length > 0) {
          return { id, url: imageDataUrl }
        }
        if (!imageKey) {
          return null
        }
        const dataUrl = await loadImageDataUrl(imageKey)
        if (!dataUrl) {
          return null
        }
        imageCache.set(imageKey, dataUrl)
        return { id, url: dataUrl }
      }),
    ).then((results) => {
      setAppIconImageUrls((current) => {
        const next: Record<string, string> = {}
        results.forEach((entry) => {
          if (entry) {
            next[entry.id] = entry.url
          }
        })
        const sameKeys =
          Object.keys(next).length === Object.keys(current).length &&
          Object.entries(next).every(([id, url]) => current[id] === url)
        return sameKeys ? current : next
      })
    })
  }, [appIconConfigs])

  const loadCheckinData = useCallback(async () => {
    if (!user) {
      return
    }
    setCheckinLoading(true)
    try {
      const [recent, total] = await Promise.all([fetchRecentCheckins(60), fetchCheckinTotalCount()])
      setCheckinDates(recent.map((entry) => entry.checkinDate))
      setCheckinTotal(total)
    } catch (error) {
      console.warn('加载打卡记录失败', error)
      setNotice('加载打卡数据失败，请稍后重试')
    } finally {
      setCheckinLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadCheckinData()
  }, [loadCheckinData])

  const handleCheckin = async () => {
    if (!user || checkedToday || checkinSubmitting) {
      return
    }
    setCheckinSubmitting(true)
    try {
      const result = await createTodayCheckin(todayKey)
      setNotice(result === 'created' ? '打卡成功！' : '今日已打卡')
      await loadCheckinData()
    } catch (error) {
      console.warn('打卡失败', error)
      setNotice('打卡失败，请稍后重试')
    } finally {
      setCheckinSubmitting(false)
    }
  }

  const moveInList = (list: string[], fromId: string, toIndex: number) => {
    const fromIndex = list.indexOf(fromId)
    if (fromIndex < 0 || toIndex < 0 || toIndex >= list.length) {
      return list
    }
    const next = [...list]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    return next
  }

  const handleIconDrop = (event: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/icon-id')
    if (!sourceId) {
      return
    }
    setIconOrder((current) => moveInList(current, sourceId, targetIndex))
  }

  const triggerEditModeByHold = () => {
    if (editMode) {
      return
    }
    holdTimerRef.current = window.setTimeout(() => {
      setEditMode(true)
    }, 450)
  }

  const cancelHold = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  const canAddWidget = decoratedWidgetCount < MAX_WIDGETS

  const handleAddTextWidget = () => {
    if (!canAddWidget) {
      setNotice(`最多只能放 ${MAX_WIDGETS} 个组件`)
      return
    }
    const id = `widget-text-${Date.now()}`
    const text = window.prompt('输入文本组件内容', '今天也要开心撸仓鼠！')?.trim()
    if (!text) {
      return
    }
    setWidgets((current) => [...current, { id, type: 'text', text }])
    setWidgetOrder((current) => [...current, id])
  }

  const handleAddImageWidget = () => {
    if (!canAddWidget) {
      setNotice(`最多只能放 ${MAX_WIDGETS} 个组件`)
      return
    }
    fileInputRef.current?.click()
  }

  const handleAddSpacerWidget = () => {
    if (!canAddWidget) {
      setNotice(`最多只能放 ${MAX_WIDGETS} 个组件`)
      return
    }
    const id = `widget-spacer-${Date.now()}`
    setWidgets((current) => [...current, { id, type: 'spacer', size: '1x1' }])
    setWidgetOrder((current) => [...current, id])
  }

  const handleImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (!canAddWidget) {
      setNotice(`最多只能放 ${MAX_WIDGETS} 个组件`)
      return
    }
    const id = `widget-image-${Date.now()}`
    try {
      const imageDataUrl = await readFileAsDataUrl(file)
      const imageKey = await saveImageDataUrl(imageDataUrl)
      setWidgets((current) => [...current, { id, type: 'image', imageKey, imageDataUrl, fit: 'cover' }])
      setWidgetOrder((current) => [...current, id])
    } catch (error) {
      console.warn('保存图片组件失败', error)
      setNotice('保存图片失败，请稍后再试')
    }
  }

  const removeWidget = async (id: string) => {
    const target = widgets.find((widget) => widget.id === id)
    if (!target) {
      return
    }
    if (target.type === 'image' && target.imageKey) {
      await removeImageData(target.imageKey)
    }
    setWidgets((current) => current.filter((widget) => widget.id !== id))
    setWidgetOrder((current) => current.filter((widgetId) => widgetId !== id))
  }

  const handleHomeBackgroundSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    setBackgroundUploading(true)
    try {
      const processedBlob = await processBackgroundImage(file)
      const dataUrl = await readFileAsDataUrl(processedBlob)
      const imageKey = await saveImageDataUrl(dataUrl)
      if (homeBackgroundImageKey) {
        await removeImageData(homeBackgroundImageKey)
      }
      setHomeBackgroundImageKey(imageKey)
      setHomeBackgroundImageDataUrl(dataUrl)
      setNotice('背景图已更新')
    } catch (error) {
      console.warn('设置背景图失败', error)
      setNotice('设置背景图失败，请稍后重试')
    } finally {
      setBackgroundUploading(false)
    }
  }

  const handleRemoveHomeBackground = async () => {
    if (!homeBackgroundImageKey && !homeBackgroundImageDataUrl) {
      return
    }
    if (homeBackgroundImageKey) {
      await removeImageData(homeBackgroundImageKey)
    }
    setHomeBackgroundImageKey(null)
    setHomeBackgroundImageDataUrl(null)
    setNotice('已移除背景图')
  }

  const handleEmojiChange = (iconId: string, emoji: string) => {
    const fallback = (defaultAppIconConfigs[iconId] as { type: 'emoji'; emoji: string })?.emoji ?? '🙂'
    const nextEmoji = emoji.trim() || fallback
    setAppIconConfigs((current) => ({
      ...current,
      [iconId]: {
        type: 'emoji',
        emoji: nextEmoji,
      },
    }))
  }

  const handleAppIconImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    const iconId = editingIconId
    const previous = appIconConfigs[iconId]
    try {
      const imageDataUrl = await readFileAsDataUrl(file)
      const key = createImageKey()
      await saveImageDataUrl(imageDataUrl, key)
      setAppIconConfigs((current) => ({
        ...current,
        [iconId]: { type: 'image', imageKey: key, imageDataUrl },
      }))
      if (previous?.type === 'image' && previous.imageKey) {
        await removeImageData(previous.imageKey)
      }
    } catch (error) {
      console.warn('保存图标失败', error)
      setNotice('保存图标失败，请稍后重试')
    }
  }

  const handleResetAppIcon = async (iconId: string) => {
    const current = appIconConfigs[iconId]
    const fallback = defaultAppIconConfigs[iconId] as { type: 'emoji'; emoji: string }
    setAppIconConfigs((prev) => ({ ...prev, [iconId]: fallback }))
    if (current?.type === 'image' && current.imageKey) {
      await removeImageData(current.imageKey)
    }
  }

  const iconTileBackground = useMemo(() => {
    const { r, g, b } = hexToRgb(iconTileBgColor)
    return `rgba(${r}, ${g}, ${b}, ${iconTileBgOpacity})`
  }, [iconTileBgColor, iconTileBgOpacity])

  const pageOverlayBackground = useMemo(() => {
    const { r, g, b } = hexToRgb(pageOverlayColor)
    return `rgba(${r}, ${g}, ${b}, ${pageOverlayOpacity})`
  }, [pageOverlayColor, pageOverlayOpacity])

  const orderedWidgetItems = useMemo<RenderedWidgetItem[]>(() => {
    const widgetMap = new Map(widgets.map((widget) => [widget.id, widget]))
    return widgetOrder
      .map((id) => {
        if (id === CORE_WIDGET_ID) {
          return { id, kind: 'checkin', size: checkinSize }
        }
        const widget = widgetMap.get(id)
        if (!widget) {
          return null
        }
        return { id, kind: 'decorative', widget, size: widget.size ?? '1x1' }
      })
      .filter((item): item is RenderedWidgetItem => Boolean(item))
  }, [checkinSize, widgetOrder, widgets])

  const handleWidgetSizeChange = (id: string, size: WidgetSize) => {
    if (id === CORE_WIDGET_ID) {
      setCheckinSize(size)
      return
    }
    setWidgets((current) => current.map((widget) => (widget.id === id ? { ...widget, size } : widget)))
  }

  const handleWidgetDropOnItem = (event: React.DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/widget-id')
    if (!sourceId || sourceId === targetId) {
      return
    }
    setWidgetOrder((current) => {
      const fromIndex = current.indexOf(sourceId)
      const toIndex = current.indexOf(targetId)
      if (fromIndex < 0 || toIndex < 0) {
        return current
      }
      return moveInList(current, sourceId, toIndex)
    })
  }

  return (
    <main
      className="home-page app-shell"
      style={
        {
          '--home-background-image': homeBackgroundImageDataUrl ? `url(${homeBackgroundImageDataUrl})` : 'none',
          '--icon-tile-bg': iconTileBackground,
          '--page-overlay-bg': pageOverlayBackground,
        } as CSSProperties
      }
    >
      <div className="phone-shell">
        <div className="phone-shell__mask" aria-hidden="true" />
        <div className="home-page__header app-shell__header">
          <header className="home-header">
            <button type="button" className="edit-button" onClick={() => setEditMode((value) => !value)}>
              {editMode ? '完成' : '编辑'}
            </button>
            <h1 className="ui-title">{timeLabel}</h1>
            <p>{dateLabel}</p>
          </header>

          {notice ? <p className="home-notice">{notice}</p> : null}

          {editMode ? (
            <section className="glass-card widget-toolbar">
              <button type="button" className="ghost" onClick={handleAddTextWidget}>+ 文本组件</button>
              <button type="button" className="ghost" onClick={handleAddImageWidget}>+ 图片组件</button>
              <button type="button" className="ghost" onClick={handleAddSpacerWidget}>+ 占位组件</button>
              <button type="button" className="ghost" onClick={() => setShowEmptySlots((value) => !value)}>
                {showEmptySlots ? '隐藏空位' : '显示空位'}
              </button>
              <span>{decoratedWidgetCount}/{MAX_WIDGETS} 组件</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => void handleImageSelected(event)}
              />
            </section>
          ) : null}

          {editMode ? (
            <section className="glass-card appearance-toolbar">
              <h2 className="ui-title">外观</h2>
              <label>
                图标底色
                <input
                  type="color"
                  value={iconTileBgColor}
                  onChange={(event) => setIconTileBgColor(event.target.value)}
                />
              </label>
              <label>
                图标透明度 {Math.round(iconTileBgOpacity * 100)}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(iconTileBgOpacity * 100)}
                  onChange={(event) => setIconTileBgOpacity(Number(event.target.value) / 100)}
                />
              </label>
              <label>
                面板颜色
                <input
                  type="color"
                  value={pageOverlayColor}
                  onChange={(event) => setPageOverlayColor(event.target.value)}
                />
              </label>
              <label>
                面板透明度 {Math.round(pageOverlayOpacity * 100)}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(pageOverlayOpacity * 100)}
                  onChange={(event) => setPageOverlayOpacity(Number(event.target.value) / 100)}
                />
              </label>
              <div className="background-controls">
                <span>背景图</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => homeBackgroundInputRef.current?.click()}
                  disabled={backgroundUploading}
                >
                  {backgroundUploading ? '上传中…' : '上传背景图'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void handleRemoveHomeBackground()}
                  disabled={(!homeBackgroundImageKey && !homeBackgroundImageDataUrl) || backgroundUploading}
                >
                  移除背景图
                </button>
              </div>
              <input
                ref={homeBackgroundInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => void handleHomeBackgroundSelected(event)}
              />
            </section>
          ) : null}

          {editMode ? (
            <section className="glass-card icon-editor-toolbar">
              <h2 className="ui-title">编辑图标</h2>
              <label>
                应用
                <select value={editingIconId} onChange={(event) => setEditingIconId(event.target.value)}>
                  {iconOrder.map((iconId) => {
                    const icon = iconMap.get(iconId)
                    return icon ? (
                      <option key={iconId} value={iconId}>
                        {icon.label}
                      </option>
                    ) : null
                  })}
                </select>
              </label>
              <label>
                Emoji
                <input
                  type="text"
                  value={appIconConfigs[editingIconId]?.type === 'emoji' ? appIconConfigs[editingIconId].emoji : ''}
                  onChange={(event) => handleEmojiChange(editingIconId, event.target.value)}
                  placeholder="输入 emoji"
                  maxLength={4}
                />
              </label>
              <div className="background-controls">
                <button type="button" className="ghost" onClick={() => appIconInputRef.current?.click()}>
                  上传本地图标
                </button>
                <button type="button" className="ghost" onClick={() => void handleResetAppIcon(editingIconId)}>
                  恢复默认
                </button>
              </div>
              <input
                ref={appIconInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => void handleAppIconImageSelected(event)}
              />
            </section>
          ) : null}
        </div>

        <div className="home-page__content app-shell__content">
          <section className="widget-grid home-widget-stage" aria-label="Widgets">
            {orderedWidgetItems.map((item) => {
              const isCheckin = item.kind === 'checkin'
              const widget = item.widget
              const isSpacer = widget?.type === 'spacer'

              return (
                <article
                  key={item.id}
                  className={`glass-card widget-card ${item.size === '2x1' ? 'widget-card-wide' : ''} ${isSpacer ? 'spacer-card' : ''}`}
                  draggable={editMode}
                  onDragStart={(event) => event.dataTransfer.setData('text/widget-id', item.id)}
                  onDragOver={(event) => editMode && event.preventDefault()}
                  onDrop={(event) => editMode && handleWidgetDropOnItem(event, item.id)}
                  onPointerDown={triggerEditModeByHold}
                  onPointerUp={cancelHold}
                  onPointerLeave={cancelHold}
                >
                  {editMode ? (
                    <div className="widget-controls">
                      <label>
                        尺寸
                        <select
                          value={item.size}
                          onChange={(event) => handleWidgetSizeChange(item.id, event.target.value as WidgetSize)}
                        >
                          <option value="1x1">小</option>
                          <option value="2x1">大</option>
                        </select>
                      </label>
                      {!isCheckin && widget ? (
                        <button type="button" className="widget-delete" onClick={() => void removeWidget(widget.id)}>
                          ×
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {isCheckin ? (
                    <article className={`checkin-inner ${item.size === '2x1' ? 'checkin-wide' : ''}`}>
                      <div className="checkin-head">
                        <strong>今日打卡</strong>
                        <span className={checkedToday ? 'done' : 'todo'}>{checkedToday ? '已完成' : '未完成'}</span>
                      </div>
                      <div className="checkin-metrics-mini">
                        <span>连续 {streakDays} 天</span>
                        <span>累计 {checkinTotal} 次</span>
                        {item.size === '2x1' ? <span>{checkedToday ? '今天已打卡' : '今天还没打卡'}</span> : null}
                      </div>
                      <button
                        type="button"
                        className="primary"
                        disabled={checkedToday || checkinSubmitting || checkinLoading}
                        onClick={() => void handleCheckin()}
                      >
                        {checkedToday ? '已打卡' : checkinSubmitting ? '打卡中…' : '立即打卡'}
                      </button>
                    </article>
                  ) : widget ? (
                    widget.type === 'text' ? (
                      <p className="text-widget">{widget.text}</p>
                    ) : widget.type === 'spacer' ? (
                      editMode ? <div className="spacer-editor">占位</div> : null
                    ) : (
                      <img
                        className="image-widget"
                        src={imageUrls[widget.id]}
                        style={{ objectFit: widget.fit ?? 'cover' }}
                        alt="本地图片组件"
                      />
                    )
                  ) : null}
                </article>
              )
            })}
            {editMode && showEmptySlots
              ? Array.from({ length: Math.max(MAX_WIDGETS - orderedWidgetItems.length, 0) }).map((_, index) => (
                  <div key={`empty-${index}`} className="widget-placeholder" aria-hidden="true" />
                ))
              : null}
          </section>

          <section className="icons-grid" aria-label="Apps">
            {iconOrder.map((iconId, index) => {
              const icon = iconMap.get(iconId)
              if (!icon) {
                return null
              }

              const configured = appIconConfigs[iconId] ?? { type: 'emoji', emoji: icon.defaultEmoji }
              const iconImageUrl = configured.type === 'image' ? appIconImageUrls[iconId] : null
              const emojiValue = configured.type === 'emoji' ? configured.emoji : icon.defaultEmoji

              return (
                <div
                  key={icon.id}
                  className="app-icon-slot"
                  onDragOver={(event) => editMode && event.preventDefault()}
                  onDrop={(event) => editMode && handleIconDrop(event, index)}
                >
                  <button
                    type="button"
                    className="app-icon-button"
                    draggable={editMode}
                    onDragStart={(event) => event.dataTransfer.setData('text/icon-id', icon.id)}
                    onPointerDown={triggerEditModeByHold}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    onClick={() => {
                      if (editMode) {
                        setEditingIconId(icon.id)
                        return
                      }
                      if (icon.action) {
                        icon.action()
                        return
                      }
                      if (icon.route) {
                        navigate(icon.route)
                      }
                    }}
                  >
                    <span className="icon-emoji">
                      {iconImageUrl ? (
                        <img src={iconImageUrl} alt={`${icon.label} 图标`} className="icon-image" />
                      ) : (
                        <span>{emojiValue}</span>
                      )}
                    </span>
                    <span className="icon-label">{icon.label}</span>
                  </button>
                </div>
              )
            })}
          </section>
        </div>
      </div>
    </main>
  )
}

export default HomePage
