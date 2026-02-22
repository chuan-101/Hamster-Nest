import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchRpSessionById } from '../storage/supabaseSync'
import type { RpSession } from '../types'
import './RpRoomPage.css'

type RpRoomPageProps = {
  user: User | null
}

const RpRoomPage = ({ user }: RpRoomPageProps) => {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [room, setRoom] = useState<RpSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadRoom = async () => {
      if (!user || !sessionId) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const data = await fetchRpSessionById(sessionId, user.id)
        if (!data) {
          setError('房间不存在，或你无权访问该房间。')
          setRoom(null)
          return
        }
        setRoom(data)
      } catch (loadError) {
        console.warn('加载 RP 房间失败', loadError)
        setError('加载房间失败，请稍后重试。')
      } finally {
        setLoading(false)
      }
    }

    void loadRoom()
  }, [sessionId, user])

  if (loading) {
    return <div className="rp-room-page"><p className="tips">房间加载中…</p></div>
  }

  if (error || !room) {
    return (
      <div className="rp-room-page">
        <header className="rp-room-header">
          <button type="button" className="ghost" onClick={() => navigate('/rp')}>
            返回房间列表
          </button>
        </header>
        <div className="rp-room-card">
          <h1>无法进入房间</h1>
          <p className="error">{error ?? '未找到房间。'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rp-room-page">
      <header className="rp-room-header">
        <button type="button" className="ghost" onClick={() => navigate('/rp')}>
          返回房间列表
        </button>
      </header>

      <section className="rp-room-card">
        <h1>{room.title || '未命名房间'}</h1>
        <p>房间 ID：{room.id}</p>
      </section>

      <section className="rp-room-card placeholder">
        <h2>时间线（Phase 2）</h2>
        <p>后续将在这里实现 rp_messages 的时间线与互动内容。</p>
      </section>

      <section className="rp-room-card placeholder">
        <h2>房间仪表盘（Phase 2）</h2>
        <p>后续将在这里配置角色、玩家信息与其他 RP 控件。</p>
      </section>
    </div>
  )
}

export default RpRoomPage
