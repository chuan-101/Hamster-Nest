import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import type { UserSettings } from '../types'
import { supabase } from '../supabase/client'
import {
  DEFAULT_SNACK_SYSTEM_OVERLAY,
  DEFAULT_SYZYGY_POST_PROMPT,
  DEFAULT_SYZYGY_REPLY_PROMPT,
  DEFAULT_LETTER_REPLY_PROMPT,
  resolveSnackSystemOverlay,
  resolveSyzygyPostPrompt,
  resolveSyzygyReplyPrompt,
  resolveLetterReplyPrompt,
} from '../constants/aiOverlays'
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
  onSaveSettings: (nextSettings: UserSettings) => Promise<void>
  onSaveMemoryExtractModel: (modelId: string | null) => Promise<void>
  onSaveSnackSystemPrompt: (value: string) => Promise<void>
  onSaveSyzygyPostPrompt: (value: string) => Promise<void>
  onSaveSyzygyReplyPrompt: (value: string) => Promise<void>
  onSaveLetterReplyPrompt: (value: string) => Promise<void>
  displayMode: 'phone' | 'game'
  onDisplayModeChange: (mode: 'phone' | 'game') => void
}

const defaultModelId = 'openrouter/auto'

const SettingsPage = ({
  user,
  settings,
  ready,
  onSaveSettings,
  onSaveMemoryExtractModel,
  onSaveSnackSystemPrompt,
  onSaveSyzygyPostPrompt,
  onSaveSyzygyReplyPrompt,
  onSaveLetterReplyPrompt,
  displayMode,
  onDisplayModeChange,
}: SettingsPageProps) => {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [catalog, setCatalog] = useState<OpenRouterModel[]>([])
  const [catalogStatus, setCatalogStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [pendingDisable, setPendingDisable] = useState<string | null>(null)
  const [temperatureInput, setTemperatureInput] = useState('')
  const [topPInput, setTopPInput] = useState('')
  const [maxTokensInput, setMaxTokensInput] = useState('')
  const [compressionEnabled, setCompressionEnabled] = useState(true)
  const [compressionRatioInput, setCompressionRatioInput] = useState('0.65')
  const [compressionKeepRecentInput, setCompressionKeepRecentInput] = useState('20')
  const [draftSummarizerModel, setDraftSummarizerModel] = useState<string | null>(null)
  const [modelSectionExpanded, setModelSectionExpanded] = useState(false)
  const [generationSectionExpanded, setGenerationSectionExpanded] = useState(false)
  const [reasoningSectionExpanded, setReasoningSectionExpanded] = useState(false)
  const [memorySectionExpanded, setMemorySectionExpanded] = useState(false)
  const [compressionSectionExpanded, setCompressionSectionExpanded] = useState(false)
  const [systemPromptSectionExpanded, setSystemPromptSectionExpanded] = useState(false)
  const [draftEnabledModels, setDraftEnabledModels] = useState<string[]>([])
  const [draftDefaultModel, setDraftDefaultModel] = useState(defaultModelId)
  const [draftChatReasoning, setDraftChatReasoning] = useState(true)
  const [draftRpReasoning, setDraftRpReasoning] = useState(false)
  const [draftChatHighThinking, setDraftChatHighThinking] = useState(false)
  const [draftRpHighThinking, setDraftRpHighThinking] = useState(false)
  const [draftMemoryExtractModel, setDraftMemoryExtractModel] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [modelError, setModelError] = useState<string | null>(null)
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [extractModelStatus, setExtractModelStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [extractModelError, setExtractModelError] = useState<string | null>(null)
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('')
  const [systemPromptStatus, setSystemPromptStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [draftSnackSystemPrompt, setDraftSnackSystemPrompt] = useState('')
  const [snackOverlayStatus, setSnackOverlayStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [draftSyzygyPostPrompt, setDraftSyzygyPostPrompt] = useState(DEFAULT_SYZYGY_POST_PROMPT)
  const [draftSyzygyReplyPrompt, setDraftSyzygyReplyPrompt] = useState(DEFAULT_SYZYGY_REPLY_PROMPT)
  const [syzygyPostStatus, setSyzygyPostStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [syzygyReplyStatus, setSyzygyReplyStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [draftLetterReplyPrompt, setDraftLetterReplyPrompt] = useState(DEFAULT_LETTER_REPLY_PROMPT)
  const [letterReplyStatus, setLetterReplyStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showUnsavedPromptDialog, setShowUnsavedPromptDialog] = useState(false)
  const [snackSectionExpanded, setSnackSectionExpanded] = useState(false)
  const [syzygySectionExpanded, setSyzygySectionExpanded] = useState(false)
  const [letterSectionExpanded, setLetterSectionExpanded] = useState(false)
  const [errors, setErrors] = useState<{ temperature?: string; topP?: string; maxTokens?: string; compressionRatio?: string; compressionKeepRecent?: string }>(
    {},
  )
  const pendingNavigationRef = useRef<null | (() => void)>(null)

  useEffect(() => {
    document.documentElement.classList.add('settings-page-active')
    document.body.classList.add('settings-page-active')
    document.body.classList.remove('chat-page-active')

    return () => {
      document.documentElement.classList.remove('settings-page-active')
      document.body.classList.remove('settings-page-active')
    }
  }, [])

  useEffect(() => {
    if (!settings) {
      return
    }
    const timer = window.setTimeout(() => {
      setTemperatureInput(settings.temperature.toString())
      setTopPInput(settings.topP.toString())
      setMaxTokensInput(settings.maxTokens.toString())
      setDraftEnabledModels(settings.enabledModels)
      setDraftDefaultModel(settings.defaultModel)
      setCompressionEnabled(settings.compressionEnabled)
      setCompressionRatioInput(settings.compressionTriggerRatio.toString())
      setCompressionKeepRecentInput(settings.compressionKeepRecentMessages.toString())
      setDraftSummarizerModel(settings.summarizerModel)
      setDraftMemoryExtractModel(settings.memoryExtractModel)
      setDraftChatReasoning(settings.chatReasoningEnabled)
      setDraftRpReasoning(settings.rpReasoningEnabled)
      setDraftChatHighThinking(settings.chatHighThinkingEnabled)
      setDraftRpHighThinking(settings.rpHighThinkingEnabled)
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
      setDraftSnackSystemPrompt(resolveSnackSystemOverlay(settings.snackSystemOverlay))
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
    if (!settings) {
      return
    }
    const timer = window.setTimeout(() => {
      setDraftSyzygyPostPrompt(resolveSyzygyPostPrompt(settings.syzygyPostSystemPrompt))
      setDraftSyzygyReplyPrompt(resolveSyzygyReplyPrompt(settings.syzygyReplySystemPrompt))
      setDraftLetterReplyPrompt(resolveLetterReplyPrompt(settings.letterReplySystemPrompt))
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [settings])

  useEffect(() => {
    if (!user || !supabase) {
      return
    }
    const client = supabase
    let active = true
    const loadSyzygyPrompts = async () => {
      try {
        const { data, error } = await client
          .from('user_settings')
          .select('syzygy_post_system_prompt,syzygy_reply_system_prompt,letter_reply_system_prompt')
          .eq('user_id', user.id)
          .maybeSingle()
        if (!active || error) {
          return
        }
        setDraftSyzygyPostPrompt(resolveSyzygyPostPrompt(data?.syzygy_post_system_prompt))
        setDraftSyzygyReplyPrompt(resolveSyzygyReplyPrompt(data?.syzygy_reply_system_prompt))
        setDraftLetterReplyPrompt(resolveLetterReplyPrompt(data?.letter_reply_system_prompt))
      } catch {
        // ignore and keep local fallback
      }
    }
    void loadSyzygyPrompts()
    return () => {
      active = false
    }
  }, [user])

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

  const buildNextSettings = useCallback((overrides: Partial<UserSettings> = {}) => {
    if (!settings) {
      return null
    }
    return {
      ...settings,
      ...overrides,
      updatedAt: new Date().toISOString(),
    }
  }, [settings])

  const parsedTemperature = Number(temperatureInput)
  const parsedTopP = Number(topPInput)
  const parsedMaxTokens = Number.parseInt(maxTokensInput, 10)
  const parsedCompressionRatio = Number(compressionRatioInput)
  const parsedCompressionKeepRecent = Number.parseInt(compressionKeepRecentInput, 10)
  const temperatureValid = !Number.isNaN(parsedTemperature) && parsedTemperature >= 0 && parsedTemperature <= 2
  const topPValid = !Number.isNaN(parsedTopP) && parsedTopP >= 0 && parsedTopP <= 1
  const maxTokensValid = !Number.isNaN(parsedMaxTokens) && parsedMaxTokens >= 32 && parsedMaxTokens <= 4000
  const compressionRatioValid = !Number.isNaN(parsedCompressionRatio) && parsedCompressionRatio >= 0.1 && parsedCompressionRatio <= 0.95
  const compressionKeepRecentValid = !Number.isNaN(parsedCompressionKeepRecent) && parsedCompressionKeepRecent >= 1 && parsedCompressionKeepRecent <= 200
  const generationDraftValid = temperatureValid && topPValid && maxTokensValid && compressionRatioValid && compressionKeepRecentValid

  const hasUnsavedModelSettings = settings
    ? settings.defaultModel !== draftDefaultModel ||
      settings.enabledModels.join('|') !== draftEnabledModels.join('|')
    : false

  const hasUnsavedGeneration = settings
    ? settings.temperature !== parsedTemperature ||
      settings.topP !== parsedTopP ||
      settings.maxTokens !== parsedMaxTokens ||
      settings.compressionEnabled !== compressionEnabled ||
      settings.compressionTriggerRatio !== parsedCompressionRatio ||
      settings.compressionKeepRecentMessages !== parsedCompressionKeepRecent ||
      (settings.summarizerModel ?? '') !== (draftSummarizerModel ?? '') ||
      settings.chatReasoningEnabled !== draftChatReasoning ||
      settings.rpReasoningEnabled !== draftRpReasoning ||
      settings.chatHighThinkingEnabled !== draftChatHighThinking ||
      settings.rpHighThinkingEnabled !== draftRpHighThinking
    : false
  const hasUnsavedSystemPrompt = settings ? draftSystemPrompt !== settings.systemPrompt : false
  const hasUnsavedSnackOverlay = settings
    ? draftSnackSystemPrompt !== resolveSnackSystemOverlay(settings.snackSystemOverlay)
    : false
  const hasUnsavedSyzygyPostPrompt = settings
    ? draftSyzygyPostPrompt !== resolveSyzygyPostPrompt(settings.syzygyPostSystemPrompt)
    : false
  const hasUnsavedSyzygyReplyPrompt = settings
    ? draftSyzygyReplyPrompt !== resolveSyzygyReplyPrompt(settings.syzygyReplySystemPrompt)
    : false
  const hasUnsavedLetterReplyPrompt = settings
    ? draftLetterReplyPrompt !== resolveLetterReplyPrompt(settings.letterReplySystemPrompt)
    : false
  const hasUnsavedExtractModel =
    (settings?.memoryExtractModel ?? '') !== (draftMemoryExtractModel ?? '')
  const hasUnsavedPrompt =
    hasUnsavedSystemPrompt ||
    hasUnsavedSnackOverlay ||
    hasUnsavedSyzygyPostPrompt ||
    hasUnsavedSyzygyReplyPrompt ||
    hasUnsavedLetterReplyPrompt ||
    hasUnsavedExtractModel ||
    hasUnsavedModelSettings ||
    hasUnsavedGeneration

  useEffect(() => {
    if (!hasUnsavedPrompt) {
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
  }, [hasUnsavedPrompt])

  const handleDisableModel = () => {
    if (!settings || !pendingDisable) {
      return
    }
    const modelId = pendingDisable
    const nextEnabled = draftEnabledModels.filter((id) => id !== modelId)
    const nextDefault = draftDefaultModel === modelId ? nextEnabled[0] ?? defaultModelId : draftDefaultModel
    setDraftEnabledModels(nextEnabled)
    setDraftDefaultModel(nextDefault)
    setModelStatus('idle')
    setPendingDisable(null)
  }

  const handleEnableModel = (modelId: string, setDefault: boolean) => {
    if (!settings) {
      return
    }
    const alreadyEnabled = draftEnabledModels.includes(modelId)
    const nextEnabled = alreadyEnabled ? draftEnabledModels : [...draftEnabledModels, modelId]
    const nextDefault = setDefault ? modelId : draftDefaultModel || (alreadyEnabled ? draftDefaultModel : modelId)
    setDraftEnabledModels(nextEnabled)
    setDraftDefaultModel(nextDefault)
    setModelStatus('idle')
  }

  const handleSetDefault = (modelId: string) => {
    if (!settings) {
      return
    }
    const nextEnabled = draftEnabledModels.includes(modelId)
      ? draftEnabledModels
      : [...draftEnabledModels, modelId]
    setDraftEnabledModels(nextEnabled)
    setDraftDefaultModel(modelId)
    setModelStatus('idle')
  }

  const handleSaveModelSettings = async () => {
    if (!settings || !hasUnsavedModelSettings) {
      return
    }
    const nextEnabledModels = draftEnabledModels.includes(draftDefaultModel)
      ? draftEnabledModels
      : [...draftEnabledModels, draftDefaultModel]
    const nextSettings = buildNextSettings({
      enabledModels: nextEnabledModels,
      defaultModel: draftDefaultModel,
    })
    if (!nextSettings) {
      return
    }
    setModelStatus('saving')
    setModelError(null)
    try {
      await onSaveSettings(nextSettings)
      setModelStatus('saved')
    } catch (error) {
      console.warn('保存模型库设置失败', error)
      setModelStatus('error')
      setModelError('保存失败，请稍后重试。')
    }
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
    setGenerationStatus('idle')
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
    setGenerationStatus('idle')
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
    setGenerationStatus('idle')
  }

  const handleChatReasoningToggle = (enabled: boolean) => {
    setDraftChatReasoning(enabled)
    setGenerationStatus('idle')
  }

  const handleRpReasoningToggle = (enabled: boolean) => {
    setDraftRpReasoning(enabled)
    setGenerationStatus('idle')
  }

  const handleChatHighThinkingToggle = (enabled: boolean) => {
    setDraftChatHighThinking(enabled)
    setGenerationStatus('idle')
  }

  const handleRpHighThinkingToggle = (enabled: boolean) => {
    setDraftRpHighThinking(enabled)
    setGenerationStatus('idle')
  }

  const handleCompressionRatioChange = (value: string) => {
    setCompressionRatioInput(value)
    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      setErrors((prev) => ({ ...prev, compressionRatio: '请输入数字' }))
      return
    }
    if (parsed < 0.1 || parsed > 0.95) {
      setErrors((prev) => ({ ...prev, compressionRatio: '触发比例需在 0.1 到 0.95 之间' }))
      return
    }
    setErrors((prev) => ({ ...prev, compressionRatio: undefined }))
    setGenerationStatus('idle')
  }

  const handleCompressionKeepRecentChange = (value: string) => {
    setCompressionKeepRecentInput(value)
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) {
      setErrors((prev) => ({ ...prev, compressionKeepRecent: '请输入整数' }))
      return
    }
    if (parsed < 1 || parsed > 200) {
      setErrors((prev) => ({ ...prev, compressionKeepRecent: '保留消息数需在 1 到 200 之间' }))
      return
    }
    setErrors((prev) => ({ ...prev, compressionKeepRecent: undefined }))
    setGenerationStatus('idle')
  }

  const resolvedExtractModel = draftMemoryExtractModel?.trim()
    ? draftMemoryExtractModel
    : draftDefaultModel
  const extractModelValid = draftEnabledModels.includes(resolvedExtractModel)
  const handleSaveExtractModel = async () => {
    if (!hasUnsavedExtractModel || !extractModelValid) {
      return
    }
    setExtractModelStatus('saving')
    setExtractModelError(null)
    try {
      await onSaveMemoryExtractModel(draftMemoryExtractModel)
      setExtractModelStatus('saved')
    } catch (error) {
      console.warn('保存记忆抽取模型失败', error)
      setExtractModelStatus('error')
      setExtractModelError('保存失败，请稍后重试。')
    }
  }

  const handleSaveGenerationSettings = async () => {
    if (!settings || !generationDraftValid || !hasUnsavedGeneration) {
      return
    }
    const nextSettings = buildNextSettings({
      temperature: parsedTemperature,
      topP: parsedTopP,
      maxTokens: parsedMaxTokens,
      compressionEnabled,
      compressionTriggerRatio: parsedCompressionRatio,
      compressionKeepRecentMessages: parsedCompressionKeepRecent,
      summarizerModel: draftSummarizerModel,
      chatReasoningEnabled: draftChatReasoning,
      rpReasoningEnabled: draftRpReasoning,
      chatHighThinkingEnabled: draftChatHighThinking,
      rpHighThinkingEnabled: draftRpHighThinking,
    })
    if (!nextSettings) {
      return
    }
    setGenerationStatus('saving')
    setGenerationError(null)
    try {
      await onSaveSettings(nextSettings)
      setGenerationStatus('saved')
    } catch (error) {
      console.warn('保存生成参数失败', error)
      setGenerationStatus('error')
      setGenerationError('保存失败，请稍后重试。')
    }
  }

  const handleSystemPromptChange = (value: string) => {
    setDraftSystemPrompt(value)
    if (systemPromptStatus !== 'idle') {
      setSystemPromptStatus('idle')
    }
  }

  const handleSaveSystemPrompt = async () => {
    if (!settings || !hasUnsavedSystemPrompt) {
      return
    }
    const nextPrompt = draftSystemPrompt
    const nextSettings = buildNextSettings({ systemPrompt: nextPrompt })
    if (!nextSettings) {
      return
    }
    setSystemPromptStatus('saving')
    try {
      await onSaveSettings(nextSettings)
      setSystemPromptStatus('saved')
    } catch (error) {
      console.warn('保存系统提示词失败', error)
      setSystemPromptStatus('error')
    }
  }

  const handleSnackOverlayChange = (value: string) => {
    setDraftSnackSystemPrompt(value)
    if (snackOverlayStatus !== 'idle') {
      setSnackOverlayStatus('idle')
    }
  }

  const handleSaveSnackOverlay = async () => {
    if (!settings || !hasUnsavedSnackOverlay) {
      return
    }
    const nextOverlay = resolveSnackSystemOverlay(draftSnackSystemPrompt)
    setDraftSnackSystemPrompt(nextOverlay)
    setSnackOverlayStatus('saving')
    try {
      await onSaveSnackSystemPrompt(nextOverlay)
      setSnackOverlayStatus('saved')
    } catch (error) {
      console.warn('保存零食风格覆盖失败', error)
      setSnackOverlayStatus('error')
    }
  }

  const handleResetSnackOverlay = () => {
    setDraftSnackSystemPrompt(DEFAULT_SNACK_SYSTEM_OVERLAY)
    setSnackOverlayStatus('idle')
  }


  const handleSyzygyPostPromptChange = (value: string) => {
    setDraftSyzygyPostPrompt(value)
    if (syzygyPostStatus !== 'idle') {
      setSyzygyPostStatus('idle')
    }
  }

  const handleSyzygyReplyPromptChange = (value: string) => {
    setDraftSyzygyReplyPrompt(value)
    if (syzygyReplyStatus !== 'idle') {
      setSyzygyReplyStatus('idle')
    }
  }

  const handleSaveSyzygyPostPrompt = async () => {
    if (!settings || !hasUnsavedSyzygyPostPrompt) {
      return
    }
    const nextPrompt = resolveSyzygyPostPrompt(draftSyzygyPostPrompt)
    setDraftSyzygyPostPrompt(nextPrompt)
    setSyzygyPostStatus('saving')
    try {
      await onSaveSyzygyPostPrompt(nextPrompt)
      setSyzygyPostStatus('saved')
    } catch (error) {
      console.warn('保存 Syzygy 发帖提示词失败', error)
      setSyzygyPostStatus('error')
    }
  }

  const handleSaveSyzygyReplyPrompt = async () => {
    if (!settings || !hasUnsavedSyzygyReplyPrompt) {
      return
    }
    const nextPrompt = resolveSyzygyReplyPrompt(draftSyzygyReplyPrompt)
    setDraftSyzygyReplyPrompt(nextPrompt)
    setSyzygyReplyStatus('saving')
    try {
      await onSaveSyzygyReplyPrompt(nextPrompt)
      setSyzygyReplyStatus('saved')
    } catch (error) {
      console.warn('保存 Syzygy 回复提示词失败', error)
      setSyzygyReplyStatus('error')
    }
  }

  const handleResetSyzygyPostPrompt = () => {
    setDraftSyzygyPostPrompt(DEFAULT_SYZYGY_POST_PROMPT)
    setSyzygyPostStatus('idle')
  }

  const handleResetSyzygyReplyPrompt = () => {
    setDraftSyzygyReplyPrompt(DEFAULT_SYZYGY_REPLY_PROMPT)
    setSyzygyReplyStatus('idle')
  }

  const handleLetterReplyPromptChange = (value: string) => {
    setDraftLetterReplyPrompt(value)
    if (letterReplyStatus !== 'idle') {
      setLetterReplyStatus('idle')
    }
  }

  const handleSaveLetterReplyPrompt = async () => {
    if (!settings || !hasUnsavedLetterReplyPrompt) {
      return
    }
    const nextPrompt = resolveLetterReplyPrompt(draftLetterReplyPrompt)
    setDraftLetterReplyPrompt(nextPrompt)
    setLetterReplyStatus('saving')
    try {
      await onSaveLetterReplyPrompt(nextPrompt)
      setLetterReplyStatus('saved')
    } catch (error) {
      console.warn('保存来信回复提示词失败', error)
      setLetterReplyStatus('error')
    }
  }

  const handleResetLetterReplyPrompt = () => {
    setDraftLetterReplyPrompt(DEFAULT_LETTER_REPLY_PROMPT)
    setLetterReplyStatus('idle')
  }

  const requestNavigation = (action: () => void) => {
    if (!hasUnsavedPrompt) {
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
      setTemperatureInput(settings.temperature.toString())
      setTopPInput(settings.topP.toString())
      setMaxTokensInput(settings.maxTokens.toString())
      setDraftEnabledModels(settings.enabledModels)
      setDraftDefaultModel(settings.defaultModel)
      setDraftMemoryExtractModel(settings.memoryExtractModel)
      setDraftChatReasoning(settings.chatReasoningEnabled)
      setDraftRpReasoning(settings.rpReasoningEnabled)
      setDraftChatHighThinking(settings.chatHighThinkingEnabled)
      setDraftRpHighThinking(settings.rpHighThinkingEnabled)
      setModelStatus('idle')
      setModelError(null)
      setDraftSystemPrompt(settings.systemPrompt)
      setDraftSnackSystemPrompt(resolveSnackSystemOverlay(settings.snackSystemOverlay))
      setGenerationStatus('idle')
      setGenerationError(null)
      setSystemPromptStatus('idle')
      setSnackOverlayStatus('idle')
      setDraftSyzygyPostPrompt(resolveSyzygyPostPrompt(settings.syzygyPostSystemPrompt))
      setDraftSyzygyReplyPrompt(resolveSyzygyReplyPrompt(settings.syzygyReplySystemPrompt))
      setDraftLetterReplyPrompt(resolveLetterReplyPrompt(settings.letterReplySystemPrompt))
      setSyzygyPostStatus('idle')
      setSyzygyReplyStatus('idle')
      setLetterReplyStatus('idle')
    }
    setShowUnsavedPromptDialog(false)
    const pendingAction = pendingNavigationRef.current
    pendingNavigationRef.current = null
    pendingAction?.()
  }

  const handleSaveAndLeave = () => {
    if (hasUnsavedSystemPrompt) {
      void handleSaveSystemPrompt()
    }
    if (hasUnsavedSnackOverlay) {
      void handleSaveSnackOverlay()
    }
    if (hasUnsavedGeneration) {
      void handleSaveGenerationSettings()
    }
    if (hasUnsavedModelSettings) {
      void handleSaveModelSettings()
    }
    if (hasUnsavedExtractModel) {
      void handleSaveExtractModel()
    }
    if (hasUnsavedSyzygyPostPrompt) {
      void handleSaveSyzygyPostPrompt()
    }
    if (hasUnsavedSyzygyReplyPrompt) {
      void handleSaveSyzygyReplyPrompt()
    }
    if (hasUnsavedLetterReplyPrompt) {
      void handleSaveLetterReplyPrompt()
    }
    setShowUnsavedPromptDialog(false)
    const pendingAction = pendingNavigationRef.current
    pendingNavigationRef.current = null
    pendingAction?.()
  }

  const selectedModelId = draftEnabledModels.includes(draftDefaultModel)
    ? draftDefaultModel
    : draftEnabledModels.includes(defaultModelId)
      ? defaultModelId
      : draftEnabledModels[0] ?? draftDefaultModel ?? defaultModelId

  if (!ready || !settings) {
    return (
      <div className="settings-shell app-shell">
        <header className="settings-header app-shell__header">
          <button
            type="button"
            className="ghost"
            onClick={() => requestNavigation(() => navigate(-1))}
          >
            返回
          </button>
          <h1 className="ui-title">API设置</h1>
          <span className="header-spacer" />
        </header>
        <div className="settings-page app-shell__content">
          <div className="settings-ribbon-divider" aria-hidden="true">
            <span className="settings-ribbon-line" />
            <span className="settings-ribbon-icon">🎀</span>
            <span className="settings-ribbon-line" />
          </div>
          <div className="settings-loading">正在加载设置...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-shell app-shell">
      <header className="settings-header app-shell__header">
        <button
          type="button"
          className="ghost"
          onClick={() => requestNavigation(() => navigate(-1))}
        >
          返回
        </button>
        <h1 className="ui-title">API设置</h1>
        <span className="header-spacer" />
      </header>

      <div className="settings-page app-shell__content">
        <div className="settings-ribbon-divider" aria-hidden="true">
          <span className="settings-ribbon-line" />
          <span className="settings-ribbon-icon">🎀</span>
          <span className="settings-ribbon-line" />
        </div>
        <div className="settings-group" role="list">
      <section className="settings-section" role="listitem">
        <div className="section-title">
          <span className="section-icon" aria-hidden="true">📱</span>
          <h2 className="ui-title">显示模式</h2>
          <p>Phone Mode 会保留当前完整功能；Game Mode 目前仅提供占位骨架。</p>
        </div>
        <div className="display-mode-switch" role="radiogroup" aria-label="Display mode">
          <label className="display-mode-option">
            <input
              type="radio"
              name="displayMode"
              value="phone"
              checked={displayMode === 'phone'}
              onChange={() => onDisplayModeChange('phone')}
            />
            <span>Phone Mode</span>
          </label>
          <label className="display-mode-option">
            <input
              type="radio"
              name="displayMode"
              value="game"
              checked={displayMode === 'game'}
              onChange={() => onDisplayModeChange('game')}
            />
            <span>Game Mode</span>
          </label>
        </div>
      </section>
      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setModelSectionExpanded((current) => !current)}
          aria-expanded={modelSectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">⚙️</span>
            <h2 className="ui-title">模型库</h2>
            <p>管理已启用模型并设置默认模型。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {modelSectionExpanded ? (
          <div className="accordion-content">
            {draftEnabledModels.length === 0 ? (
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
                    {draftEnabledModels.map((modelId) => (
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

            <div className="section-title nested-prompt-title">
              <h2 className="ui-title">OpenRouter 模型库</h2>
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
                    const enabled = draftEnabledModels.includes(model.id)
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

            <div className="system-prompt-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void handleSaveModelSettings()}
                disabled={!hasUnsavedModelSettings || modelStatus === 'saving'}
              >
                {modelStatus === 'saving' ? '保存中…' : '保存'}
              </button>
              {hasUnsavedModelSettings ? <span className="system-prompt-status">有未保存修改</span> : null}
              {modelStatus === 'saved' ? <span className="system-prompt-status">已保存</span> : null}
              {modelStatus === 'error' ? <span className="field-error">{modelError}</span> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setGenerationSectionExpanded((current) => !current)}
          aria-expanded={generationSectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">🎛️</span>
            <h2 className="ui-title">生成参数</h2>
            <p>调整生成行为与推理开关。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {generationSectionExpanded ? (
          <div className="accordion-content">
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
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setReasoningSectionExpanded((current) => !current)}
          aria-expanded={reasoningSectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">🔮</span>
            <h2 className="ui-title">思考链</h2>
            <p>分别控制日常聊天与跑跑滚轮是否请求思考链。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {reasoningSectionExpanded ? (
          <div className="accordion-content">
            <div className="field-group">
              <label htmlFor="chatReasoningEnabled">日常聊天思考链</label>
              <label className="toggle-control">
                <input
                  id="chatReasoningEnabled"
                  type="checkbox"
                  checked={draftChatReasoning}
                  onChange={(event) => handleChatReasoningToggle(event.target.checked)}
                />
                <span>{draftChatReasoning ? '已开启' : '已关闭'}</span>
              </label>
            </div>
            <div className="field-group">
              <label htmlFor="rpReasoningEnabled">跑跑滚轮思考链</label>
              <label className="toggle-control">
                <input
                  id="rpReasoningEnabled"
                  type="checkbox"
                  checked={draftRpReasoning}
                  onChange={(event) => handleRpReasoningToggle(event.target.checked)}
                />
                <span>{draftRpReasoning ? '已开启' : '已关闭'}</span>
              </label>
            </div>
            <div className="field-group">
              <label htmlFor="chatHighThinkingEnabled">聊天：高触发 Thinking（仅 GPT-5.1/5.2）</label>
              <label className="toggle-control">
                <input
                  id="chatHighThinkingEnabled"
                  type="checkbox"
                  checked={draftChatHighThinking}
                  onChange={(event) => handleChatHighThinkingToggle(event.target.checked)}
                />
                <span>{draftChatHighThinking ? '已开启' : '已关闭'}</span>
              </label>
            </div>
            <div className="field-group">
              <label htmlFor="rpHighThinkingEnabled">跑跑滚轮区/RP：高触发 Thinking（仅 GPT-5.1/5.2）</label>
              <label className="toggle-control">
                <input
                  id="rpHighThinkingEnabled"
                  type="checkbox"
                  checked={draftRpHighThinking}
                  onChange={(event) => handleRpHighThinkingToggle(event.target.checked)}
                />
                <span>{draftRpHighThinking ? '已开启' : '已关闭'}</span>
              </label>
              <p className="field-hint">仅对 GPT-5.1 / GPT-5.2 生效；其他模型自动忽略。开启后会更积极触发思考（可能更慢/更耗费）。</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setMemorySectionExpanded((current) => !current)}
          aria-expanded={memorySectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">🗂️</span>
            <h2 className="ui-title">记忆相关</h2>
            <p>配置记忆抽取模型；自动提取与归并可在囤囤库中设置。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {memorySectionExpanded ? (
          <div className="accordion-content">
            <div className="field-group">
              <label htmlFor="memoryExtractModel">Memory Extract Model</label>
              <select
                id="memoryExtractModel"
                value={draftMemoryExtractModel ?? ''}
                onChange={(event) => {
                  const next = event.target.value.trim()
                  setDraftMemoryExtractModel(next.length > 0 ? next : null)
                  setExtractModelStatus('idle')
                }}
              >
                <option value="">跟随默认模型（{draftDefaultModel}）</option>
                {draftEnabledModels.map((modelId) => (
                  <option key={modelId} value={modelId}>
                    {catalogMap.get(modelId) ?? modelId}
                  </option>
                ))}
              </select>
              {!extractModelValid ? (
                <span className="field-error">所选模型不在 enabled_models 中，请先启用该模型。</span>
              ) : null}
              <div className="system-prompt-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void handleSaveExtractModel()}
                  disabled={!hasUnsavedExtractModel || !extractModelValid || extractModelStatus === 'saving'}
                >
                  {extractModelStatus === 'saving' ? '保存中…' : '保存'}
                </button>
                {hasUnsavedExtractModel ? <span className="system-prompt-status">有未保存修改</span> : null}
                {extractModelStatus === 'saved' ? <span className="system-prompt-status">已保存</span> : null}
                {extractModelStatus === 'error' ? <span className="field-error">{extractModelError}</span> : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setCompressionSectionExpanded((current) => !current)}
          aria-expanded={compressionSectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">🧩</span>
            <h2 className="ui-title">上下文压缩</h2>
            <p>配置压缩触发阈值、保留条数与摘要模型。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {compressionSectionExpanded ? (
          <div className="accordion-content">
            <div className="compression-fields">
            <label className="toggle-control" htmlFor="compressionEnabled">
              <input
                id="compressionEnabled"
                type="checkbox"
                checked={compressionEnabled}
                onChange={(event) => {
                  setCompressionEnabled(event.target.checked)
                  setGenerationStatus('idle')
                }}
              />
              <span>{compressionEnabled ? '压缩已开启' : '压缩已关闭'}</span>
            </label>

            <label htmlFor="compressionRatio">触发比例 (0.1 - 0.95)</label>
            <input
              id="compressionRatio"
              type="number"
              min="0.1"
              max="0.95"
              step="0.05"
              value={compressionRatioInput}
              onChange={(event) => handleCompressionRatioChange(event.target.value)}
            />
            {errors.compressionRatio ? <span className="field-error">{errors.compressionRatio}</span> : null}

            <label htmlFor="compressionKeepRecent">保留最近消息数 (1 - 200)</label>
            <input
              id="compressionKeepRecent"
              type="number"
              min="1"
              max="200"
              step="1"
              value={compressionKeepRecentInput}
              onChange={(event) => handleCompressionKeepRecentChange(event.target.value)}
            />
            {errors.compressionKeepRecent ? <span className="field-error">{errors.compressionKeepRecent}</span> : null}

            <label htmlFor="summarizerModel">Summarizer Model</label>
            <select
              id="summarizerModel"
              value={draftSummarizerModel ?? ''}
              onChange={(event) => {
                const nextModel = event.target.value.trim()
                setDraftSummarizerModel(nextModel.length > 0 ? nextModel : null)
                setGenerationStatus('idle')
              }}
            >
              <option value="">自动（默认模型/经济模型）</option>
              {draftEnabledModels.map((modelId) => (
                <option key={modelId} value={modelId}>
                  {catalogMap.get(modelId) ?? modelId}
                </option>
              ))}
            </select>
            </div>
            <div className="system-prompt-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void handleSaveGenerationSettings()}
                disabled={!hasUnsavedGeneration || !generationDraftValid || generationStatus === 'saving'}
              >
                {generationStatus === 'saving' ? '保存中…' : '保存'}
              </button>
              {hasUnsavedGeneration ? <span className="system-prompt-status">有未保存修改</span> : null}
              {generationStatus === 'saved' ? <span className="system-prompt-status">已保存</span> : null}
              {generationStatus === 'error' ? <span className="field-error">{generationError}</span> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setSystemPromptSectionExpanded((current) => !current)}
          aria-expanded={systemPromptSectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">📝</span>
            <h2 className="ui-title">系统提示词</h2>
            <p>用于引导模型的全局指令，仅对当前用户生效。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {systemPromptSectionExpanded ? (
          <div className="accordion-content">
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
                onClick={() => void handleSaveSystemPrompt()}
              >
                保存
              </button>
              {systemPromptStatus === 'saved' ? (
                <span className="system-prompt-status">已保存</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setSnackSectionExpanded((current) => !current)}
          aria-expanded={snackSectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">🍪</span>
            <h2 className="ui-title">Snack Feed</h2>
            <p>仅用于零食罐罐区；基础系统提示词保持不变。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {snackSectionExpanded ? (
          <div className="accordion-content">
            <textarea
              className="system-prompt"
              value={draftSnackSystemPrompt}
              onChange={(event) => handleSnackOverlayChange(event.target.value)}
            />
            <div className="system-prompt-actions">
              <button
                type="button"
                className="primary"
                disabled={!hasUnsavedSnackOverlay}
                onClick={() => void handleSaveSnackOverlay()}
              >
                保存
              </button>
              <button type="button" className="ghost" onClick={handleResetSnackOverlay}>
                恢复默认
              </button>
              {snackOverlayStatus === 'saved' ? (
                <span className="system-prompt-status">已保存</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setSyzygySectionExpanded((current) => !current)}
          aria-expanded={syzygySectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">📓</span>
            <h2 className="ui-title">仓鼠观察日志</h2>
            <p>控制发帖与回复时的提示词行为。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {syzygySectionExpanded ? (
          <div className="accordion-content">
            <div className="section-title">
              <h2 className="ui-title">发帖风格（Syzygy Post Prompt）</h2>
              <p>控制 🤖 发帖按钮的文风与输出约束。</p>
            </div>
            <textarea
              className="system-prompt"
              value={draftSyzygyPostPrompt}
              onChange={(event) => handleSyzygyPostPromptChange(event.target.value)}
            />
            <div className="system-prompt-actions">
              <button
                type="button"
                className="primary"
                disabled={!hasUnsavedSyzygyPostPrompt}
                onClick={() => void handleSaveSyzygyPostPrompt()}
              >
                保存
              </button>
              <button type="button" className="ghost" onClick={handleResetSyzygyPostPrompt}>
                恢复默认
              </button>
              {syzygyPostStatus === 'saved' ? <span className="system-prompt-status">已保存</span> : null}
            </div>

            <div className="section-title nested-prompt-title">
              <h2 className="ui-title">回复风格（Syzygy Reply Prompt）</h2>
              <p>控制 🤖 AI 回复的语气与长度。</p>
            </div>
            <textarea
              className="system-prompt"
              value={draftSyzygyReplyPrompt}
              onChange={(event) => handleSyzygyReplyPromptChange(event.target.value)}
            />
            <div className="system-prompt-actions">
              <button
                type="button"
                className="primary"
                disabled={!hasUnsavedSyzygyReplyPrompt}
                onClick={() => void handleSaveSyzygyReplyPrompt()}
              >
                保存
              </button>
              <button type="button" className="ghost" onClick={handleResetSyzygyReplyPrompt}>
                恢复默认
              </button>
              {syzygyReplyStatus === 'saved' ? <span className="system-prompt-status">已保存</span> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="listitem">
        <button
          type="button"
          className="collapse-header"
          onClick={() => setLetterSectionExpanded((current) => !current)}
          aria-expanded={letterSectionExpanded}
        >
          <span className="section-title">
            <span className="section-icon" aria-hidden="true">💌</span>
            <h2 className="ui-title">来信</h2>
            <p>控制来信生成时的语气、长度与表达方式。</p>
          </span>
          <span className="collapse-indicator" aria-hidden="true">›</span>
        </button>
        {letterSectionExpanded ? (
          <div className="accordion-content">
            <textarea
              className="system-prompt"
              value={draftLetterReplyPrompt}
              onChange={(event) => handleLetterReplyPromptChange(event.target.value)}
            />
            <div className="system-prompt-actions">
              <button
                type="button"
                className="primary"
                disabled={!hasUnsavedLetterReplyPrompt}
                onClick={() => void handleSaveLetterReplyPrompt()}
              >
                保存
              </button>
              <button type="button" className="ghost" onClick={handleResetLetterReplyPrompt}>
                恢复默认
              </button>
              {hasUnsavedLetterReplyPrompt ? <span className="system-prompt-status">有未保存修改</span> : null}
              {letterReplyStatus === 'saved' ? <span className="system-prompt-status">已保存</span> : null}
            </div>
          </div>
        ) : null}
      </section>

        </div>
      </div>

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
