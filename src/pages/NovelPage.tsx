import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { useEnabledModels } from '../hooks/useEnabledModels'
import { supabase } from '../supabase/client'
import MarkdownRenderer from '../components/MarkdownRenderer'
import type { NovelBook, NovelChapter, NovelCharacterCard, NovelModelConfig } from '../types'
import { createNovelBook, createNovelChapter, listNovelBooks, listNovelChaptersByBookId, updateNovelBookMeta, updateNovelBookModelConfig, updateNovelChapter } from '../storage/supabaseSync'
import './NovelPage.css'

const GLOBAL_CONFIG_TITLE = '__global_config__'

type DraftState = {
  title: string
  summary: string
  outline: string
  worldSetting: string
  characters: NovelCharacterCard[]
}

const emptyDraft: DraftState = { title: '', summary: '', outline: '', worldSetting: '', characters: [] }


const continuationDividerKey = (novelId: string, chapterId: string) => `novelContinuationDividers:${novelId}:${chapterId}`

const readContinuationDividers = (novelId: string, chapterId: string) => {
  if (typeof window === 'undefined') return [] as number[]
  try {
    const raw = window.localStorage.getItem(continuationDividerKey(novelId, chapterId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []
  } catch {
    return []
  }
}

const writeContinuationDividers = (novelId: string, chapterId: string, offsets: number[]) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(continuationDividerKey(novelId, chapterId), JSON.stringify(offsets))
}

const normalizeContinuationDividers = (offsets: number[], contentLength: number) => {
  const uniqueSorted = Array.from(new Set(offsets.map((offset) => Math.trunc(offset)))).sort((a, b) => a - b)
  return uniqueSorted.filter((offset) => offset > 0 && offset < contentLength)
}

const NovelPage = ({ user }: { user: User | null }) => {
  const navigate = useNavigate()
  const { enabledModelIds, defaultModelId } = useEnabledModels(user)
  const [books, setBooks] = useState<NovelBook[]>([])
  const [globalConfigBook, setGlobalConfigBook] = useState<NovelBook | null>(null)
  const [book, setBook] = useState<NovelBook | null>(null)
  const [chapter, setChapter] = useState<NovelChapter | null>(null)
  const [chapters, setChapters] = useState<NovelChapter[]>([])
  const [brief, setBrief] = useState('')
  const [draft, setDraft] = useState<DraftState>(emptyDraft)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  // Chapter-writing state
  const [directorInput, setDirectorInput] = useState('')
  const [writing, setWriting] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [chapterError, setChapterError] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState(false)
  const [contentDraft, setContentDraft] = useState('')
  const [editingBookTitle, setEditingBookTitle] = useState(false)
  const [bookTitleDraft, setBookTitleDraft] = useState('')
  const [bookTitleSaving, setBookTitleSaving] = useState(false)
  const [summaryEditing, setSummaryEditing] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')

  // Book-meta editing state
  type MetaField = 'summary' | 'worldSetting' | 'outline' | 'characters'
  const [editingField, setEditingField] = useState<MetaField | null>(null)
  const [metaDraftText, setMetaDraftText] = useState('')
  const [metaDraftChars, setMetaDraftChars] = useState<NovelCharacterCard[]>([])
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [metaSectionOpen, setMetaSectionOpen] = useState<Record<MetaField, boolean>>({
    summary: false,
    worldSetting: false,
    outline: false,
    characters: false,
  })

  const baseConfig: NovelModelConfig = useMemo(() => ({
    writing_model: defaultModelId ?? 'openrouter/auto',
    summary_model: defaultModelId ?? 'openrouter/auto',
    context_window_chapters: 3,
    prompts: {
      outline_prompt: '根据用户给出的关键词/简介，返回 JSON: {"title":"","summary":"","outline":"","world_setting":""}',
      writing_prompt: '基于上下文续写一章小说，输出 markdown 正文。',
      summary_prompt: '将章节总结为 100-200 字摘要。',
      character_gen_prompt: '根据关键词/简介返回角色 JSON 数组: [{"name":"","description":"","personality":""}]',
    },
  }), [defaultModelId])
  const [settingsDraft, setSettingsDraft] = useState<NovelModelConfig>(baseConfig)

  const globalConfig: NovelModelConfig = useMemo(() => {
    const raw = (globalConfigBook?.modelConfig ?? {}) as Partial<NovelModelConfig>
    return {
      ...baseConfig,
      ...raw,
      prompts: { ...baseConfig.prompts, ...(raw.prompts ?? {}) },
    }
  }, [baseConfig, globalConfigBook?.modelConfig])

  const activeBookConfig: NovelModelConfig = useMemo(() => {
    const raw = (book?.modelConfig ?? {}) as Partial<NovelModelConfig>
    return {
      ...globalConfig,
      ...raw,
      prompts: { ...globalConfig.prompts, ...(raw.prompts ?? {}) },
    }
  }, [book?.modelConfig, globalConfig])

  const modelOptions = enabledModelIds.length > 0 ? enabledModelIds : [globalConfig.writing_model]

  useEffect(() => {
    if (!settingsOpen) return
    setSettingsDraft(activeBookConfig)
  }, [activeBookConfig, settingsOpen])

  useEffect(() => {
    setDirectorInput('')
    setChapterError(null)
    setEditingContent(false)
    setContentDraft(chapter?.content ?? '')
    setSummaryEditing(false)
    setSummaryDraft(chapter?.summary ?? '')
  }, [chapter?.id])

  const reloadBooks = async () => {
    if (!user) return
    const rows = await listNovelBooks(user.id)
    const configRow = rows.find((item) => item.title === GLOBAL_CONFIG_TITLE) ?? null
    setGlobalConfigBook(configRow)
    setBooks(rows.filter((item) => item.title !== GLOBAL_CONFIG_TITLE))
  }

  useEffect(() => { void reloadBooks() }, [user?.id])

  const stripCodeFences = (content: string) => {
    const fenceMatch = content.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
    return fenceMatch ? fenceMatch[1] : content
  }

  const sliceBalanced = (content: string, open: '{' | '[') => {
    const close = open === '{' ? '}' : ']'
    const start = content.indexOf(open)
    if (start === -1) return null
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < content.length; i++) {
      const ch = content[i]
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === open) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) return content.slice(start, i + 1)
      }
    }
    return null
  }

  const extractJson = (content: string) => {
    const cleaned = stripCodeFences(content)
    return {
      objectText: sliceBalanced(cleaned, '{') ?? '{}',
      arrayText: sliceBalanced(cleaned, '[') ?? '[]',
    }
  }

  const parseJsonSafely = <T,>(text: string, fallback: T, label: string, raw: string): T => {
    try {
      return JSON.parse(text) as T
    } catch (error) {
      console.warn(`[novel] ${label} JSON 解析失败:`, error, { extracted: text, raw })
      return fallback
    }
  }

  const invokeModel = async (model: string, prompt: string) => {
    if (!supabase) throw new Error('Supabase 未配置')
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (!accessToken || !anonKey) throw new Error('AI 生成失败: 登录状态异常或环境变量未配置')
    const messages = [{ role: 'user', content: prompt }]
    const response = await fetch('https://crfhiumxzmaszkapanrb.supabase.co/functions/v1/openrouter-chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, stream: false }),
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`AI 生成失败: ${response.status} ${errorText}`)
    }
    const responseText = await response.text()
    const parseResponseJson = () => {
      try {
        return JSON.parse(responseText) as Record<string, unknown>
      } catch (error) {
        console.warn('[novel] openrouter-chat 返回了非 JSON 响应，将按纯文本处理。', error, { responseText })
        return null
      }
    }

    const data = parseResponseJson()
    if (!data) return responseText.trim()

    const choice = Array.isArray(data.choices) ? data.choices[0] : null
    const message = (choice as Record<string, unknown> | null)?.message ?? choice ?? {}
    const content = typeof (message as Record<string, unknown>)?.content === 'string'
      ? String((message as Record<string, unknown>).content)
      : ''

    return content || String(data.text ?? data.content ?? responseText)
  }

  const onAiGenerate = async () => {
    if (!brief.trim()) return
    setAiGenerating(true)
    try {
      const model = globalConfig.writing_model || defaultModelId || 'openrouter/auto'
      const jsonGuard = '\n\n严格只输出 JSON 本身，不要任何解释、前后缀文字或 markdown 代码块包裹。'
      const outlinePrompt = `${globalConfig.prompts.outline_prompt}${jsonGuard}\n\n关键词/简介:\n${brief}`
      const charsPrompt = `${globalConfig.prompts.character_gen_prompt}${jsonGuard}\n\n关键词/简介:\n${brief}`
      const [outlineText, charsText] = await Promise.all([invokeModel(model, outlinePrompt), invokeModel(model, charsPrompt)])
      const extractedOutline = extractJson(outlineText)
      const extractedChars = extractJson(charsText)
      const outlineJson = parseJsonSafely<Record<string, unknown>>(extractedOutline.objectText, {}, '大纲', outlineText)
      const charArray = parseJsonSafely<Array<Record<string, unknown>>>(extractedChars.arrayText, [], '角色卡', charsText)
      const normalizedCharacters: NovelCharacterCard[] = Array.isArray(charArray)
        ? charArray.map((item) => ({ name: String(item.name ?? ''), description: String(item.description ?? ''), personality: String(item.personality ?? '') }))
        : []
      setDraft((prev) => ({
        ...prev,
        title: String(outlineJson.title ?? prev.title ?? '未命名小说'),
        summary: String(outlineJson.summary ?? prev.summary ?? brief),
        outline: String(outlineJson.outline ?? prev.outline ?? ''),
        worldSetting: String(outlineJson.world_setting ?? prev.worldSetting ?? ''),
        characters: normalizedCharacters,
      }))
    } finally {
      setAiGenerating(false)
    }
  }

  const saveGlobalConfig = async (next: NovelModelConfig) => {
    if (!user) return
    if (globalConfigBook) {
      await updateNovelBookModelConfig(globalConfigBook.id, next)
    } else {
      await createNovelBook({
        userId: user.id,
        title: GLOBAL_CONFIG_TITLE,
        summary: 'global config',
        status: 'draft',
        outline: '',
        worldSetting: '',
        characters: [],
        modelConfig: next,
      })
    }
    await reloadBooks()
  }

  const onCreate = async () => {
    if (!user) return
    const created = await createNovelBook({
      userId: user.id,
      title: draft.title || '未命名小说',
      summary: draft.summary,
      outline: draft.outline,
      worldSetting: draft.worldSetting,
      characters: draft.characters,
      status: 'draft',
      modelConfig: globalConfig,
    })
    setDraft(emptyDraft)
    setBrief('')
    await reloadBooks()
    setBook(created)
  }

  const openDetail = async (item: NovelBook) => { setBook(item); setChapter(null); setChapters(await listNovelChaptersByBookId(item.id)); setEditingField(null); setMetaError(null) }
  const startEditBookTitle = () => {
    if (!book) return
    setBookTitleDraft(book.title)
    setBookTitleSaving(false)
    setEditingBookTitle(true)
  }
  const saveBookTitle = async () => {
    if (!book) return
    const title = bookTitleDraft.trim()
    if (!title) {
      setChapterError('书名不能为空')
      return
    }
    setBookTitleSaving(true)
    setChapterError(null)
    try {
      const updated = await updateNovelBookMeta(book.id, { title })
      setBook(updated)
      setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
      setEditingBookTitle(false)
    } catch (error) {
      setChapterError(error instanceof Error ? error.message : '书名保存失败')
    } finally {
      setBookTitleSaving(false)
    }
  }

  const startEditMeta = (field: MetaField) => {
    if (!book) return
    setMetaError(null)
    setMetaSectionOpen((prev) => ({ ...prev, [field]: true }))
    setEditingField(field)
    if (field === 'characters') {
      setMetaDraftChars((book.characters ?? []).map((c) => ({ ...c })))
    } else if (field === 'summary') {
      setMetaDraftText(book.summary ?? '')
    } else if (field === 'worldSetting') {
      setMetaDraftText(book.worldSetting ?? '')
    } else {
      setMetaDraftText(book.outline ?? '')
    }
  }

  const cancelEditMeta = () => { setEditingField(null); setMetaError(null) }

  const toggleMetaSection = (field: MetaField) => {
    if (editingField === field) return
    setMetaSectionOpen((prev) => ({ ...prev, [field]: !prev[field] }))
  }

  const saveEditMeta = async () => {
    if (!book || !editingField) return
    setMetaSaving(true)
    setMetaError(null)
    try {
      const patch: { summary?: string; outline?: string; worldSetting?: string; characters?: NovelCharacterCard[] } =
        editingField === 'characters'
          ? { characters: metaDraftChars }
          : editingField === 'summary'
            ? { summary: metaDraftText }
            : editingField === 'worldSetting'
              ? { worldSetting: metaDraftText }
              : { outline: metaDraftText }
      const updated = await updateNovelBookMeta(book.id, patch)
      setBook(updated)
      setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
      setEditingField(null)
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setMetaSaving(false)
    }
  }

  const onContinue = async () => {
    if (!book) return
    const nextNumber = (chapters[chapters.length - 1]?.chapterNumber ?? 0) + 1
    const created = await createNovelChapter({ bookId: book.id, chapterNumber: nextNumber, title: `第 ${nextNumber} 章`, content: '', directorNote: '', summary: '' })
    setChapters((prev) => [...prev, created])
    setChapter(created)
  }

  const onSaveSettings = async () => {
    setSettingsSaving(true)
    setSettingsError(null)
    try {
      await saveGlobalConfig(settingsDraft)
      setSettingsOpen(false)
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '保存失败，请稍后重试')
    } finally {
      setSettingsSaving(false)
    }
  }

  const buildWritingContext = (current: NovelChapter, directive: string) => {
    if (!book) return ''
    const window = Math.max(1, Number(activeBookConfig.context_window_chapters) || 1)
    const priorChapters = chapters
      .filter((c) => c.chapterNumber < current.chapterNumber)
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
    const priorSummaries = priorChapters.slice(-window)
      .map((c) => `【第${c.chapterNumber}章 ${c.title}】${c.summary || '（暂无摘要）'}`)
      .join('\n')
    const characters = (book.characters ?? [])
      .map((c) => `- ${c.name || '未命名'}：${c.description || ''}（性格：${c.personality || ''}）`)
      .join('\n')
    const parts = [
      `【世界设定】\n${book.worldSetting || '（无）'}`,
      `【整体大纲】\n${book.outline || '（无）'}`,
      `【角色卡】\n${characters || '（无）'}`,
      priorSummaries ? `【前文摘要】\n${priorSummaries}` : '',
      `【本章已生成正文】\n${current.content || '（这是本章开篇，尚无正文）'}`,
      `【导演指令（本次重点）】\n${directive}`,
      '请基于以上上下文，续写一段小说正文（markdown 段落，不要重复已有内容，不要输出任何解释或前后缀，直接给出续写文本）。',
    ].filter(Boolean)
    return parts.join('\n\n')
  }

  const onAiWrite = async () => {
    if (!chapter || !book) return
    const directive = directorInput.trim()
    if (!directive) {
      setChapterError('请先输入导演指令')
      return
    }
    setWriting(true)
    setChapterError(null)
    try {
      const model = activeBookConfig.writing_model || defaultModelId || 'openrouter/auto'
      const prompt = `${activeBookConfig.prompts.writing_prompt}\n\n${buildWritingContext(chapter, directive)}`
      const generated = (await invokeModel(model, prompt)).trim()
      if (!generated) {
        setChapterError('AI 未返回内容，请稍后重试')
        return
      }
      const continuationStart = chapter.content.length
      const nextContent = chapter.content ? `${chapter.content}\n\n${generated}` : generated
      const nextDirectorNote = chapter.directorNote ? `${chapter.directorNote}\n${directive}` : directive
      const updated = await updateNovelChapter(chapter.id, { content: nextContent, directorNote: nextDirectorNote })
      setChapter(updated)
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setContentDraft(updated.content)
      if (continuationStart > 0) {
        const stored = readContinuationDividers(book.id, chapter.id)
        const nextDividers = normalizeContinuationDividers([...stored, continuationStart], nextContent.length)
        writeContinuationDividers(book.id, chapter.id, nextDividers)
      }
      setDirectorInput('')
    } catch (error) {
      setChapterError(error instanceof Error ? error.message : 'AI 续写失败')
    } finally {
      setWriting(false)
    }
  }

  const onSummarizeChapter = async () => {
    if (!chapter) return
    if (!chapter.content.trim()) {
      setChapterError('本章尚无正文，无法总结')
      return
    }
    setSummarizing(true)
    setChapterError(null)
    try {
      const model = activeBookConfig.summary_model || defaultModelId || 'openrouter/auto'
      const prompt = `${activeBookConfig.prompts.summary_prompt}\n\n严格只输出摘要本身，不要任何前后缀。\n\n章节标题：${chapter.title}\n\n章节正文：\n${chapter.content}`
      const summary = (await invokeModel(model, prompt)).trim()
      const updated = await updateNovelChapter(chapter.id, { summary, status: 'published' })
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setChapter(updated)
      setSummaryDraft(updated.summary)
    } catch (error) {
      setChapterError(error instanceof Error ? error.message : '总结失败')
    } finally {
      setSummarizing(false)
    }
  }

  const onSaveEditedContent = async () => {
    if (!chapter || !book) return
    try {
      const updated = await updateNovelChapter(chapter.id, { content: contentDraft })
      const validDividers = normalizeContinuationDividers(readContinuationDividers(book.id, chapter.id), updated.content.length)
      if (validDividers.length > 0) {
        writeContinuationDividers(book.id, chapter.id, validDividers)
      } else if (typeof window !== 'undefined') {
        window.localStorage.removeItem(continuationDividerKey(book.id, chapter.id))
      }
      setChapter(updated)
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setEditingContent(false)
    } catch (error) {
      setChapterError(error instanceof Error ? error.message : '保存失败')
    }
  }
  const onSaveEditedSummary = async () => {
    if (!chapter) return
    try {
      const updated = await updateNovelChapter(chapter.id, { summary: summaryDraft.trim() })
      setChapter(updated)
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setSummaryEditing(false)
    } catch (error) {
      setChapterError(error instanceof Error ? error.message : '摘要保存失败')
    }
  }


  const chapterDividers = useMemo(() => {
    if (!book || !chapter?.content) return []
    return normalizeContinuationDividers(readContinuationDividers(book.id, chapter.id), chapter.content.length)
  }, [book, chapter?.id, chapter?.content])

  if (!book) return <div className='novel-page'>
    <div className='novel-header novel-card-shell'>
      <button className='novel-pill-btn' onClick={() => navigate('/')}>← 返回</button>
      <div className='novel-title-wrap'>
        <p className='novel-kicker'>STORY STUDIO</p>
        <h1 className='ui-title'>小说工坊</h1>
      </div>
      <button className='novel-pill-btn' onClick={() => setSettingsOpen(true)}>⚙️ 设置</button>
    </div>

    {settingsOpen ? <div className='novel-modal-mask' onClick={() => setSettingsOpen(false)}>
      <section className='novel-settings-modal' onClick={(e) => e.stopPropagation()}>
        <header className='novel-settings-modal__header'>
          <h2>小说设置</h2>
          <button className='novel-pill-btn' onClick={() => setSettingsOpen(false)}>关闭</button>
        </header>
        <div className='novel-settings-panel'>
          <label>写作模型<select value={settingsDraft.writing_model} onChange={(e) => setSettingsDraft((p) => ({ ...p, writing_model: e.target.value }))}>{modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label>摘要模型<select value={settingsDraft.summary_model} onChange={(e) => setSettingsDraft((p) => ({ ...p, summary_model: e.target.value }))}>{modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label>上下文章节数<input type='number' min={1} value={settingsDraft.context_window_chapters} onChange={(e) => setSettingsDraft((p) => ({ ...p, context_window_chapters: Number(e.target.value) || 1 }))} /></label>
          <label>outline_prompt<textarea value={settingsDraft.prompts.outline_prompt} onChange={(e) => setSettingsDraft((p) => ({ ...p, prompts: { ...p.prompts, outline_prompt: e.target.value } }))} /></label>
          <label>writing_prompt<textarea value={settingsDraft.prompts.writing_prompt} onChange={(e) => setSettingsDraft((p) => ({ ...p, prompts: { ...p.prompts, writing_prompt: e.target.value } }))} /></label>
          <label>summary_prompt<textarea value={settingsDraft.prompts.summary_prompt} onChange={(e) => setSettingsDraft((p) => ({ ...p, prompts: { ...p.prompts, summary_prompt: e.target.value } }))} /></label>
          <label>character_gen_prompt<textarea value={settingsDraft.prompts.character_gen_prompt} onChange={(e) => setSettingsDraft((p) => ({ ...p, prompts: { ...p.prompts, character_gen_prompt: e.target.value } }))} /></label>
          {settingsError ? <p className='novel-settings-error'>{settingsError}</p> : null}
        </div>
        <footer className='novel-settings-modal__footer'>
          <button className='novel-pill-btn' onClick={() => setSettingsOpen(false)} disabled={settingsSaving}>取消</button>
          <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void onSaveSettings()} disabled={settingsSaving}>{settingsSaving ? '保存中...' : '保存'}</button>
        </footer>
      </section>
    </div> : null}

    <section className='novel-create'>
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder='关键词/简要描述' />
      <button className='novel-ai-btn' onClick={() => void onAiGenerate()} disabled={aiGenerating || !brief.trim()}>{aiGenerating ? 'AI 生成中...' : 'AI 生成'}</button>
      <input value={draft.title} onChange={(e)=>setDraft((p)=>({...p,title:e.target.value}))} placeholder='书名' />
      <textarea value={draft.summary} onChange={(e)=>setDraft((p)=>({...p,summary:e.target.value}))} placeholder='简介' />
      <textarea value={draft.outline} onChange={(e)=>setDraft((p)=>({...p,outline:e.target.value}))} placeholder='大纲' />
      <textarea value={draft.worldSetting} onChange={(e)=>setDraft((p)=>({...p,worldSetting:e.target.value}))} placeholder='世界设定' />
      <section className='novel-characters'>
        <div className='novel-characters__header'><h3>角色卡</h3><button onClick={()=>setDraft((p)=>({...p,characters:[...p.characters,{name:'',description:'',personality:''}]}))}>+ 新增角色</button></div>
        {draft.characters.map((char, index) => <div key={`${index}-${char.name}`} className='novel-character-card'>
          <input value={char.name} placeholder='name' onChange={(e)=>setDraft((p)=>({...p,characters:p.characters.map((it,i)=>i===index?{...it,name:e.target.value}:it)}))} />
          <textarea value={char.description} placeholder='description' onChange={(e)=>setDraft((p)=>({...p,characters:p.characters.map((it,i)=>i===index?{...it,description:e.target.value}:it)}))} />
          <textarea value={char.personality} placeholder='personality' onChange={(e)=>setDraft((p)=>({...p,characters:p.characters.map((it,i)=>i===index?{...it,personality:e.target.value}:it)}))} />
          <button onClick={()=>setDraft((p)=>({...p,characters:p.characters.filter((_,i)=>i!==index)}))}>删除</button>
        </div>)}
      </section>
      <button className='novel-pill-btn novel-pill-btn--primary novel-create-btn' onClick={() => void onCreate()}>确认创建</button>
    </section>

    <section className='novel-shelf'>{books.map((item)=><button key={item.id} className='novel-card' onClick={()=>void openDetail(item)}><h3>{item.title}</h3><p>{item.summary}</p><span>{item.status}</span><span>{item.updatedAt}</span></button>)}</section>
  </div>

  if (!chapter) return <div className='novel-page'>
    <div className='novel-header novel-card-shell'>
      <button className='novel-pill-btn' onClick={() => setBook(null)}>← 书架</button>
      <div className='novel-title-wrap'>
        <p className='novel-kicker'>Novel</p>
        {editingBookTitle ? (
          <div className='novel-title-edit'>
            <input value={bookTitleDraft} onChange={(e) => setBookTitleDraft(e.target.value)} />
            <button className='novel-pill-btn' onClick={() => setEditingBookTitle(false)} disabled={bookTitleSaving}>取消</button>
            <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void saveBookTitle()} disabled={bookTitleSaving || !bookTitleDraft.trim()}>{bookTitleSaving ? '保存中...' : '保存'}</button>
          </div>
        ) : (
          <h1 className='ui-title'>{book.title}</h1>
        )}
      </div>
      {!editingBookTitle ? <button className='novel-pill-btn' onClick={startEditBookTitle}>编辑书名</button> : null}
      <div className='novel-header-spacer' />
    </div>

    <section className='novel-info-card'>
      <div className='novel-info-card__head'>
        <button className='novel-info-toggle' onClick={() => toggleMetaSection('summary')}>
          <h3>简介</h3>
          <span className={`novel-info-toggle__chevron ${metaSectionOpen.summary ? 'is-open' : ''}`} aria-hidden>▾</span>
        </button>
        {editingField === 'summary' ? (
          <div className='novel-info-card__actions'>
            <button className='novel-pill-btn' onClick={cancelEditMeta} disabled={metaSaving}>取消</button>
            <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void saveEditMeta()} disabled={metaSaving}>{metaSaving ? '保存中...' : '保存'}</button>
          </div>
        ) : (
          <button className='novel-pill-btn' onClick={() => startEditMeta('summary')}>编辑</button>
        )}
      </div>
      {metaSectionOpen.summary ? (editingField === 'summary' ? (
        <>
          <textarea className='novel-info-textarea' value={metaDraftText} onChange={(e) => setMetaDraftText(e.target.value)} rows={3} />
          {metaError ? <p className='novel-settings-error'>{metaError}</p> : null}
        </>
      ) : (
        <p className='novel-info-text'>{book.summary || '（暂无）'}</p>
      )) : null}
    </section>

    <section className='novel-info-card'>
      <div className='novel-info-card__head'>
        <button className='novel-info-toggle' onClick={() => toggleMetaSection('worldSetting')}>
          <h3>世界设定</h3>
          <span className={`novel-info-toggle__chevron ${metaSectionOpen.worldSetting ? 'is-open' : ''}`} aria-hidden>▾</span>
        </button>
        {editingField === 'worldSetting' ? (
          <div className='novel-info-card__actions'>
            <button className='novel-pill-btn' onClick={cancelEditMeta} disabled={metaSaving}>取消</button>
            <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void saveEditMeta()} disabled={metaSaving}>{metaSaving ? '保存中...' : '保存'}</button>
          </div>
        ) : (
          <button className='novel-pill-btn' onClick={() => startEditMeta('worldSetting')}>编辑</button>
        )}
      </div>
      {metaSectionOpen.worldSetting ? (editingField === 'worldSetting' ? (
        <>
          <textarea className='novel-info-textarea' value={metaDraftText} onChange={(e) => setMetaDraftText(e.target.value)} rows={6} />
          {metaError ? <p className='novel-settings-error'>{metaError}</p> : null}
        </>
      ) : (
        <pre className='novel-info-text'>{book.worldSetting || '（暂无）'}</pre>
      )) : null}
    </section>

    <section className='novel-info-card'>
      <div className='novel-info-card__head'>
        <button className='novel-info-toggle' onClick={() => toggleMetaSection('outline')}>
          <h3>大纲</h3>
          <span className={`novel-info-toggle__chevron ${metaSectionOpen.outline ? 'is-open' : ''}`} aria-hidden>▾</span>
        </button>
        {editingField === 'outline' ? (
          <div className='novel-info-card__actions'>
            <button className='novel-pill-btn' onClick={cancelEditMeta} disabled={metaSaving}>取消</button>
            <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void saveEditMeta()} disabled={metaSaving}>{metaSaving ? '保存中...' : '保存'}</button>
          </div>
        ) : (
          <button className='novel-pill-btn' onClick={() => startEditMeta('outline')}>编辑</button>
        )}
      </div>
      {metaSectionOpen.outline ? (editingField === 'outline' ? (
        <>
          <textarea className='novel-info-textarea' value={metaDraftText} onChange={(e) => setMetaDraftText(e.target.value)} rows={6} />
          {metaError ? <p className='novel-settings-error'>{metaError}</p> : null}
        </>
      ) : (
        <pre className='novel-info-text'>{book.outline || '（暂无）'}</pre>
      )) : null}
    </section>

    <section className='novel-info-card'>
      <div className='novel-info-card__head'>
        <button className='novel-info-toggle' onClick={() => toggleMetaSection('characters')}>
          <h3>角色卡</h3>
          <span className={`novel-info-toggle__chevron ${metaSectionOpen.characters ? 'is-open' : ''}`} aria-hidden>▾</span>
        </button>
        {editingField === 'characters' ? (
          <div className='novel-info-card__actions'>
            <button className='novel-pill-btn' onClick={cancelEditMeta} disabled={metaSaving}>取消</button>
            <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void saveEditMeta()} disabled={metaSaving}>{metaSaving ? '保存中...' : '保存'}</button>
          </div>
        ) : (
          <button className='novel-pill-btn' onClick={() => startEditMeta('characters')}>编辑</button>
        )}
      </div>
      {metaSectionOpen.characters ? (editingField === 'characters' ? (
        <div className='novel-character-list'>
          {metaDraftChars.map((c, i) => (
            <div key={i} className='novel-character-chip novel-character-chip--editing'>
              <input className='novel-char-input' value={c.name} placeholder='名称' onChange={(e) => setMetaDraftChars((prev) => prev.map((it, idx) => idx === i ? { ...it, name: e.target.value } : it))} />
              <textarea className='novel-char-input' value={c.description} placeholder='描述' rows={2} onChange={(e) => setMetaDraftChars((prev) => prev.map((it, idx) => idx === i ? { ...it, description: e.target.value } : it))} />
              <textarea className='novel-char-input' value={c.personality} placeholder='性格' rows={2} onChange={(e) => setMetaDraftChars((prev) => prev.map((it, idx) => idx === i ? { ...it, personality: e.target.value } : it))} />
              <button className='novel-pill-btn novel-char-remove' onClick={() => setMetaDraftChars((prev) => prev.filter((_, idx) => idx !== i))}>删除</button>
            </div>
          ))}
          <button className='novel-pill-btn novel-char-add' onClick={() => setMetaDraftChars((prev) => [...prev, { name: '', description: '', personality: '' }])}>+ 新增角色</button>
          {metaError ? <p className='novel-settings-error'>{metaError}</p> : null}
        </div>
      ) : (
        (book.characters && book.characters.length > 0) ? (
          <div className='novel-character-list'>
            {book.characters.map((c, i) => <div key={`${i}-${c.name}`} className='novel-character-chip'>
              <strong>{c.name || '未命名'}</strong>
              {c.description ? <p>{c.description}</p> : null}
              {c.personality ? <p className='novel-character-personality'>性格：{c.personality}</p> : null}
            </div>)}
          </div>
        ) : <p className='novel-info-text'>（暂无）</p>
      )) : null}
    </section>
    <section className='novel-info-card'>
      <h3>写作模型</h3>
      <select className='novel-select' value={activeBookConfig.writing_model} onChange={(e) => void updateNovelBookModelConfig(book.id, { ...activeBookConfig, writing_model: e.target.value })}>
        {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </section>

    <section className='novel-chapter-list'>
      <h3>章节列表</h3>
      {chapters.length === 0 ? <p className='novel-empty'>尚无章节，点击下方按钮开始第 1 章。</p> : null}
      {chapters.map((c) => <button key={c.id} className='novel-chapter-row' onClick={() => setChapter(c)}>
        <span className='novel-chapter-row__title'>第 {c.chapterNumber} 章 · {c.title}</span>
        <span className={`novel-chapter-row__status novel-chapter-row__status--${c.status}`}>{c.status === 'published' ? '已结章' : '草稿中'}</span>
      </button>)}
    </section>
    <button className='novel-pill-btn novel-pill-btn--primary novel-create-btn' onClick={() => void onContinue()}>续写下一章</button>
  </div>

  return <div className='novel-page novel-page--writer'>
    <div className='novel-header novel-card-shell'>
      <button className='novel-pill-btn' onClick={() => setChapter(null)}>← 章节列表</button>
      <div className='novel-title-wrap'>
        <p className='novel-kicker'>{book.title}</p>
        <h1 className='ui-title'>第 {chapter.chapterNumber} 章 · {chapter.title}</h1>
      </div>
      <div className='novel-header-spacer' />
    </div>

    <details className='novel-director-note'>
      <summary>导演备注 <span className='novel-director-note__count'>{chapter.directorNote ? chapter.directorNote.split('\n').filter(Boolean).length : 0} 条</span></summary>
      <div className='novel-director-note__body'>
        {chapter.directorNote
          ? chapter.directorNote.split('\n').filter(Boolean).map((line, i) => <p key={i}>· {line}</p>)
          : <p className='novel-director-note__empty'>暂无导演指令</p>}
      </div>
    </details>

    <section className='novel-reader-paper'>
      <div className='novel-reader-toolbar'>
        <span className='novel-reader-toolbar__label'>正文</span>
        {editingContent ? (
          <div className='novel-reader-toolbar__actions'>
            <button className='novel-pill-btn' onClick={() => { setEditingContent(false); setContentDraft(chapter.content) }}>取消</button>
            <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void onSaveEditedContent()}>保存</button>
          </div>
        ) : (
          <button className='novel-pill-btn' onClick={() => { setContentDraft(chapter.content); setEditingContent(true) }}>编辑</button>
        )}
      </div>
      {editingContent ? (
        <textarea className='novel-reader-editor' value={contentDraft} onChange={(e) => setContentDraft(e.target.value)} />
      ) : (
        <article className='novel-reader-content'>
          {chapter.content
            ? (
              chapterDividers.length > 0
                ? (() => {
                  const segments = [] as { content: string; showDivider: boolean }[]
                  let start = 0
                  for (const offset of chapterDividers) {
                    segments.push({ content: chapter.content.slice(start, offset), showDivider: start !== 0 })
                    start = offset
                  }
                  segments.push({ content: chapter.content.slice(start), showDivider: start !== 0 })
                  return segments.map((segment, index) => (
                    <div key={`${index}-${segment.showDivider ? 'cont' : 'base'}`}>
                      {segment.showDivider ? <div className='novel-continuation-divider' aria-label='AI 续写分割线' /> : null}
                      <MarkdownRenderer content={segment.content} />
                    </div>
                  ))
                })()
                : <MarkdownRenderer content={chapter.content} />
            )
            : <p className='novel-reader-empty'>本章尚未生成任何正文。在下方输入导演指令并点击「AI 续写」开始。</p>}
        </article>
      )}
    </section>

    {!!chapter.summary.trim() || summaryEditing ? (
      <section className='novel-summary-card'>
        <div className='novel-summary-card__head'>
          <h3>本章摘要</h3>
          {summaryEditing ? (
            <div className='novel-info-card__actions'>
              <button className='novel-pill-btn' onClick={() => { setSummaryEditing(false); setSummaryDraft(chapter.summary) }}>取消</button>
              <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void onSaveEditedSummary()} disabled={!summaryDraft.trim()}>保存</button>
            </div>
          ) : (
            <button className='novel-pill-btn' onClick={() => { setSummaryDraft(chapter.summary); setSummaryEditing(true) }}>编辑</button>
          )}
        </div>
        {summaryEditing ? <textarea className='novel-info-textarea' value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} rows={5} /> : <p className='novel-info-text'>{chapter.summary}</p>}
      </section>
    ) : null}

    <section className='novel-director-input-card'>
      <textarea
        className='novel-director-input'
        value={directorInput}
        onChange={(e) => setDirectorInput(e.target.value)}
        placeholder='输入情节方向/要求...'
        rows={3}
      />
      {chapterError ? <p className='novel-settings-error'>{chapterError}</p> : null}
      <div className='novel-writer-actions'>
        <button className='novel-pill-btn novel-pill-btn--primary' onClick={() => void onAiWrite()} disabled={writing || summarizing || !directorInput.trim()}>
          {writing ? 'AI 续写中...' : 'AI 续写'}
        </button>
        <button className='novel-pill-btn' onClick={() => void onSummarizeChapter()} disabled={writing || summarizing || !chapter.content.trim()}>
          {summarizing ? '总结中...' : '总结本章'}
        </button>
      </div>
    </section>
  </div>
}

export default NovelPage
