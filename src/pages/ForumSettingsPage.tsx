import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ForumAiProfile } from '../types'
import { fetchForumAiProfiles, upsertForumAiProfile } from '../storage/supabaseSync'
import { FORUM_AI_SLOTS, defaultForumProfile } from './forumShared'
import './ForumPage.css'

const toCard = (slotIndex: number, profile?: ForumAiProfile) => ({
  ...(profile ?? {
    ...defaultForumProfile(slotIndex),
    id: `slot-${slotIndex}`,
    userId: '',
    createdAt: '',
    updatedAt: '',
  }),
})

const ForumSettingsPage = () => {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<ForumAiProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [savingSlot, setSavingSlot] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const data = await fetchForumAiProfiles()
        setProfiles(data)
      } catch (loadError) {
        console.warn('加载论坛 AI 档案失败', loadError)
        setError('加载失败，请稍后重试。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const cards = useMemo(() => {
    const map = new Map<number, ForumAiProfile>()
    profiles.forEach((item) => map.set(item.slotIndex, item))
    return FORUM_AI_SLOTS.map((slot) => toCard(slot, map.get(slot)))
  }, [profiles])

  const updateCard = (slotIndex: number, updater: (card: ForumAiProfile) => ForumAiProfile) => {
    setProfiles((current) => {
      const map = new Map<number, ForumAiProfile>()
      current.forEach((item) => map.set(item.slotIndex, item))
      const card = toCard(slotIndex, map.get(slotIndex))
      map.set(slotIndex, updater(card))
      return Array.from(map.values()).sort((a, b) => a.slotIndex - b.slotIndex)
    })
  }

  const handleSave = async (slotIndex: number) => {
    const card = cards.find((item) => item.slotIndex === slotIndex)
    if (!card) {
      return
    }
    setSavingSlot(slotIndex)
    setError(null)
    try {
      const saved = await upsertForumAiProfile(slotIndex, {
        enabled: card.enabled,
        displayName: card.displayName,
        systemPrompt: card.systemPrompt,
        model: card.model,
        temperature: card.temperature,
        topP: card.topP,
        apiBaseUrl: card.apiBaseUrl,
      })
      updateCard(slotIndex, () => saved)
    } catch (saveError) {
      console.warn('保存论坛 AI 档案失败', saveError)
      setError(`保存 Slot ${slotIndex} 失败，请重试。`)
    } finally {
      setSavingSlot(null)
    }
  }

  return (
    <div className="forum-page app-shell__content">
      <header className="forum-header glass-card">
        <button type="button" className="btn-secondary" onClick={() => navigate('/forum')}>
          返回论坛
        </button>
        <h1 className="ui-title">Forum 设置</h1>
      </header>

      {loading ? <p className="forum-loading">加载中…</p> : null}
      {error ? <p className="forum-error">{error}</p> : null}

      <div className="forum-settings-grid">
        {cards.map((card) => (
          <section key={card.slotIndex} className="glass-card forum-settings-card">
            <h2 className="ui-title">AI Slot {card.slotIndex}</h2>
            <label>
              <span>Enabled</span>
              <input
                type="checkbox"
                checked={card.enabled}
                onChange={(event) =>
                  updateCard(card.slotIndex, (current) => ({ ...current, enabled: event.target.checked }))
                }
              />
            </label>
            <label>
              <span>Display name</span>
              <input
                className="input-glass"
                value={card.displayName}
                onChange={(event) =>
                  updateCard(card.slotIndex, (current) => ({ ...current, displayName: event.target.value }))
                }
              />
            </label>
            <label>
              <span>System prompt</span>
              <textarea
                className="textarea-glass"
                rows={5}
                value={card.systemPrompt}
                onChange={(event) =>
                  updateCard(card.slotIndex, (current) => ({ ...current, systemPrompt: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Model</span>
              <input
                className="input-glass"
                value={card.model}
                onChange={(event) =>
                  updateCard(card.slotIndex, (current) => ({ ...current, model: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Temperature</span>
              <input
                className="input-glass"
                type="number"
                step="0.1"
                value={card.temperature}
                onChange={(event) =>
                  updateCard(card.slotIndex, (current) => ({ ...current, temperature: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <span>Top P</span>
              <input
                className="input-glass"
                type="number"
                step="0.1"
                value={card.topP}
                onChange={(event) =>
                  updateCard(card.slotIndex, (current) => ({ ...current, topP: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <span>API base url</span>
              <input
                className="input-glass"
                value={card.apiBaseUrl}
                onChange={(event) =>
                  updateCard(card.slotIndex, (current) => ({ ...current, apiBaseUrl: event.target.value }))
                }
              />
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={savingSlot === card.slotIndex}
              onClick={() => void handleSave(card.slotIndex)}
            >
              {savingSlot === card.slotIndex ? '保存中…' : '保存'}
            </button>
          </section>
        ))}
      </div>
    </div>
  )
}

export default ForumSettingsPage
