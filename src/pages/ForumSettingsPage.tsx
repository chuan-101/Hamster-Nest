import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { useEnabledModels } from '../hooks/useEnabledModels'
import type { ForumAiProfile } from '../types'
import { fetchForumAiProfiles, upsertForumAiProfile } from '../storage/supabaseSync'
import { FORUM_AI_SLOTS, clampForumContextTokenLimit, clampForumMaxOutputTokens, defaultForumProfile } from './forumShared'
import './ForumPage.css'

type ForumSettingsPageProps = {
  user: User | null
}

type EditorMode =
  | { type: 'list' }
  | { type: 'edit'; slotIndex: number }

const toCard = (slotIndex: number, profile?: ForumAiProfile): ForumAiProfile => ({
  ...(profile ?? {
    ...defaultForumProfile(slotIndex),
    id: `slot-${slotIndex}`,
    userId: '',
    createdAt: '',
    updatedAt: '',
  }),
})

const ForumSettingsPage = ({ user }: ForumSettingsPageProps) => {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<ForumAiProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [savingSlot, setSavingSlot] = useState<number | null>(null)
  const [mode, setMode] = useState<EditorMode>({ type: 'list' })
  const [draft, setDraft] = useState<ForumAiProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { enabledModelOptions } = useEnabledModels(user)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const data = await fetchForumAiProfiles()
        setProfiles(data.sort((a, b) => a.slotIndex - b.slotIndex))
      } catch (loadError) {
        console.warn('加载论坛 AI 档案失败', loadError)
        setError('加载失败，请稍后重试。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const cardsBySlot = useMemo(() => {
    const map = new Map<number, ForumAiProfile>()
    profiles.forEach((item) => map.set(item.slotIndex, item))
    return map
  }, [profiles])

  const enabledCount = useMemo(() => profiles.filter((item) => item.enabled).length, [profiles])

  const nextAvailableSlot = useMemo(
    () => FORUM_AI_SLOTS.find((slot) => !cardsBySlot.has(slot)) ?? null,
    [cardsBySlot],
  )

  const visibleCards = useMemo(
    () => profiles.slice().sort((a, b) => a.slotIndex - b.slotIndex),
    [profiles],
  )

  const startAdd = () => {
    if (nextAvailableSlot === null) {
      return
    }
    setDraft(toCard(nextAvailableSlot))
    setMode({ type: 'edit', slotIndex: nextAvailableSlot })
    setError(null)
  }

  const startEdit = (slotIndex: number) => {
    setDraft(toCard(slotIndex, cardsBySlot.get(slotIndex)))
    setMode({ type: 'edit', slotIndex })
    setError(null)
  }

  const handleSave = async () => {
    if (!draft) {
      return
    }
    setSavingSlot(draft.slotIndex)
    setError(null)
    try {
      const saved = await upsertForumAiProfile(draft.slotIndex, {
        enabled: draft.enabled,
        displayName: draft.displayName,
        systemPrompt: draft.systemPrompt,
        model: draft.model,
        temperature: draft.temperature,
        topP: draft.topP,
        contextTokenLimit: clampForumContextTokenLimit(draft.contextTokenLimit),
        maxOutputTokens: clampForumMaxOutputTokens(draft.maxOutputTokens),
        apiBaseUrl: '',
      })
      setProfiles((current) => {
        const map = new Map<number, ForumAiProfile>()
        current.forEach((item) => map.set(item.slotIndex, item))
        map.set(saved.slotIndex, saved)
        return Array.from(map.values()).sort((a, b) => a.slotIndex - b.slotIndex)
      })
      setMode({ type: 'list' })
      setDraft(null)
    } catch (saveError) {
      console.warn('保存论坛 AI 档案失败', saveError)
      setError(`保存 AI 卡 ${draft.slotIndex} 失败，请重试。`)
    } finally {
      setSavingSlot(null)
    }
  }

  const editingModelEnabled =
    draft?.model.trim() && enabledModelOptions.length > 0
      ? enabledModelOptions.some((model) => model.id === draft.model.trim())
      : true

  return (
    <div className="forum-page forum-settings-page app-shell__content">
      <div className="forum-page__wrapper forum-settings-shell">
        <header className="forum-header forum-header--index forum-settings-header">
          <button type="button" className="forum-pixel-btn" onClick={() => navigate('/forum')}>
            返回论坛
          </button>
          <h1 className="ui-title">论坛 AI 设置</h1>
          <span className="forum-settings-header__spacer" aria-hidden="true" />
        </header>

        <section className="forum-thread-list forum-settings-content">
          {loading ? <p className="forum-loading">加载中…</p> : null}
          {error ? <p className="forum-error">{error}</p> : null}

          {mode.type === 'list' ? (
            <section className="forum-settings-list">
              <div className="forum-settings-strip">
                <p className="forum-settings-summary">已启用 {enabledCount}/{FORUM_AI_SLOTS.length} 张 AI 卡</p>
                <button type="button" className="forum-pixel-btn forum-pixel-btn--primary" onClick={startAdd} disabled={nextAvailableSlot === null}>
                  新增 AI 卡片
                </button>
              </div>

              {visibleCards.length === 0 ? <p className="tips">还没有已保存的 AI 卡片，先添加一个吧。</p> : null}

              <div className="forum-settings-list__cards">
                {visibleCards.map((card) => {
                  const modelLabel = card.model.trim() ? card.model.trim() : '默认模型（跟随全局）'
                  return (
                    <article key={card.slotIndex} className="forum-settings-summary-card">
                      <div className="forum-settings-summary-card__row">
                        <p className="forum-settings-summary-card__name">
                          {card.enabled ? <span className="forum-settings-summary-card__dot" aria-hidden="true" /> : null}
                          <span>{card.displayName || `AI 卡 ${card.slotIndex}`}</span>
                        </p>
                        <button type="button" className="forum-pixel-btn forum-pixel-btn--subtle" onClick={() => startEdit(card.slotIndex)}>
                          编辑
                        </button>
                      </div>
                      <p className="forum-settings-summary-card__meta">AI 卡 {card.slotIndex}</p>
                      <p className="forum-settings-summary-card__meta">模型：{modelLabel}</p>
                      <p className="forum-settings-summary-card__meta">状态：{card.enabled ? '已启用' : '未启用'}</p>
                      <p className="forum-settings-summary-card__meta">上下文约束：{card.contextTokenLimit}</p>
                      <p className="forum-settings-summary-card__meta">最大输出 tokens：{card.maxOutputTokens}</p>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          {mode.type === 'edit' && draft ? (
            <section className="forum-settings-editor">
              <h2 className="ui-title">{cardsBySlot.has(mode.slotIndex) ? '编辑 AI 卡片' : '新增 AI 卡片'}</h2>
              <p className="forum-settings-summary">AI 卡 {mode.slotIndex}</p>
              <label>
                <span>显示名称</span>
                <input
                  className="input-glass"
                  value={draft.displayName}
                  onChange={(event) => setDraft((current) => (current ? { ...current, displayName: event.target.value } : current))}
                />
              </label>
              <label>
                <span>System Prompt</span>
                <textarea
                  className="textarea-glass"
                  rows={5}
                  value={draft.systemPrompt}
                  onChange={(event) => setDraft((current) => (current ? { ...current, systemPrompt: event.target.value } : current))}
                />
              </label>
              <label>
                <span>模型</span>
                <select
                  className="input-glass"
                  value={draft.model}
                  onChange={(event) => setDraft((current) => (current ? { ...current, model: event.target.value } : current))}
                  disabled={enabledModelOptions.length === 0}
                >
                  <option value="">默认模型（跟随全局）</option>
                  {enabledModelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              {!editingModelEnabled && draft.model.trim() ? (
                <p className="forum-model-warning">当前：{draft.model.trim()}（未在全局模型库启用）</p>
              ) : null}
              <div className="forum-settings-editor__grid">
                <label>
                  <span>温度</span>
                  <input
                    className="input-glass"
                    type="number"
                    step="0.1"
                    value={draft.temperature}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, temperature: Number(event.target.value) } : current))
                    }
                  />
                </label>
                <label>
                  <span>Top P</span>
                  <input
                    className="input-glass"
                    type="number"
                    step="0.1"
                    value={draft.topP}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, topP: Number(event.target.value) } : current))
                    }
                  />
                </label>

                <label>
                  <span>上下文约束</span>
                  <input
                    className="input-glass"
                    type="number"
                    min={8000}
                    max={128000}
                    step={1}
                    value={draft.contextTokenLimit}
                    onChange={(event) => {
                      const raw = Number(event.target.value)
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              contextTokenLimit:
                                Number.isFinite(raw) && raw >= 8000 && raw <= 128000
                                  ? Math.round(raw)
                                  : 32000,
                            }
                          : current,
                      )
                    }}
                  />
                  <small>范围 8000 - 128000，默认 32000</small>
                </label>

                <label>
                  <span>最大输出 tokens</span>
                  <input
                    className="input-glass"
                    type="number"
                    min={128}
                    max={4000}
                    step={1}
                    value={draft.maxOutputTokens}
                    onChange={(event) => {
                      const raw = Number(event.target.value)
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              maxOutputTokens:
                                Number.isFinite(raw) && raw >= 128 && raw <= 4000
                                  ? Math.round(raw)
                                  : 1600,
                            }
                          : current,
                      )
                    }}
                  />
                  <small>范围 128 - 4000，默认 1600（用于论坛回复生成）</small>
                </label>
              </div>
              <label className="forum-settings-toggle">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft((current) => (current ? { ...current, enabled: event.target.checked } : current))}
                />
                <span>启用该 AI 卡</span>
              </label>
              <div className="forum-editor__actions forum-settings-actions">
                <button
                  type="button"
                  className="forum-pixel-btn"
                  onClick={() => {
                    setMode({ type: 'list' })
                    setDraft(null)
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="forum-pixel-btn forum-pixel-btn--primary"
                  disabled={savingSlot === draft.slotIndex}
                  onClick={() => void handleSave()}
                >
                  {savingSlot === draft.slotIndex ? '保存中…' : '保存'}
                </button>
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </div>
  )
}

export default ForumSettingsPage
