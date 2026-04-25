import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WalletBalance, WalletQuest, WalletQuestCreator, WalletTransaction } from '../types'
import {
  completeWalletQuest,
  createWalletQuest,
  exchangeWalletPointsToCoins,
  fetchWalletBalance,
  listWalletQuests,
  listWalletTransactions,
  updateWalletQuest,
} from '../storage/supabaseSync'
import './WalletPage.css'

type WishEditorState = {
  mode: 'create' | 'edit'
  questId?: string
  title: string
  description: string
  rewardPoints: string
  createdBy: WalletQuestCreator
}

const CREATOR_META: Record<WalletQuestCreator, { emoji: string; label: string }> = {
  chuanchuan: { emoji: '🐹', label: '串串' },
  syzygy: { emoji: '🩵', label: 'Syzygy' },
}

const buildWishEditor = (quest?: WalletQuest): WishEditorState => ({
  mode: quest ? 'edit' : 'create',
  questId: quest?.id,
  title: quest?.title ?? '',
  description: quest?.description ?? '',
  rewardPoints: quest ? `${quest.rewardPoints}` : '',
  createdBy: quest?.createdBy ?? 'chuanchuan',
})

const beijingDateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const beijingHistoryTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const formatBeijingDateTime = (value: string | null) => {
  if (!value) {
    return '--'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }
  return beijingDateTime.format(date)
}

const formatHistoryTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }
  return beijingHistoryTime.format(date)
}

const TRANSACTION_META: Record<WalletTransaction['type'], { icon: string; label: string }> = {
  earn: { icon: '⭐', label: 'Earn' },
  exchange: { icon: '🔄', label: 'Exchange' },
  spend: { icon: '💸', label: 'Spend' },
}

