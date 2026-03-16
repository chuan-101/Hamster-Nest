import { useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import './ExportPage.css'

type ExportFormat = 'markdown' | 'json' | 'txt'
type ExportModules = {
  chat: boolean
  snacks: boolean
  syzygy: boolean
  memory: boolean
  checkins: boolean
  forum: boolean
}

type SessionRow = {
  id: string
  title: string
  created_at: string
  updated_at: string
  is_archived: boolean | null
}

type MessageRow = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  client_created_at: string | null
}

type SnackPostRow = {
  id: string
  content: string
  created_at: string
  updated_at: string
  is_deleted: boolean
}

type SnackReplyRow = {
  id: string
  post_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  is_deleted: boolean
}

type SyzygyPostRow = {
  id: string
  content: string
  created_at: string
  updated_at: string
  is_deleted: boolean
}

type SyzygyReplyRow = {
  id: string
  post_id: string
  author_role: 'user' | 'ai'
  content: string
  created_at: string
  is_deleted: boolean
}

type MemoryEntryRow = {
  id: string
  content: string
  status: 'confirmed' | 'pending'
  created_at: string
  is_deleted: boolean
}

type CheckinRow = {
  id: string
  checkin_date: string
  created_at: string
}

type ForumThreadRow = {
  id: string
  title: string
  body: string
  author_type: string
  author_name: string
  created_at: string
  updated_at: string
}

type ForumReplyRow = {
  id: string
  thread_id: string
  body: string
  author_type: string
  author_name: string
  created_at: string
  parent_id: string | null
  reply_to_reply_id: string | null
}

type ExportDataBundle = {
  sessions: SessionRow[]
  messages: MessageRow[]
  snackPosts: SnackPostRow[]
  snackReplies: SnackReplyRow[]
  syzygyPosts: SyzygyPostRow[]
  syzygyReplies: SyzygyReplyRow[]
  memoryEntries: MemoryEntryRow[]
  checkins: CheckinRow[]
  forumThreads: ForumThreadRow[]
  forumReplies: ForumReplyRow[]
}

