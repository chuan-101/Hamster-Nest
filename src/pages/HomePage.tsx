import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import {
  createTodayCheckin,
  fetchCheckinTotalCount,
  fetchRecentCheckins,
} from '../storage/supabaseSync'
import {
  loadHomeLayout,
  loadImageBlob,
  removeImageBlob,
  saveHomeLayout,
  saveImageBlob,
  type DecorativeWidget,
} from '../storage/homeLayout'
import './HomePage.css'

type HomePageProps = {
  user: User | null
  onOpenChat: () => void
}

type AppIcon = {
  id: string
  icon: string
  label: string
  route?: string
  action?: () => void
}

type WidgetSize = '1x1' | '2x1'

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
  const [homeBackgroundImageKey, setHomeBackgroundImageKey] = useState<string | null>(null)
  const [homeBackgroundUrl, setHomeBackgroundUrl] = useState<string | null>(null)
  const [backgroundUploading, setBackgroundUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const homeBackgroundInputRef = useRef<HTMLInputElement | null>(null)

  const holdTimerRef = useRef<number | null>(null)

  const appIcons = useMemo<AppIcon[]>(
    () => [
      { id: 'chat', icon: '💬', label: '聊天', action: onOpenChat },
      { id: 'checkin', icon: '✅', label: '打卡', route: '/checkin' },
      { id: 'memory', icon: '🧠', label: '囤囤库', route: '/memory-vault' },
      { id: 'snacks', icon: '🍪', label: '零食罐罐', route: '/snacks' },
      { id: 'syzygy', icon: '📘', label: '仓鼠日志', route: '/syzygy' },
      { id: 'rp', icon: '🎭', label: 'RP 房间', route: '/rp' },
      { id: 'settings', icon: '⚙️', label: '设置', route: '/settings' },
      { id: 'export', icon: '📦', label: '导出', route: '/export' },
    ],
    [onOpenChat],
  )

  const iconMap = useMemo(() => new Map(appIcons.map((icon) => [icon.id, icon])), [appIcons])

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
    const cached = loadHomeLayout()
    if (!cached) {
      return
    }

    const safeIconOrder = DEFAULT_ICON_ORDER.filter((id) => cached.iconOrder.includes(id))
    const missing = DEFAULT_ICON_ORDER.filter((id) => !safeIconOrder.includes(id))
    setIconOrder([...safeIconOrder, ...missing])

    const safeWidgets = cached.widgets.filter((widget) => widget.type === 'image' || widget.type === 'text')
    const widgetIds = safeWidgets.map((widget) => widget.id)
    const restoredOrder = cached.widgetOrder.filter((id) => id === CORE_WIDGET_ID || widgetIds.includes(id))
    setWidgets(safeWidgets)
    setWidgetOrder(Array.from(new Set([CORE_WIDGET_ID, ...restoredOrder])))
    setCheckinSize(cached.checkinSize ?? '1x1')
    setShowEmptySlots(cached.showEmptySlots ?? false)
    setIconTileBgColor(cached.iconTileBgColor ?? DEFAULT_ICON_TILE_BG_COLOR)
    setIconTileBgOpacity(cached.iconTileBgOpacity ?? DEFAULT_ICON_TILE_BG_OPACITY)
    setHomeBackgroundImageKey(cached.homeBackgroundImageKey ?? null)
  }, [])

  useEffect(() => {
    saveHomeLayout({
      iconOrder,
      widgetOrder,
      widgets,
      checkinSize,
      showEmptySlots,
      iconTileBgColor,
      iconTileBgOpacity,
      homeBackgroundImageKey,
    })
  }, [
    checkinSize,
    homeBackgroundImageKey,
    iconOrder,
    iconTileBgColor,
    iconTileBgOpacity,
    showEmptySlots,
    widgetOrder,
    widgets,
  ])

  useEffect(() => {
    const imageWidgets = widgets.filter((widget) => widget.type === 'image')
    const disposed: string[] = []

    void Promise.all(
      imageWidgets.map(async (widget) => {
        const blob = await loadImageBlob(widget.imageKey)
        if (!blob) {
          return null
        }
        return { id: widget.id, url: URL.createObjectURL(blob) }
      }),
    ).then((results) => {
      setImageUrls((current) => {
        Object.values(current).forEach((url) => {
          if (!Object.values(current).includes(url)) {
            URL.revokeObjectURL(url)
          }
        })
        const next: Record<string, string> = {}
        results.forEach((entry) => {
          if (entry) {
            next[entry.id] = entry.url
          }
        })
        Object.entries(current).forEach(([id, url]) => {
          if (!next[id]) {
            disposed.push(url)
          }
        })
        return next
      })
      disposed.forEach((url) => URL.revokeObjectURL(url))
    })

    return () => {
      disposed.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [widgets])

  useEffect(
    () => () => {
      Object.values(imageUrls).forEach((url) => URL.revokeObjectURL(url))
    },
    [imageUrls],
  )

  useEffect(() => {
    let disposedUrl: string | null = null

    if (!homeBackgroundImageKey) {
      setHomeBackgroundUrl(null)
      return
    }

    void loadImageBlob(homeBackgroundImageKey).then((blob) => {
      if (!blob) {
        setHomeBackgroundUrl(null)
        return
      }
      const objectUrl = URL.createObjectURL(blob)
      disposedUrl = objectUrl
      setHomeBackgroundUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current)
        }
        return objectUrl
      })
    })

    return () => {
      if (disposedUrl) {
        URL.revokeObjectURL(disposedUrl)
      }
    }
  }, [homeBackgroundImageKey])

  useEffect(
    () => () => {
      if (homeBackgroundUrl) {
        URL.revokeObjectURL(homeBackgroundUrl)
      }
    },
    [homeBackgroundUrl],
  )

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
      const imageKey = await saveImageBlob(file)
      setWidgets((current) => [...current, { id, type: 'image', imageKey, fit: 'cover' }])
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
    if (target.type === 'image') {
      await removeImageBlob(target.imageKey)
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
      const imageKey = await saveImageBlob(processedBlob)
      if (homeBackgroundImageKey) {
        await removeImageBlob(homeBackgroundImageKey)
      }
      setHomeBackgroundImageKey(imageKey)
      setNotice('背景图已更新')
    } catch (error) {
      console.warn('设置背景图失败', error)
      setNotice('设置背景图失败，请稍后重试')
    } finally {
      setBackgroundUploading(false)
    }
  }

  const handleRemoveHomeBackground = async () => {
    if (!homeBackgroundImageKey) {
      return
    }
    await removeImageBlob(homeBackgroundImageKey)
    setHomeBackgroundImageKey(null)
    setNotice('已移除背景图')
  }

  const iconTileBackground = useMemo(() => {
    const { r, g, b } = hexToRgb(iconTileBgColor)
    return `rgba(${r}, ${g}, ${b}, ${iconTileBgOpacity})`
  }, [iconTileBgColor, iconTileBgOpacity])

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
      className="home-page"
      style={
        {
          '--home-background-image': homeBackgroundUrl ? `url(${homeBackgroundUrl})` : 'none',
          '--icon-tile-bg': iconTileBackground,
        } as CSSProperties
      }
    >
      <div className="phone-shell">
        <header className="home-header">
          <button type="button" className="edit-button" onClick={() => setEditMode((value) => !value)}>
            {editMode ? '完成' : '编辑'}
          </button>
          <h1>{timeLabel}</h1>
          <p>{dateLabel}</p>
        </header>

        {notice ? <p className="home-notice">{notice}</p> : null}

        {editMode ? (
          <section className="glass-card widget-toolbar">
            <button type="button" className="ghost" onClick={handleAddTextWidget}>+ 文本组件</button>
            <button type="button" className="ghost" onClick={handleAddImageWidget}>+ 图片组件</button>
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
            <h2>外观</h2>
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
                disabled={!homeBackgroundImageKey || backgroundUploading}
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

        <section className="widget-grid" aria-label="Widgets">
          {orderedWidgetItems.map((item) => {
            const isCheckin = item.kind === 'checkin'
            const widget = item.widget
            return (
              <article
                key={item.id}
                className={`glass-card widget-card ${item.size === '2x1' ? 'widget-card-wide' : ''}`}
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
                  <article
                    className={`checkin-inner ${item.size === '2x1' ? 'checkin-wide' : ''}`}
                  >
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
                  <>
                    {widget.type === 'text' ? (
                      <p className="text-widget">{widget.text}</p>
                    ) : (
                      <img
                        className="image-widget"
                        src={imageUrls[widget.id]}
                        style={{ objectFit: widget.fit ?? 'cover' }}
                        alt="本地图片组件"
                      />
                    )}
                  </>
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
                  <span className="icon-emoji">{icon.icon}</span>
                  <span className="icon-label">{icon.label}</span>
                </button>
              </div>
            )
          })}
        </section>
      </div>
    </main>
  )
}

export default HomePage