const WalletPage = () => {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'open' | 'completed'>('open')
  const [balance, setBalance] = useState<WalletBalance>({ points: 0, coins: 0 })
  const [openQuests, setOpenQuests] = useState<WalletQuest[]>([])
  const [completedQuests, setCompletedQuests] = useState<WalletQuest[]>([])
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [exchangeModalOpen, setExchangeModalOpen] = useState(false)
  const [exchangePoints, setExchangePoints] = useState('')

  const [editor, setEditor] = useState<WishEditorState | null>(null)
  const [completionTarget, setCompletionTarget] = useState<WalletQuest | null>(null)
  const [completionNote, setCompletionNote] = useState('')

  const refreshAll = useCallback(async () => {
    const [nextBalance, nextOpenQuests, nextCompletedQuests, nextTransactions] = await Promise.all([
      fetchWalletBalance(),
      listWalletQuests('open'),
      listWalletQuests('completed'),
      listWalletTransactions(),
    ])
    setBalance(nextBalance)
    setOpenQuests(nextOpenQuests)
    setCompletedQuests(nextCompletedQuests)
    setTransactions(nextTransactions)
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        await refreshAll()
        if (!active) {
          return
        }
        setError(null)
      } catch (loadError) {
        console.warn('加载仓鼠钱包失败', loadError)
        if (!active) {
          return
        }
        setError('加载仓鼠钱包失败，请稍后重试')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [refreshAll])

  const openCount = openQuests.length
  const completedCount = completedQuests.length

  const activeList = useMemo(() => (activeTab === 'open' ? openQuests : completedQuests), [
    activeTab,
    completedQuests,
    openQuests,
  ])

  const handleExchangeSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) {
      return
    }
    const points = Number(exchangePoints)
    if (!Number.isInteger(points) || points <= 0) {
      setError('请输入有效积分（正整数）')
      return
    }
    setSaving(true)
    try {
      await exchangeWalletPointsToCoins(points)
      await refreshAll()
      setNotice('兑换成功')
      setError(null)
      setExchangePoints('')
      setExchangeModalOpen(false)
    } catch (exchangeError) {
      console.warn('积分兑换失败', exchangeError)
      setError('兑换失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveWish = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor || saving) {
      return
    }
    const title = editor.title.trim()
    const points = Number(editor.rewardPoints)

    if (!title) {
      setError('标题不能为空')
      return
    }
    if (!Number.isFinite(points) || points < 0) {
      setError('积分需要是大于等于 0 的数字')
      return
    }

    setSaving(true)
    try {
      if (editor.mode === 'create') {
        await createWalletQuest({
          title,
          description: editor.description,
          rewardPoints: points,
          createdBy: editor.createdBy,
        })
        setNotice('已创建新心愿')
      } else if (editor.questId) {
        await updateWalletQuest(editor.questId, {
          title,
          description: editor.description,
          rewardPoints: points,
        })
        setNotice('已更新心愿')
      }
      await refreshAll()
      setError(null)
      setEditor(null)
    } catch (saveError) {
      console.warn('保存心愿失败', saveError)
      setError('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleCompleteWish = async (event: FormEvent) => {
    event.preventDefault()
    if (!completionTarget || saving) {
      return
    }

    setSaving(true)
    try {
      await completeWalletQuest(completionTarget.id, completionNote)
      await refreshAll()
      setNotice('心愿已完成，积分已入账')
      setError(null)
      setCompletionTarget(null)
      setCompletionNote('')
      setActiveTab('completed')
    } catch (completeError) {
      console.warn('完成心愿失败', completeError)
      setError('完成失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wallet-page">
      <header className="wallet-header">
        <button type="button" className="ghost wallet-back-btn" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <div className="wallet-title-wrap">
          <p className="wallet-kicker">Hamster Wallet</p>
          <h1 className="ui-title">仓鼠钱包</h1>
        </div>
      </header>

      <section className="wallet-balance" aria-label="钱包余额">
        <article className="wallet-balance-card">
          <p>积分</p>
          <strong>{balance.points}</strong>
        </article>
        <article className="wallet-balance-card">
          <p>金币</p>
          <strong>¥{balance.coins.toFixed(2)}</strong>
        </article>
        <div className="wallet-balance-actions">
          <button type="button" className="wallet-primary-btn" onClick={() => setExchangeModalOpen(true)}>
            🔄 兑换（100 积分 = ¥1）
          </button>
        </div>
      </section>

      {notice ? <p className="wallet-notice">{notice}</p> : null}
      {error ? <p className="wallet-error">{error}</p> : null}

      <section className="wallet-wish-list" aria-label="心愿清单">
        <div className="wallet-wish-list__header">
          <h2>心愿清单</h2>
          <div className="wallet-tabs" role="tablist" aria-label="心愿状态筛选">
            <button
              type="button"
              className={activeTab === 'open' ? 'active' : ''}
              onClick={() => setActiveTab('open')}
              role="tab"
              aria-selected={activeTab === 'open'}
            >
              In Progress ({openCount})
            </button>
            <button
              type="button"
              className={activeTab === 'completed' ? 'active' : ''}
              onClick={() => setActiveTab('completed')}
              role="tab"
              aria-selected={activeTab === 'completed'}
            >
              Completed ({completedCount})
            </button>
          </div>
        </div>

        {loading ? <p className="wallet-empty">加载中...</p> : null}

        {!loading && activeList.length === 0 ? (
          <p className="wallet-empty">还没有心愿，快新增一条吧。</p>
        ) : (
          <div className="wallet-wish-list__cards">
            {activeList.map((quest) => {
              const creatorMeta = CREATOR_META[quest.createdBy]
              return (
                <article
                  key={quest.id}
                  className="wallet-wish-card"
                  onClick={
                    activeTab === 'open'
                      ? () => {
                          setEditor(buildWishEditor(quest))
                          setError(null)
                        }
                      : undefined
                  }
                  role={activeTab === 'open' ? 'button' : undefined}
                  tabIndex={activeTab === 'open' ? 0 : undefined}
                >
                  <header>
                    <span className="wallet-creator-badge" title={creatorMeta.label}>
                      {creatorMeta.emoji}
                    </span>
                    <div>
                      <h3>{quest.title}</h3>
                      <p className="wallet-points-tag">⭐ {quest.rewardPoints}</p>
                    </div>
                    {activeTab === 'open' ? (
                      <button
                        type="button"
                        className="wallet-complete-btn"
                        onClick={(event) => {
                          event.stopPropagation()
                          setCompletionTarget(quest)
                          setCompletionNote('')
                        }}
                      >
                        Complete ✓
                      </button>
                    ) : null}
                  </header>

                  {quest.description ? <p className="wallet-wish-desc">{quest.description}</p> : null}

                  {activeTab === 'completed' ? (
                    <div className="wallet-completed-meta">
                      <p>完成时间：{formatBeijingDateTime(quest.completedAt)}</p>
                      {quest.completedNote ? <p>备注：{quest.completedNote}</p> : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}

        <button type="button" className="wallet-create-btn" onClick={() => setEditor(buildWishEditor())}>
          + New Wish
        </button>
      </section>

      <section className="wallet-transactions" aria-label="交易历史">
        <button
          type="button"
          className="wallet-transactions__toggle"
          onClick={() => setHistoryExpanded((current) => !current)}
          aria-expanded={historyExpanded}
        >
          <span>📒 Transaction History</span>
          <span>{historyExpanded ? '收起' : '展开'}</span>
        </button>

        {historyExpanded ? (
          transactions.length === 0 ? (
            <p className="wallet-empty wallet-empty--compact">暂无交易记录</p>
          ) : (
            <div className="wallet-transactions__list">
              {transactions.map((item) => {
                const meta = TRANSACTION_META[item.type]
                const pointsText =
                  item.pointsDelta === 0 ? null : `${item.pointsDelta > 0 ? '+' : ''}${item.pointsDelta}`
                const coinsText =
                  item.coinsDelta === 0 ? null : `¥${item.coinsDelta > 0 ? '+' : ''}${item.coinsDelta.toFixed(2)}`

                return (
                  <div key={item.id} className="wallet-transaction-row">
                    <p>{formatHistoryTime(item.createdAt)}</p>
                    <p>
                      <span aria-hidden="true">{meta.icon}</span> {item.description || meta.label}
                    </p>
                    <div className="wallet-transaction-row__amounts">
                      {pointsText ? <span className="points">{pointsText}</span> : null}
                      {coinsText ? <span className="coins">{coinsText}</span> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : null}
      </section>

      {exchangeModalOpen ? (
        <div className="wallet-modal-backdrop" role="presentation" onClick={() => setExchangeModalOpen(false)}>
          <form className="wallet-modal" onSubmit={handleExchangeSubmit} onClick={(event) => event.stopPropagation()}>
            <h3>兑换积分</h3>
            <p>100 积分 = 1 金币 = ¥1</p>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="输入积分数量"
              value={exchangePoints}
              onChange={(event) => setExchangePoints(event.target.value)}
            />
            <div className="wallet-modal__actions">
              <button type="button" className="ghost" onClick={() => setExchangeModalOpen(false)}>
                取消
              </button>
              <button type="submit" className="wallet-primary-btn" disabled={saving}>
                兑换
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editor ? (
        <div className="wallet-modal-backdrop" role="presentation" onClick={() => setEditor(null)}>
          <form className="wallet-modal" onSubmit={handleSaveWish} onClick={(event) => event.stopPropagation()}>
            <h3>{editor.mode === 'create' ? '创建心愿' : '编辑心愿'}</h3>
            <label>
              标题（必填）
              <input
                type="text"
                value={editor.title}
                onChange={(event) => setEditor((current) => (current ? { ...current, title: event.target.value } : current))}
                required
              />
            </label>
            <label>
              描述（可选）
              <textarea
                rows={3}
                value={editor.description}
                onChange={(event) =>
                  setEditor((current) => (current ? { ...current, description: event.target.value } : current))
                }
              />
            </label>
            <label>
              积分（必填）
              <input
                type="number"
                min={0}
                step={1}
                value={editor.rewardPoints}
                onChange={(event) =>
                  setEditor((current) => (current ? { ...current, rewardPoints: event.target.value } : current))
                }
                required
              />
            </label>
            <fieldset>
              <legend>Created by</legend>
              <div className="wallet-creator-switch">
                {(Object.keys(CREATOR_META) as WalletQuestCreator[]).map((creator) => (
                  <button
                    key={creator}
                    type="button"
                    className={editor.createdBy === creator ? 'active' : ''}
                    onClick={() => setEditor((current) => (current ? { ...current, createdBy: creator } : current))}
                  >
                    {CREATOR_META[creator].emoji} {CREATOR_META[creator].label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="wallet-modal__actions">
              <button type="button" className="ghost" onClick={() => setEditor(null)}>
                取消
              </button>
              <button type="submit" className="wallet-primary-btn" disabled={saving}>
                {editor.mode === 'create' ? '创建' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {completionTarget ? (
        <div className="wallet-modal-backdrop" role="presentation" onClick={() => setCompletionTarget(null)}>
          <form className="wallet-modal" onSubmit={handleCompleteWish} onClick={(event) => event.stopPropagation()}>
            <h3>完成心愿</h3>
            <p>{completionTarget.title}</p>
            <label>
              完成备注（可选）
              <textarea
                rows={3}
                value={completionNote}
                onChange={(event) => setCompletionNote(event.target.value)}
                placeholder="一起完成了什么？"
              />
            </label>
            <div className="wallet-modal__actions">
              <button type="button" className="ghost" onClick={() => setCompletionTarget(null)}>
                取消
              </button>
              <button type="submit" className="wallet-primary-btn" disabled={saving}>
                Complete ✓
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default WalletPage
