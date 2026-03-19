import { useEffect, useState } from 'react'
import GameSystemModal from './GameSystemModal'
import { getTodayEntries, type BubbleChatEntry } from '../utils/bubbleChatHistory'

type BubbleChatHistoryModalProps = {
  onClose: () => void
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatDateHeading(): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  return `${month}月${day}日`
}

const BubbleChatHistoryModal = ({ onClose }: BubbleChatHistoryModalProps) => {
  const [entries, setEntries] = useState<BubbleChatEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await getTodayEntries()
        if (!cancelled) {
          setEntries(result)
        }
      } catch (error) {
        console.warn('[bubble-chat] Failed to load history:', error)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <GameSystemModal
      title="今日闲聊记录"
      subtitle={`${formatDateHeading()} · 气泡聊天记录`}
      ariaLabel="气泡聊天历史记录"
      onClose={onClose}
      contentClassName="game-system-modal__content--history"
    >
      {loading ? (
        <div className="bubble-history-empty">
          <p className="bubble-history-empty__text">加载中…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="bubble-history-empty">
          <p className="bubble-history-empty__icon">💬</p>
          <p className="bubble-history-empty__text">
            今天还没有聊天记录哦
          </p>
          <p className="bubble-history-empty__hint">
            在下方输入栏跟 Syzygy 说点什么吧
          </p>
        </div>
      ) : (
        <div className="bubble-history-list">
          {entries.map((entry, index) => (
            <div
              key={index}
              className={`bubble-history-entry bubble-history-entry--${entry.role}`}
            >
              <span className="bubble-history-entry__role">
                {entry.role === 'user' ? '你' : 'Syzygy'}
              </span>
              <span className="bubble-history-entry__time">
                {formatTime(entry.timestamp)}
              </span>
              <p className="bubble-history-entry__content">{entry.content}</p>
            </div>
          ))}
        </div>
      )}
    </GameSystemModal>
  )
}

export default BubbleChatHistoryModal