const formatOptions: Array<{ value: ExportFormat; label: string }> = [
  { value: 'markdown', label: 'Markdown (.md)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'txt', label: 'TXT (.txt)' },
]

const defaultModules: ExportModules = {
  chat: true,
  snacks: true,
  syzygy: true,
  memory: true,
  checkins: true,
  forum: true,
}

const MESSAGE_BATCH_SIZE = 1000
const MESSAGE_CAP = 10000

const toDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const shiftDate = (dateKey: string, daysDelta: number) => {
  const base = new Date(`${dateKey}T00:00:00`)
  base.setDate(base.getDate() + daysDelta)
  return toDateKey(base)
}

const computeStreak = (checkins: CheckinRow[]) => {
  const today = toDateKey(new Date())
  const uniqueDates = Array.from(new Set(checkins.map((entry) => entry.checkin_date))).sort((a, b) => b.localeCompare(a))
  const dateSet = new Set(uniqueDates)
  const startDate = dateSet.has(today) ? today : shiftDate(today, -1)
  if (!dateSet.has(startDate)) {
    return 0
  }
  let streak = 0
  let cursor = startDate
  while (dateSet.has(cursor)) {
    streak += 1
    cursor = shiftDate(cursor, -1)
  }
  return streak
}

const safeMarkdownText = (value: string) => value.replaceAll('```', '\\`\\`\\`')

const renderForumReplies = (replies: ForumReplyRow[], lines: string[], parentId: string | null = null, depth = 0) => {
  const nested = replies
    .filter((reply) => {
      const linkId = reply.parent_id ?? reply.reply_to_reply_id
      return parentId === null ? !linkId : linkId === parentId
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  nested.forEach((reply) => {
    const indent = '  '.repeat(depth)
    lines.push(
      `${indent}- ↳ [${reply.created_at}] (${reply.author_type}/${reply.author_name}) #${reply.id}: ${safeMarkdownText(reply.body)}`,
    )
    renderForumReplies(replies, lines, reply.id, depth + 1)
  })
}

const formatDownloadStamp = (value: Date) => {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  const hour = `${value.getHours()}`.padStart(2, '0')
  const minute = `${value.getMinutes()}`.padStart(2, '0')
  return `${year}${month}${day}-${hour}${minute}`
}

const renderMarkdown = (
  exportedAtIso: string,
  modules: ExportModules,
  data: ExportDataBundle,
) => {
  const lines: string[] = ['# Hamster-Nest 导出', `- 导出时间: ${exportedAtIso}`, '- 版本: 1', '']

  if (modules.chat) {
    lines.push('## 吱吱吱区（聊天记录）')
    const sessions = [...data.sessions].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const messagesBySession = new Map<string, MessageRow[]>()
    data.messages.forEach((message) => {
      const list = messagesBySession.get(message.session_id) ?? []
      list.push(message)
      messagesBySession.set(message.session_id, list)
    })
    sessions.forEach((session) => {
      lines.push(`### 会话: ${safeMarkdownText(session.title)} (${session.id})`)
      lines.push(`- 创建: ${session.created_at}  更新: ${session.updated_at}  状态: ${session.is_archived ? 'archived' : 'active'}`)
      lines.push('---')
      const messages = (messagesBySession.get(session.id) ?? []).sort((a, b) => {
        const first = a.client_created_at ?? a.created_at
        const second = b.client_created_at ?? b.created_at
        return first.localeCompare(second)
      })
      messages.forEach((message) => {
        const timestamp = message.client_created_at ?? message.created_at
        lines.push(`[${timestamp}] **${message.role}**: ${safeMarkdownText(message.content)}`)
      })
      lines.push('')
    })
    if (sessions.length === 0) {
      lines.push('暂无会话记录', '')
    }
  }

  if (modules.snacks) {
    lines.push('## 零食罐罐')
    const repliesByPost = new Map<string, SnackReplyRow[]>()
    data.snackReplies.forEach((reply) => {
      const list = repliesByPost.get(reply.post_id) ?? []
      list.push(reply)
      repliesByPost.set(reply.post_id, list)
    })
    data.snackPosts.forEach((post) => {
      lines.push(`### Post ${post.id}  ${post.created_at}  (deleted: ${post.is_deleted ? 'yes' : 'no'})`)
      lines.push(safeMarkdownText(post.content), '#### Replies')
      const replies = (repliesByPost.get(post.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))
      replies.forEach((reply) => {
        lines.push(`- [${reply.created_at}] (${reply.role}) ${safeMarkdownText(reply.content)}`)
      })
      if (replies.length === 0) {
        lines.push('- (无回复)')
      }
      lines.push('')
    })
    if (data.snackPosts.length === 0) {
      lines.push('暂无零食记录', '')
    }
  }

  if (modules.syzygy) {
    lines.push('## 仓鼠饲养日志')
    const repliesByPost = new Map<string, SyzygyReplyRow[]>()
    data.syzygyReplies.forEach((reply) => {
      const list = repliesByPost.get(reply.post_id) ?? []
      list.push(reply)
      repliesByPost.set(reply.post_id, list)
    })
    data.syzygyPosts.forEach((post) => {
      lines.push(`### Post ${post.id}  ${post.created_at}  (deleted: ${post.is_deleted ? 'yes' : 'no'})`)
      lines.push(safeMarkdownText(post.content), '#### Replies')
      const replies = (repliesByPost.get(post.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))
      replies.forEach((reply) => {
        lines.push(`- [${reply.created_at}] (${reply.author_role}) ${safeMarkdownText(reply.content)}`)
      })
      if (replies.length === 0) {
        lines.push('- (无回复)')
      }
      lines.push('')
    })
    if (data.syzygyPosts.length === 0) {
      lines.push('暂无仓鼠饲养日志', '')
    }
  }

  if (modules.memory) {
    lines.push('## 囤囤库')
    const confirmed = data.memoryEntries.filter((entry) => entry.status === 'confirmed')
    const pending = data.memoryEntries.filter((entry) => entry.status === 'pending')
    lines.push('### Confirmed')
    confirmed.forEach((entry) => {
      lines.push(`- ${entry.created_at} ${safeMarkdownText(entry.content)}`)
    })
    if (confirmed.length === 0) {
      lines.push('- (空)')
    }
    lines.push('### Pending')
    pending.forEach((entry) => {
      lines.push(`- ${entry.created_at} ${safeMarkdownText(entry.content)}`)
    })
    if (pending.length === 0) {
      lines.push('- (空)')
    }
    lines.push('')
  }

  if (modules.checkins) {
    lines.push('## 打卡')
    const sortedCheckins = [...data.checkins].sort((a, b) => b.checkin_date.localeCompare(a.checkin_date))
    lines.push(`- 连续打卡: ${computeStreak(sortedCheckins)}`)
    lines.push('- 记录:')
    sortedCheckins.forEach((item) => {
      lines.push(`  - ${item.checkin_date}`)
    })
    if (sortedCheckins.length === 0) {
      lines.push('  - (空)')
    }
    lines.push('')
  }

  if (modules.forum) {
    lines.push('## 论坛区')
    const sortedThreads = [...data.forumThreads].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const repliesByThread = new Map<string, ForumReplyRow[]>()
    data.forumReplies.forEach((reply) => {
      const list = repliesByThread.get(reply.thread_id) ?? []
      list.push(reply)
      repliesByThread.set(reply.thread_id, list)
    })

    sortedThreads.forEach((thread) => {
      lines.push(`### 帖子: ${safeMarkdownText(thread.title)} (${thread.id})`)
      lines.push(`- 作者: ${thread.author_type}/${thread.author_name}`)
      lines.push(`- 创建: ${thread.created_at}  更新: ${thread.updated_at}`)
      lines.push(`- 正文: ${safeMarkdownText(thread.body)}`)
      lines.push('- 回复:')
      const threadReplies = repliesByThread.get(thread.id) ?? []
      const renderedLinesStart = lines.length
      renderForumReplies(threadReplies, lines)
      if (lines.length === renderedLinesStart) {
        lines.push('  - (无回复)')
      }
      lines.push('')
    })

    if (sortedThreads.length === 0) {
      lines.push('暂无论坛记录', '')
    }
  }

  return lines.join('\n')
}

const ExportPage = ({ user, entryMode = 'phone' }: { user: User | null; entryMode?: 'phone' | 'game' }) => {
  const navigate = useNavigate()
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [modules, setModules] = useState<ExportModules>(defaultModules)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const selectedCount = useMemo(() => Object.values(modules).filter(Boolean).length, [modules])

  const toggleModule = (key: keyof ExportModules) => {
    setModules((current) => ({ ...current, [key]: !current[key] }))
  }

  const fetchMessagesWithCap = async (userId: string) => {
    if (!supabase) {
      return { rows: [] as MessageRow[], reachedCap: false }
    }
    const rows: MessageRow[] = []
    let offset = 0

    while (rows.length < MESSAGE_CAP) {
      const end = Math.min(offset + MESSAGE_BATCH_SIZE - 1, MESSAGE_CAP - 1)
      const { data, error: loadError } = await supabase
        .from('messages')
        .select('id,session_id,role,content,created_at,client_created_at')
        .eq('user_id', userId)
        .order('client_created_at', { ascending: true })
        .order('created_at', { ascending: true })
        .range(offset, end)

      if (loadError) {
        throw loadError
      }
      const batch = (data ?? []) as MessageRow[]
      rows.push(...batch)
      if (batch.length < MESSAGE_BATCH_SIZE) {
        break
      }
      offset += MESSAGE_BATCH_SIZE
    }

    return { rows, reachedCap: rows.length >= MESSAGE_CAP }
  }

  const handleExport = async () => {
    if (!user || !supabase || selectedCount === 0) {
      return
    }

    setExporting(true)
    setError(null)
    setWarning(null)

    try {
      const exportedAt = new Date()
      const exportedAtIso = exportedAt.toISOString()
      const baseData: ExportDataBundle = {
        sessions: [],
        messages: [],
        snackPosts: [],
        snackReplies: [],
        syzygyPosts: [],
        syzygyReplies: [],
        memoryEntries: [],
        checkins: [],
        forumThreads: [],
        forumReplies: [],
      }

      if (modules.chat) {
        const { data: sessionsData, error: sessionError } = await supabase
          .from('sessions')
          .select('id,title,created_at,updated_at,is_archived')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })
        if (sessionError) {
          throw sessionError
        }
        baseData.sessions = (sessionsData ?? []) as SessionRow[]

        const messageResult = await fetchMessagesWithCap(user.id)
        baseData.messages = messageResult.rows
        if (messageResult.reachedCap) {
          setWarning(`消息超过 ${MESSAGE_CAP} 条，导出已截断到 ${MESSAGE_CAP} 条。`)
        }
      }

      if (modules.snacks) {
        const [{ data: snackPosts, error: snackPostError }, { data: snackReplies, error: snackReplyError }] = await Promise.all([
          supabase
            .from('snack_posts')
            .select('id,content,created_at,updated_at,is_deleted')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('snack_replies')
            .select('id,post_id,role,content,created_at,is_deleted')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true }),
        ])
        if (snackPostError || snackReplyError) {
          throw snackPostError ?? snackReplyError
        }
        baseData.snackPosts = (snackPosts ?? []) as SnackPostRow[]
        baseData.snackReplies = (snackReplies ?? []) as SnackReplyRow[]
      }

      if (modules.syzygy) {
        const [{ data: syzygyPosts, error: syzygyPostError }, { data: syzygyReplies, error: syzygyReplyError }] = await Promise.all([
          supabase
            .from('syzygy_posts')
            .select('id,content,created_at,updated_at,is_deleted')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('syzygy_replies')
            .select('id,post_id,author_role,content,created_at,is_deleted')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true }),
        ])
        if (syzygyPostError || syzygyReplyError) {
          throw syzygyPostError ?? syzygyReplyError
        }
        baseData.syzygyPosts = (syzygyPosts ?? []) as SyzygyPostRow[]
        baseData.syzygyReplies = (syzygyReplies ?? []) as SyzygyReplyRow[]
      }

      if (modules.memory) {
        const { data: memoryRows, error: memoryError } = await supabase
          .from('memory_entries')
          .select('id,content,status,created_at,is_deleted')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
        if (memoryError) {
          throw memoryError
        }
        baseData.memoryEntries = (memoryRows ?? []) as MemoryEntryRow[]
      }

      if (modules.checkins) {
        const { data: checkinRows, error: checkinError } = await supabase
          .from('checkins')
          .select('id,checkin_date,created_at')
          .eq('user_id', user.id)
          .order('checkin_date', { ascending: false })
        if (checkinError) {
          throw checkinError
        }
        baseData.checkins = (checkinRows ?? []) as CheckinRow[]
      }

      if (modules.forum) {
        const [{ data: forumThreads, error: forumThreadError }, { data: forumReplies, error: forumReplyError }] = await Promise.all([
          supabase
            .from('forum_threads')
            .select('id,title,body,author_type,author_name,created_at,updated_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true }),
          supabase
            .from('forum_replies')
            .select('id,thread_id,body,author_type,author_name,created_at,parent_id,reply_to_reply_id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true }),
        ])
        if (forumThreadError || forumReplyError) {
          throw forumThreadError ?? forumReplyError
        }
        baseData.forumThreads = (forumThreads ?? []) as ForumThreadRow[]
        baseData.forumReplies = (forumReplies ?? []) as ForumReplyRow[]
      }

      let fileContent = ''
      let extension = 'md'
      if (format === 'json') {
        extension = 'json'
        fileContent = JSON.stringify(
          {
            meta: { exportedAt: exportedAtIso, version: 1, format: 'content-only' },
            data: baseData,
          },
          null,
          2,
        )
      } else {
        fileContent = renderMarkdown(exportedAtIso, modules, baseData)
        extension = format === 'txt' ? 'txt' : 'md'
      }

      const filename = `hamster-nest-export-${formatDownloadStamp(exportedAt)}.${extension}`
      const blob = new Blob([fileContent], {
        type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (exportError) {
      console.warn('导出失败', exportError)
      setError('导出失败，请稍后重试。')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={`export-page ${entryMode === 'game' ? 'game-feature-page' : ''}`}>
      {entryMode === 'phone' ? (
        <header className="export-header">
          <button type="button" className="ghost" onClick={() => navigate(-1)}>
            返回
          </button>
        <h1 className="ui-title">数据导出</h1>
          <button type="button" className="ghost" onClick={() => navigate('/')}>
            聊天
          </button>
        </header>
      ) : null}

      <section className="export-card export-package-card">
        <span className="export-washi-tape" aria-hidden="true" />
        <h2 className="ui-title">我的数据仓库 📦🐹</h2>

        <div className="export-subsection">
          <h3>格式便签贴</h3>
          <div className="export-format-stickers" role="radiogroup" aria-label="导出格式">
            {formatOptions.map((option) => {
              const isActive = format === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`export-sticker ${isActive ? 'active' : ''}`}
                  onClick={() => setFormat(option.value)}
                >
                  {isActive ? '✔ ' : ''}
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="export-subsection">
          <h3>导出模块</h3>
          <label>
            <input type="checkbox" checked={modules.chat} onChange={() => toggleModule('chat')} />
            吱吱吱区（sessions + messages）
          </label>
          <label>
            <input type="checkbox" checked={modules.snacks} onChange={() => toggleModule('snacks')} />
            零食罐罐（snack_posts + snack_replies）
          </label>
          <label>
            <input type="checkbox" checked={modules.syzygy} onChange={() => toggleModule('syzygy')} />
            仓鼠饲养日志（syzygy_posts + syzygy_replies）
          </label>
          <label>
            <input type="checkbox" checked={modules.memory} onChange={() => toggleModule('memory')} />
            囤囤库（memory_entries）
          </label>
          <label>
            <input type="checkbox" checked={modules.checkins} onChange={() => toggleModule('checkins')} />
            打卡（checkins）
          </label>
          <label>
            <input type="checkbox" checked={modules.forum} onChange={() => toggleModule('forum')} />
            论坛区（forum_threads + forum_replies）
          </label>
        </div>

        <p className="export-note">可一次性打包多个模块，导出后将自动下载到本地设备。</p>
        <p className="export-signoff">Your memories are safely packed by Syzygy. 🎀</p>

        {warning ? <p className="tips">{warning}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <button
          type="button"
          className="export-button"
          disabled={!user || !supabase || selectedCount === 0 || exporting}
          onClick={() => void handleExport()}
        >
          {exporting ? '打包中…' : '打包我的藏品 / Pack My Hoard 📥✨'}
        </button>
      </section>
    </div>
  )
}

export default ExportPage
