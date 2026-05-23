import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { useEnabledModels } from '../hooks/useEnabledModels'
import { supabase } from '../supabase/client'
import type { NovelBook, NovelChapter, NovelCharacterCard, NovelModelConfig } from '../types'
import { createNovelBook, createNovelChapter, listNovelBooks, listNovelChaptersByBookId, updateNovelBookModelConfig, updateNovelChapter } from '../storage/supabaseSync'
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

  const openDetail = async (item: NovelBook) => { setBook(item); setChapter(null); setChapters(await listNovelChaptersByBookId(item.id)) }
  const onContinue = async () => {
    if (!book) return
    const nextNumber = (chapters[chapters.length - 1]?.chapterNumber ?? 0) + 1
    const created = await createNovelChapter({ bookId: book.id, chapterNumber: nextNumber, title: `第 ${nextNumber} 章`, content: '（请在此编辑 AI 续写内容）', directorNote: '', summary: '' })
    setChapters((prev) => [...prev, created]); setChapter(created)
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

  if (!book) return <div className='novel-page'>
    <div className='novel-header novel-card-shell'>
      <button className='novel-pill-btn' onClick={() => navigate('/')}>← 返回</button>
      <div className='novel-title-wrap'>
        <p className='novel-kicker'>Story Studio</p>
        <h1 className='ui-title'>📖 小说工坊</h1>
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

  if (!chapter) return <div className='novel-page'><button onClick={()=>setBook(null)}>← 书架</button><h1>{book.title}</h1><p>{book.status}</p><div className='novel-detail-grid'><section><h3>设定</h3><pre>{book.worldSetting}</pre></section><section><h3>大纲</h3><pre>{book.outline}</pre></section><section><h3>配置</h3><select value={activeBookConfig.writing_model} onChange={(e)=>void updateNovelBookModelConfig(book.id,{...activeBookConfig,writing_model:e.target.value})}>{modelOptions.map((m)=><option key={m} value={m}>{m}</option>)}</select></section></div><section>{chapters.map((c)=><button key={c.id} onClick={()=>setChapter(c)}>第{c.chapterNumber}章 {c.title}</button>)}</section><button onClick={()=>void onContinue()}>续写下一章</button></div>

  return <div className='novel-reader'><button onClick={()=>setChapter(null)}>← 返回章节列表</button><h2>{chapter.title}</h2><details><summary>导演备注</summary><p>{chapter.directorNote || '暂无'}</p></details><article style={{ whiteSpace: 'pre-wrap' }}>{chapter.content}</article><button onClick={async ()=>{ const updated=await updateNovelChapter(chapter.id,{content:chapter.content, directorNote:chapter.directorNote}); setChapter(updated)}}>保存本章</button></div>
}

export default NovelPage
