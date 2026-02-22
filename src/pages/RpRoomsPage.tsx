import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import { createRpSession, fetchRpSessions, updateRpSessionArchiveState } from '../storage/supabaseSync'
import type { RpSession } from '../types'
import './RpRoomsPage.css'

type RpRoomsPageProps = {
  user: User | null
}

type ArchiveAction = {
  sessionId: string
  nextArchived: boolean
  title: string
}

const formatRoomTime = (session: RpSession) => {
  const timestamp = session.updatedAt ?? session.createdAt
  return new Date(timestamp).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const RpRoomsPage = ({ user }: RpRoomsPageProps) => {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<RpSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [pendingArchive, setPendingArchive] = useState<ArchiveAction | null>(null)
  const [updatingArchive, setUpdatingArchive] = useState(false)

  const isArchivedView = tab === 'archived'

  const loadRooms = useCallback(async () => {
    if (!user) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await fetchRpSessions(user.id, isArchivedView)
      setRooms(next)
    } catch (loadError) {
      console.warn('加载 RP 房间失败', loadError)
      setError('加载房间失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [isArchivedView, user])

  useEffect(() => {
    void loadRooms()
  }, [loadRooms])

  const handleCreateRoom = async () => {
    if (!user || creating) {
      return
    }
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const title = newTitle.trim().length > 0 ? newTitle.trim() : '新房间'
      const room = await createRpSession(user.id, title)
      setNotice('房间创建成功')
      setNewTitle('')
      navigate(`/rp/${room.id}`)
    } catch (createError) {
      console.warn('创建 RP 房间失败', createError)
      setError('创建房间失败，请稍后重试。')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleArchive = async () => {
    if (!pendingArchive || updatingArchive) {
      return
    }
    setUpdatingArchive(true)
    setError(null)
    setNotice(null)
    try {
      await updateRpSessionArchiveState(pendingArchive.sessionId, pendingArchive.nextArchived)
      setNotice(pendingArchive.nextArchived ? '已归档房间' : '已取消归档')
      setRooms((current) => current.filter((room) => room.id !== pendingArchive.sessionId))
      setPendingArchive(null)
    } catch (updateError) {
      console.warn('更新 RP 房间归档状态失败', updateError)
      setError('更新归档状态失败，请稍后重试。')
    } finally {
      setUpdatingArchive(false)
    }
  }

  const tabTitle = useMemo(() => (isArchivedView ? '已归档房间' : '活跃房间'), [isArchivedView])

  return (
    <div className="rp-rooms-page">
      <header className="rp-rooms-header">
        <div>
          <h1>跑跑滚轮区</h1>
          <p>管理你的 RP 房间，进入后可继续搭建角色与剧情。</p>
        </div>
        <button type="button" className="ghost" onClick={() => navigate('/')}>
          返回聊天
        </button>
      </header>

      <section className="rp-create-card">
        <h2>新建房间</h2>
        <div className="rp-create-row">
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="输入房间标题（可留空）"
            maxLength={80}
          />
          <button type="button" className="primary" disabled={creating} onClick={handleCreateRoom}>
            {creating ? '创建中…' : '新建房间'}
          </button>
        </div>
      </section>

      <section className="rp-list-card">
        <div className="rp-list-head">
          <div className="rp-tabs" role="tablist" aria-label="房间筛选">
            <button
              type="button"
              className={!isArchivedView ? 'active' : ''}
              onClick={() => setTab('active')}
            >
              活跃
            </button>
            <button
              type="button"
              className={isArchivedView ? 'active' : ''}
              onClick={() => setTab('archived')}
            >
              已归档
            </button>
          </div>
          <button type="button" className="ghost" onClick={() => void loadRooms()} disabled={loading}>
            刷新
          </button>
        </div>

        {notice ? <p className="tips">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <h2>{tabTitle}</h2>
        {loading ? <p className="tips">加载中…</p> : null}
        {!loading && rooms.length === 0 ? (
          <p className="tips">{isArchivedView ? '还没有归档房间。' : '还没有房间，先新建一个吧。'}</p>
        ) : null}

        <ul className="rp-room-list">
          {rooms.map((room) => (
            <li key={room.id} className="rp-room-item">
              <div>
                <h3>{room.title || '未命名房间'}</h3>
                <p>更新时间：{formatRoomTime(room)}</p>
              </div>
              <div className="rp-room-actions">
                <button type="button" className="ghost" onClick={() => navigate(`/rp/${room.id}`)}>
                  进入
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setPendingArchive({
                      sessionId: room.id,
                      nextArchived: !room.isArchived,
                      title: room.title || '未命名房间',
                    })
                  }
                >
                  {room.isArchived ? '取消归档' : '归档'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        title={pendingArchive?.nextArchived ? '确认归档房间？' : '确认取消归档？'}
        description={pendingArchive ? `房间：${pendingArchive.title}` : undefined}
        confirmLabel={pendingArchive?.nextArchived ? '归档' : '取消归档'}
        cancelLabel="取消"
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void handleToggleArchive()}
      />
    </div>
  )
}

export default RpRoomsPage
