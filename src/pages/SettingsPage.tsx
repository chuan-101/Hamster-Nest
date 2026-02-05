import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import type { UserSettings } from '../types'
import { supabase } from '../supabase/client'
import './SettingsPage.css'

type OpenRouterModel = {
  id: string
  name?: string
  context_length?: number | null
}

type SettingsPageProps = {
  user: User | null
  settings: UserSettings | null
  ready: boolean
  onUpdateSettings: (updater: (current: UserSettings) => UserSettings) => void
}

const defaultModelId = 'openrouter/auto'

const SettingsPage = ({ user, settings, ready, onUpdateSettings }: SettingsPageProps) => {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [catalog, setCatalog] = useState<OpenRouterModel[]>([])
  const [catalogStatus, setCatalogStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [pendingDisable, setPendingDisable] = useState<string | null>(null)
  const [temperatureInput, setTemperatureInput] = useState('')
  const [topPInput, setTopPInput] = useState('')
  const [maxTokensInput, setMaxTokensInput] = useState('')
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('')
  const [systemPromptStatus, setSystemPromptStatus] = useState<'idle' | 'saved'>('idle')
  const [showUnsavedPromptDialog, setShowUnsavedPromptDialog] = useState(false)
  const [errors, setErrors] = useState<{ temperature?: string; topP?: string; maxTokens?: string }>(
    {},
  )
  const pendingNavigationRef = useRef<null | (() => void)>(null)

  useEffect(() => {
    if (!settings) {
      return
    }
    const timer = window.setTimeout(() => {
      setTemperatureInput(settings.temperature.toString())
      setTopPInput(settings.topP.toString())
      setMaxTokensInput(settings.maxTokens.toString())
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [settings])

  useEffect(() => {
    if (!settings) {
      return
    }
    const timer = window.setTimeout(() => {
      setDraftSystemPrompt(settings.systemPrompt)
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [settings])

  useEffect(() => {
    if (!user || !supabase) {
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setCatalogStatus('loading')
      setCatalogError(null)
    }, 0)
    supabase.functions
      .invoke('openrouter-models')
      .then(({ data, error }) => {
        if (!active) {
          return
        }
        if (error) {
          setCatalogStatus('error')
          setCatalogError('无法加载 OpenRouter 模型库')
          return
        }
        const models = (data?.models ?? []) as OpenRouterModel[]
        setCatalog(models)
        setCatalogStatus('idle')
      })
      .catch(() => {
        if (!active) {
          return
        }
        setCatalogStatus('error')
        setCatalogError('无法加载 OpenRouter 模型库')
      })
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [user])

  const catalogMap = useMemo(() => {
    return new Map(catalog.map((model) => [model.id, model.name ?? model.id]))
  }, [catalog])

  const filteredCatalog = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) {
      return catalog
    }
    return catalog.filter((model) => {
      const name = model.name?.toLowerCase() ?? ''
      return model.id.toLowerCase().includes(term) || name.includes(term)
    })
  }, [catalog, searchTerm])

  const visibleCatalog = useMemo(() => {
    const term = searchTerm.trim()
    if (!term) {
      return []
    }
    return filteredCatalog.slice(0, 20)
  }, [filteredCatalog, searchTerm])

  const applySettingsUpdate = useCallback((updater: (current: UserSettings) => UserSettings) => {
    onUpdateSettings((current) => ({
      ...updater(current),
      updatedAt: new Date().toISOString(),
    }))
  }, [onUpdateSettings])

  const hasUnsavedSystemPrompt = settings
    ? draftSystemPrompt !== settings.systemPrompt
    : false

  useEffect(() => {
    if (!hasUnsavedSystemPrompt) {
      return
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [hasUnsavedSystemPrompt])

  useEffect(() => {
    if (!settings) {
      return
    }
    if (settings.enabledModels.includes(settings.defaultModel)) {
      return
    }
    const fallback = settings.enabledModels.includes(defaultModelId)
      ? defaultModelId
      : settings.enabledModels[0] ?? defaultModelId
    if (fallback === settings.defaultModel) {
      return
    }
    applySettingsUpdate((current) => ({
      ...current,
      defaultModel: fallback,
    }))
  }, [settings, applySettingsUpdate])

  const handleDisableModel = () => {
    if (!settings || !pendingDisable) {
      return
    }
    const modelId = pendingDisable
    applySettingsUpdate((current) => {
      const nextEnabled = current.enabledModels.filter((id) => id !== modelId)
      const nextDefault =
        current.defaultModel === modelId ? nextEnabled[0] ?? defaultModelId : current.defaultModel
      return {
        ...current,
        enabledModels: nextEnabled,
        defaultModel: nextDefault,
      }
    })
    setPendingDisable(null)
  }

  const handleEnableModel = (modelId: string, setDefault: boolean) => {
    if (!settings) {
      return
    }
    applySettingsUpdate((current) => {
      const alreadyEnabled = current.enabledModels.includes(modelId)
      const nextEnabled = alreadyEnabled
        ? current.enabledModels
        : [...current.enabledModels, modelId]
      const nextDefault = setDefault
        ? modelId
        : current.defaultModel || (alreadyEnabled ? current.defaultModel : modelId)
      return {
        ...current,
        enabledModels: nextEnabled,
        defaultModel: nextDefault,
      }
    })
  }

  const handleSetDefault = (modelId: string) => {
    if (!settings) {
      return
    }
    applySettingsUpdate((current) => {
      const nextEnabled = current.enabledModels.includes(modelId)
        ? current.enabledModels
        : [...current.enabledModels, modelId]
      return {
        ...current,
        enabledModels: nextEnabled,
        defaultModel: modelId,
      }
    })
  }

  const handleTemperatureChange = (value: string) => {
    setTemperatureInput(value)
    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      setErrors((prev) => ({ ...prev, temperature: '请输入数字' }))
      return
    }
    if (parsed < 0 || parsed > 2) {
      setErrors((prev) => ({ ...prev, temperature: '温度需在 0 到 2 之间' }))
      return
    }
    setErrors((prev) => ({ ...prev, temperature: undefined }))
    if (settings) {
      applySettingsUpdate((current) => ({ ...current, temperature: parsed }))
    }
  }

  const handleTopPChange = (value: string) => {
    setTopPInput(value)
    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      setErrors((prev) => ({ ...prev, topP: '请输入数字' }))
      return
    }
    if (parsed < 0 || parsed > 1) {
      setErrors((prev) => ({ ...prev, topP: 'Top P 需在 0 到 1 之间' }))
      return
    }
    setErrors((prev) => ({ ...prev, topP: undefined }))
    if (settings) {
      applySettingsUpdate((current) => ({ ...current, topP: parsed }))
    }
  }

  const handleMaxTokensChange = (value: string) => {
    setMaxTokensInput(value)
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) {
      setErrors((prev) => ({ ...prev, maxTokens: '请输入整数' }))
      return
    }
    if (parsed < 32 || parsed > 4000) {
      setErrors((prev) => ({ ...prev, maxTokens: '最大 token 需在 32 到 4000 之间' }))
      return
    }
    setErrors((prev) => ({ ...prev, maxTokens: undefined }))
    if (settings) {
      applySettingsUpdate((current) => ({ ...current, maxTokens: parsed }))
    }
  }

  const handleReasoningToggle = (enabled: boolean) => {
    if (!settings) {
      return
    }
    applySettingsUpdate((current) => ({
      ...current,
      enableReasoning: enabled,
    }))
  }

  const handleSystemPromptChange = (value: string) => {
    setDraftSystemPrompt(value)
    if (systemPromptStatus !== 'idle') {
      setSystemPromptStatus('idle')
    }
  }

  const handleSaveSystemPrompt = () => {
    if (!settings || !hasUnsavedSystemPrompt) {
      return
    }
    const nextPrompt = draftSystemPrompt
    applySettingsUpdate((current) => ({
      ...current,
      systemPrompt: nextPrompt,
    }))
    setSystemPromptStatus('saved')
  }

  const requestNavigation = (action: () => void) => {
    if (!hasUnsavedSystemPrompt) {
      action()
      return
    }
    pendingNavigationRef.current = action
    setShowUnsavedPromptDialog(true)
  }

  const handleStayOnPage = () => {
    pendingNavigationRef.current = null
    setShowUnsavedPromptDialog(false)
  }

  const handleLeaveWithoutSave = () => {
    if (settings) {
      setDraftSystemPrompt(settings.systemPrompt)
    }
    setShowUnsavedPromptDialog(false)
    const pendingAction = pendingNavigationRef.current
    pendingNavigationRef.current = null
    pendingAction?.()
  }

  const handleSaveAndLeave = () => {
    if (hasUnsavedSystemPrompt) {
      handleSaveSystemPrompt()
    }
    setShowUnsavedPromptDialog(false)
    const pendingAction = pendingNavigationRef.current
    pendingNavigationRef.current = null
    pendingAction?.()
  }

  const selectedModelId = settings?.enabledModels.includes(settings.defaultModel)
    ? settings.defaultModel
    : settings?.enabledModels[0] ?? settings?.defaultModel ?? ''

  if (!ready || !settings) {
    return (
      <div className="settings-page">
        <header className="settings-header">
          <button
            type="button"
            className="ghost"
            onClick={() => requestNavigation(() => navigate(-1))}
          >
            返回
          </button>
          <h1>API设置</h1>
          <span className="header-spacer" />
        </header>
        <div className="settings-loading">正在加载设置...</div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button
          type="button"
          className="ghost"
          onClick={() => requestNavigation(() => navigate(-1))}
        >
          返回
        </button>
        <h1>API设置</h1>
        <span className="header-spacer" />
      </header>

      <section className="settings-section">
        <div className="section-title">
          <h2>仓鼠模型库</h2>
          <p>管理已启用的 OpenRouter 模型，并选择默认模型。</p>
        </div>
        {settings.enabledModels.length === 0 ? (
          <div className="empty-state">暂无启用模型，请从下方模型库启用。</div>
        ) : (
          <div className="model-select-card">
            <div className="model-select-row">
              <label htmlFor="enabled-models">默认模型</label>
              <select
                id="enabled-models"
                value={selectedModelId}
                onChange={(event) => handleSetDefault(event.target.value)}
              >
                {settings.enabledModels.map((modelId) => (
                  <option key={modelId} value={modelId}>
                    {catalogMap.get(modelId) ?? modelId}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost danger small"
                onClick={() => setPendingDisable(selectedModelId)}
              >
                停用
              </button>
            </div>
            <div className="model-selected-meta">
              <strong>{catalogMap.get(selectedModelId) ?? selectedModelId}</strong>
              <span className="model-id">{selectedModelId}</span>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="section-title">
          <h2>参数设置</h2>
          <p>调整生成参数以适配你的对话风格。</p>
        </div>
        <div className="field-group">
          <label htmlFor="temperature">温度 (0 - 2)</label>
          <input
            id="temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={temperatureInput}
            onChange={(event) => handleTemperatureChange(event.target.value)}
          />
          {errors.temperature ? <span className="field-error">{errors.temperature}</span> : null}
        </div>
        <div className="field-group">
          <label htmlFor="topP">Top P (0 - 1)</label>
          <input
            id="topP"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={topPInput}
            onChange={(event) => handleTopPChange(event.target.value)}
          />
          {errors.topP ? <span className="field-error">{errors.topP}</span> : null}
        </div>
        <div className="field-group">
          <label htmlFor="maxTokens">最大 tokens (32 - 4000)</label>
          <input
            id="maxTokens"
            type="number"
            min="32"
            max="4000"
            step="1"
            value={maxTokensInput}
            onChange={(event) => handleMaxTokensChange(event.target.value)}
          />
          {errors.maxTokens ? <span className="field-error">{errors.maxTokens}</span> : null}
        </div>
        <div className="field-group">
          <label htmlFor="enableReasoning">思考链（默认）</label>
          <label className="toggle-control">
            <input
              id="enableReasoning"
              type="checkbox"
              checked={settings.enableReasoning}
              onChange={(event) => handleReasoningToggle(event.target.checked)}
            />
            <span>{settings.enableReasoning ? '已开启' : '已关闭'}</span>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="section-title">
          <h2>系统提示词</h2>
          <p>用于引导模型的全局指令，仅对当前用户生效。</p>
        </div>
        <textarea
          className="system-prompt"
          placeholder="例如：你是一个耐心的助手，请用简洁的方式回答。"
          value={draftSystemPrompt}
          onChange={(event) => handleSystemPromptChange(event.target.value)}
        />
        <div className="system-prompt-actions">
          <button
            type="button"
            className="primary"
            disabled={!hasUnsavedSystemPrompt}
            onClick={handleSaveSystemPrompt}
          >
            保存
          </button>
          {systemPromptStatus === 'saved' ? (
            <span className="system-prompt-status">已保存</span>
          ) : null}
        </div>
      </section>

      <section className="settings-section">
        <div className="section-title">
          <h2>OpenRouter 模型库</h2>
          <p>搜索并启用你想使用的模型。</p>
        </div>
        <input
          className="search-input"
          type="search"
          placeholder="搜索模型名称或 ID"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
        {catalogStatus === 'loading' ? (
          <div className="catalog-status">正在加载模型库...</div>
        ) : null}
        {catalogStatus === 'error' ? (
          <div className="catalog-status error">{catalogError}</div>
        ) : null}
        {searchTerm.trim().length === 0 ? (
          <div className="catalog-hint">继续输入以缩小范围。</div>
        ) : null}
        {searchTerm.trim().length > 0 ? (
          <div className="catalog-dropdown">
            {visibleCatalog.length === 0 && catalogStatus !== 'loading' ? (
              <div className="catalog-empty">未找到匹配模型。</div>
            ) : null}
            <ul className="catalog-results">
              {visibleCatalog.map((model) => {
                const enabled = settings.enabledModels.includes(model.id)
                return (
                  <li key={model.id} className="catalog-result-item">
                    <div className="catalog-meta">
                      <strong>{model.name ?? model.id}</strong>
                      <span className="model-id">{model.id}</span>
                      {model.context_length ? (
                        <span className="context-length">上下文 {model.context_length}</span>
                      ) : null}
                    </div>
                    <div className="catalog-actions">
                      {enabled ? (
                        <span className="badge subtle">已启用</span>
                      ) : (
                        <button type="button" onClick={() => handleEnableModel(model.id, false)}>
                          启用
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {filteredCatalog.length > visibleCatalog.length ? (
              <div className="catalog-hint">结果较多，请继续输入以缩小范围。</div>
            ) : null}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={pendingDisable !== null}
        title="停用这个模型？"
        description="停用后模型会从仓鼠模型库移除，并不会删除云端数据。"
        confirmLabel="停用"
        onCancel={() => setPendingDisable(null)}
        onConfirm={handleDisableModel}
      />

      <ConfirmDialog
        open={showUnsavedPromptDialog}
        title="有未保存的系统提示词"
        description="离开当前页面前是否保存修改？"
        confirmLabel="保存并离开"
        cancelLabel="取消"
        neutralLabel="不保存离开"
        onCancel={handleStayOnPage}
        onNeutral={handleLeaveWithoutSave}
        onConfirm={handleSaveAndLeave}
      />
    </div>
  )
}

export default SettingsPage
