import { useEffect, useState } from 'react'
import GameSystemModal from './GameSystemModal'
import { getAllDayGroups, type BubbleDayGroup } from '../utils/bubbleChatHistory'

type BubbleChatHistoryModalProps = {
  onClose: () => void
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatDateLabel(dateStr: string): string {
  const [, monthStr, dayStr] = dateStr.split('-')
  const month = Number(monthStr)
  const day = Number(dayStr)
  return `${month}月${day}日`
}

const BubbleChatHistoryModal = ({ onClose }: BubbleChatHistoryModalProps) => {
  const [dayGroups, setDayGroups] = useState<BubbleDayGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await getAllDayGroups()
        if (!cancelled) {
          setDayGroups(result)
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

  const handleToggleDay = (dateStr: string) => {
    setExpandedDate((prev) => (prev === dateStr ? null : dateStr))
  }

  return (
    <GameSystemModal
      title="闲聊记录"
      subtitle="气泡聊天历史记录"
      ariaLabel="气泡聊天历史记录"
      onClose={onClose}
      contentClassName="game-system-modal__content--history"
    >
      {loading ? (
        <div className="bubble-history-empty">
          <p className="bubble-history-empty__text">加载中…</p>
        </div>
      ) : dayGroups.length === 0 ? (
        <div className="bubble-history-empty">
          <p className="bubble-history-empty__icon">💬</p>
          <p className="bubble-history-empty__text">
            还没有聊天记录哦
          </p>
          <p className="bubble-history-empty__hint">
            在下方输入栏跟 Syzygy 说点什么吧
          </p>
        </div>
      ) : (
        <div className="bubble-history-list">
          {dayGroups.map((group) => {
            const isExpanded = expandedDate === group.sessionDate
            return (
              <div key={group.sessionDate} className="bubble-history-day">
                <button
                  type="button"
                  className={`bubble-history-day__header${isExpanded ? ' bubble-history-day__header--expanded' : ''}`}
                  onClick={() => handleToggleDay(group.sessionDate)}
                  aria-expanded={isExpanded}
                >
                  <span className="bubble-history-day__label">
                    {formatDateLabel(group.sessionDate)} · 气泡聊天记录
                  </span>
                  <span className="bubble-history-day__count">
                    {group.entries.length} 条
                  </span>
                  <span className="bubble-history-day__chevron" aria-hidden="true">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </button>
                {isExpanded && (
                  <div className="bubble-history-day__body">
                    {group.entries.map((entry, index) => (
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
              </div>
            )
          })}
        </div>
      )}
    </GameSystemModal>
  )
}

export default BubbleChatHistoryModal
