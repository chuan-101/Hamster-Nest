import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import './RagSettingsPage.css'

type RagConfigRow = {
  id: string
  user_id: string
  config_key: string
  config_value: string
}

type RagConfigState = {
  rag_enabled: boolean
  embedding_model: string
  api_provider: string
  top_k: number
  similarity_threshold: number
  retrieval_areas: string[]
  rp_retrieval_mode: string
}

const DEFAULT_CONFIG: RagConfigState = {
  rag_enabled: false,
  embedding_model: 'text-embedding-3-small',
  api_provider: 'openrouter',
  top_k: 5,
  similarity_threshold: 0.7,
  retrieval_areas: ['daily_chat'],
  rp_retrieval_mode: 'story_group',
}

const RETRIEVAL_AREA_OPTIONS = [
  { value: 'daily_chat', label: '日常聊天' },
  { value: 'bubble', label: 'Bubble' },
  { value: 'letter', label: '信件' },
  { value: 'diary', label: '日记' },
]

const RP_MODE_OPTIONS = [
  { value: 'story_group', label: '按故事组' },
  { value: 'session', label: '按窗口' },
  { value: 'all_rp', label: '全部RP' },
]

const getUserId = async () => {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

const fetchRagConfig = async (): Promise<RagConfigRow[]> => {
  if (!supabase) return []
  const userId = await getUserId()
  if (!userId) return []
  const { data, error } = await supabase
    .from('rag_config')
    .select()
    .eq('user_id', userId)
  if (error) throw error
  return data ?? []
}

const upsertRagConfig = async (key: string, value: string) => {
  if (!supabase) return
  const userId = await getUserId()
  if (!userId) return
  const { error } = await supabase
    .from('rag_config')
    .upsert(
      { user_id: userId, config_key: key, config_value: value },
      { onConflict: 'user_id,config_key' },
    )
  if (error) throw error
}

const parseRows = (rows: RagConfigRow[]): RagConfigState => {
  const map = new Map(rows.map((r) => [r.config_key, r.config_value]))
  return {
    rag_enabled: map.get('rag_enabled') === 'true',
    embedding_model: map.get('embedding_model') ?? DEFAULT_CONFIG.embedding_model,
    api_provider: map.get('api_provider') ?? DEFAULT_CONFIG.api_provider,
    top_k: Number(map.get('top_k')) || DEFAULT_CONFIG.top_k,
    similarity_threshold: Number(map.get('similarity_threshold')) || DEFAULT_CONFIG.similarity_threshold,
    retrieval_areas: map.has('retrieval_areas')
      ? JSON.parse(map.get('retrieval_areas')!) as string[]
      : DEFAULT_CONFIG.retrieval_areas,
    rp_retrieval_mode: map.get('rp_retrieval_mode') ?? DEFAULT_CONFIG.rp_retrieval_mode,
  }
}

const RagSettingsPage = () => {
  const [config, setConfig] = useState<RagConfigState>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchRagConfig()
      setConfig(parseRows(rows))
    } catch {
      setError('加载RAG配置失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (key: string, value: string) => {
    setSaving(key)
    setError(null)
    try {
      await upsertRagConfig(key, value)
    } catch {
      setError(`保存 ${key} 失败，请重试。`)
    } finally {
      setSaving(null)
    }
  }

  const handleToggle = (checked: boolean) => {
    setConfig((c) => ({ ...c, rag_enabled: checked }))
    void save('rag_enabled', String(checked))
  }

  const handleSelect = (key: 'embedding_model' | 'api_provider', value: string) => {
    setConfig((c) => ({ ...c, [key]: value }))
    void save(key, value)
  }

  const handleTopK = (value: number) => {
    const clamped = Math.min(20, Math.max(1, value))
    setConfig((c) => ({ ...c, top_k: clamped }))
    void save('top_k', String(clamped))
  }

  const handleThreshold = (value: number) => {
    const rounded = Math.round(value * 100) / 100
    setConfig((c) => ({ ...c, similarity_threshold: rounded }))
    void save('similarity_threshold', String(rounded))
  }

  const handleAreaToggle = (area: string) => {
    setConfig((prev) => {
      const current = prev.retrieval_areas
      const next = current.includes(area)
        ? current.filter((a) => a !== area)
        : [...current, area]
      void save('retrieval_areas', JSON.stringify(next))
      return { ...prev, retrieval_areas: next }
    })
  }

  const handleRpMode = (mode: string) => {
    setConfig((c) => ({ ...c, rp_retrieval_mode: mode }))
    void save('rp_retrieval_mode', mode)
  }

  const navigate = useNavigate()

  return (
    <div className="rag-settings-page app-shell">
      <header className="rag-settings-header">
        <button
          type="button"
          className="ghost"
          onClick={() => navigate(-1)}
        >
          返回
        </button>
        <h1 className="ui-title">记忆引擎</h1>
        <span style={{ width: 40 }} />
      </header>

      <div className="rag-settings-content">
        {loading ? (
          <p className="rag-settings-loading">加载中…</p>
        ) : (
          <>
            {error ? <p className="rag-settings-error">{error}</p> : null}

            {/* RAG 总开关 */}
            <div className="rag-settings-card">
              <div className="rag-settings-row">
                <span className="rag-settings-label">RAG 总开关</span>
                <label className="rag-toggle">
                  <input
                    type="checkbox"
                    checked={config.rag_enabled}
                    onChange={(e) => handleToggle(e.target.checked)}
                    disabled={saving === 'rag_enabled'}
                  />
                  <span className="rag-toggle__label">
                    {config.rag_enabled ? '已开启' : '已关闭'}
                  </span>
                </label>
              </div>
            </div>

            {/* Embedding 模型 */}
            <div className="rag-settings-card">
              <div className="rag-settings-row">
                <span className="rag-settings-label">Embedding 模型</span>
                <select
                  className="rag-settings-select"
                  value={config.embedding_model}
                  onChange={(e) => handleSelect('embedding_model', e.target.value)}
                  disabled={saving === 'embedding_model'}
                >
                  <option value="text-embedding-3-small">text-embedding-3-small</option>
                  <option value="text-embedding-3-large">text-embedding-3-large</option>
                </select>
              </div>
            </div>

            {/* API 提供商 */}
            <div className="rag-settings-card">
              <div className="rag-settings-row">
                <span className="rag-settings-label">API 提供商</span>
                <select
                  className="rag-settings-select"
                  value={config.api_provider}
                  onChange={(e) => handleSelect('api_provider', e.target.value)}
                  disabled={saving === 'api_provider'}
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
            </div>

            {/* Top-K */}
            <div className="rag-settings-card">
              <div className="rag-settings-row rag-settings-row--vertical">
                <span className="rag-settings-label">
                  检索数量 Top-K
                  <span className="rag-settings-value">{config.top_k}</span>
                </span>
                <input
                  type="range"
                  className="rag-slider"
                  min={1}
                  max={20}
                  step={1}
                  value={config.top_k}
                  onChange={(e) => handleTopK(Number(e.target.value))}
                  disabled={saving === 'top_k'}
                />
              </div>
            </div>

            {/* 相似度阈值 */}
            <div className="rag-settings-card">
              <div className="rag-settings-row rag-settings-row--vertical">
                <span className="rag-settings-label">
                  相似度阈值
                  <span className="rag-settings-value">{config.similarity_threshold.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  className="rag-slider"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={config.similarity_threshold}
                  onChange={(e) => handleThreshold(Number(e.target.value))}
                  disabled={saving === 'similarity_threshold'}
                />
              </div>
            </div>

            {/* 日常聊天检索区域 */}
            <div className="rag-settings-card">
              <div className="rag-settings-row rag-settings-row--vertical">
                <span className="rag-settings-label">日常聊天检索区域</span>
                <div className="rag-checkbox-group">
                  {RETRIEVAL_AREA_OPTIONS.map((opt) => (
                    <label key={opt.value} className="rag-checkbox">
                      <input
                        type="checkbox"
                        checked={config.retrieval_areas.includes(opt.value)}
                        onChange={() => handleAreaToggle(opt.value)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* RP 检索模式 */}
            <div className="rag-settings-card">
              <div className="rag-settings-row rag-settings-row--vertical">
                <span className="rag-settings-label">RP 检索模式</span>
                <div className="rag-radio-group">
                  {RP_MODE_OPTIONS.map((opt) => (
                    <label key={opt.value} className="rag-radio">
                      <input
                        type="radio"
                        name="rp_retrieval_mode"
                        value={opt.value}
                        checked={config.rp_retrieval_mode === opt.value}
                        onChange={() => handleRpMode(opt.value)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {saving ? (
              <p className="rag-settings-saving">保存中…</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

export default RagSettingsPage
