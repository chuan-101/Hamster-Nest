import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ExtractMessageInput, MemoryEntry } from '../types'
import {
  confirmMemory,
  createMemory,
  discardMemory,
  listMemories,
  updateMemory,
} from '../storage/supabaseSync'
import { invokeMemoryExtraction } from '../storage/memoryExtraction'
import { loadMemoryMergeEnabled, saveMemoryMergeEnabled } from '../storage/userSettings'
import { supabase } from '../supabase/client'
import './MemoryVaultPage.css'

const MemoryVaultPage = ({ recentMessages }: { recentMessages: ExtractMessageInput[] }) => {
  const navigate = useNavigate()
  const [confirmed, setConfirmed] = useState<MemoryEntry[]>([])
  const [pending, setPending] = useState<MemoryEntry[]>([])
  const [newMemory, setNewMemory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractMessage, setExtractMessage] = useState<string | null>(null)
  const [mergeEnabled, setMergeEnabled] = useState(true)
  const [mergeSaving, setMergeSaving] = useState(false)

  const loadMemories = useCallback(async () => {
    try {
      const [confirmedRows, pendingRows] = await Promise.all([
        listMemories('confirmed'),
        listMemories('pending'),
      ])
      setConfirmed(confirmedRows)
      setPending(pendingRows)
      setError(null)
    } catch (loadError) {
      console.warn('加载记忆失败', loadError)
      setError('加载记忆失败，请稍后重试')
    }
  }, [])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  useEffect(() => {
    if (!supabase) {
      return
    }
    const client = supabase
    let active = true
    const loadMergeEnabled = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await client.auth.getUser()
        if (userError || !user || !active) {
          return
        }
        const enabled = await loadMemoryMergeEnabled(user.id)
        if (active) {
          setMergeEnabled(enabled)
        }
      } catch (loadError) {
        console.warn('读取归并设置失败', loadError)
      }
    }
    void loadMergeEnabled()
    return () => {
      active = false
    }
  }, [])

  const handleToggleMerge = async () => {
    if (!supabase || mergeSaving) {
      return
    }
    const client = supabase
    try {
      setMergeSaving(true)
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser()
      if (userError || !user) {
        throw userError ?? new Error('登录状态异常，请重新登录')
      }
      const nextEnabled = !mergeEnabled
      await saveMemoryMergeEnabled(user.id, nextEnabled)
      setMergeEnabled(nextEnabled)
    } catch (toggleError) {
      console.warn('保存归并设置失败', toggleError)
      setError('保存归并设置失败，请稍后重试')
    } finally {
      setMergeSaving(false)
    }
  }

  const handleCreate = async () => {
    const trimmed = newMemory.trim()
    if (!trimmed) {
      return
    }
    setSaving(true)
    try {
      await createMemory(trimmed)
      setNewMemory('')
      await loadMemories()
    } catch (createError) {
      console.warn('创建记忆失败', createError)
      setError('创建记忆失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async (id: string) => {
    const trimmed = editingDraft.trim()
    if (!trimmed) {
      return
    }
    setSaving(true)
    try {
      await updateMemory(id, trimmed)
      setEditingId(null)
      setEditingDraft('')
      await loadMemories()
    } catch (updateError) {
      console.warn('更新记忆失败', updateError)
      setError('更新记忆失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirm = async (entry: MemoryEntry, editedContent?: string) => {
    setSaving(true)
    try {
      await confirmMemory(entry.id, editedContent)
      if (editingId === entry.id) {
        setEditingId(null)
        setEditingDraft('')
      }
      await loadMemories()
    } catch (confirmError) {
      console.warn('确认记忆失败', confirmError)
      setError('确认记忆失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = async (id: string) => {
    setSaving(true)
    try {
      await discardMemory(id)
      await loadMemories()
    } catch (discardError) {
      console.warn('删除记忆失败', discardError)
      setError('删除记忆失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleExtractSuggestions = async () => {
    if (extracting) {
      return
    }
    setExtracting(true)
    setExtractMessage(null)
    setError(null)
    try {
      const result = await invokeMemoryExtraction(recentMessages, mergeEnabled)
      setExtractMessage(`已抽取建议：新增 ${result.inserted} 条，跳过 ${result.skipped} 条。`)
      await loadMemories()
    } catch (extractError) {
      console.warn('抽取建议失败', extractError)
      setError(extractError instanceof Error ? extractError.message : '抽取建议失败，请稍后重试')
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="memory-page">
      <header className="memory-header">
        <button type="button" className="ghost" onClick={() => navigate(-1)}>
          返回
        </button>
        <h1>Memory Vault</h1>
        <button type="button" className="ghost" onClick={() => navigate('/')}>
          聊天
        </button>
      </header>

      <section className="memory-section">
        <h2>Confirmed</h2>
        <textarea
          value={newMemory}
          onChange={(event) => setNewMemory(event.target.value)}
          placeholder="新增一条确认记忆"
          rows={3}
        />
        <button type="button" onClick={handleCreate} disabled={saving || !newMemory.trim()}>
          保存
        </button>
        <div className="memory-list">
          {confirmed.length === 0 ? <p className="tips">暂无 confirmed 记忆</p> : null}
          {confirmed.map((entry) => (
            <article key={entry.id} className="memory-card">
              {editingId === entry.id ? (
                <textarea
                  rows={3}
                  value={editingDraft}
                  onChange={(event) => setEditingDraft(event.target.value)}
                />
              ) : (
                <p>{entry.content}</p>
              )}
              <div className="memory-actions">
                {editingId === entry.id ? (
                  <>
                    <button type="button" onClick={() => void handleSaveEdit(entry.id)} disabled={saving}>
                      保存编辑
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setEditingId(null)
                        setEditingDraft('')
                      }}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(entry.id)
                        setEditingDraft(entry.content)
                      }}
                    >
                      编辑
                    </button>
                    <button type="button" className="danger" onClick={() => void handleDiscard(entry.id)}>
                      删除
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="memory-section">
        <div className="memory-section-heading">
          <h2>Pending</h2>
          <button
            type="button"
            role="switch"
            aria-checked={mergeEnabled}
            className={`merge-toggle ${mergeEnabled ? 'is-on' : 'is-off'}`}
            onClick={() => void handleToggleMerge()}
            disabled={mergeSaving}
          >
            <span className="merge-toggle-label">自动归并同类项（额外模型调用）</span>
            <span className="merge-toggle-state">{mergeEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => void handleExtractSuggestions()}
          disabled={extracting || recentMessages.length === 0}
        >
          {extracting ? 'Extracting…' : 'Extract suggestions'}
        </button>
        {recentMessages.length === 0 ? <p className="tips">暂无可抽取的聊天上下文</p> : null}
        {extractMessage ? <p className="tips">{extractMessage}</p> : null}
        <div className="memory-list">
          {pending.length === 0 ? <p className="tips">暂无 pending 记忆</p> : null}
          {pending.map((entry) => (
            <article key={entry.id} className="memory-card">
              {editingId === entry.id ? (
                <textarea
                  rows={3}
                  value={editingDraft}
                  onChange={(event) => setEditingDraft(event.target.value)}
                />
              ) : (
                <p>{entry.content}</p>
              )}
              <div className="memory-actions">
                {editingId === entry.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleConfirm(entry, editingDraft.trim())}
                      disabled={saving || !editingDraft.trim()}
                    >
                      编辑并确认
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setEditingId(null)
                        setEditingDraft('')
                      }}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => void handleConfirm(entry)} disabled={saving}>
                      确认
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(entry.id)
                        setEditingDraft(entry.content)
                      }}
                    >
                      编辑+确认
                    </button>
                    <button type="button" className="danger" onClick={() => void handleDiscard(entry.id)}>
                      丢弃
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}

export default MemoryVaultPage
