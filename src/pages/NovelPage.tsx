import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useEnabledModels } from '../hooks/useEnabledModels'
import type { NovelBook, NovelChapter, NovelCharacterCard, NovelModelConfig } from '../types'
import { createNovelBook, createNovelChapter, listNovelBooks, listNovelChaptersByBookId, updateNovelBookModelConfig, updateNovelChapter } from '../storage/supabaseSync'
import './NovelPage.css'

const NovelPage = ({ user }: { user: User | null }) => {
  const { enabledModelIds, defaultModelId } = useEnabledModels(user)
  const [books, setBooks] = useState<NovelBook[]>([])
  const [book, setBook] = useState<NovelBook | null>(null)
  const [chapter, setChapter] = useState<NovelChapter | null>(null)
  const [chapters, setChapters] = useState<NovelChapter[]>([])
  const [brief, setBrief] = useState('')
  const [draft, setDraft] = useState({ title: '', summary: '', outline: '', worldSetting: '', characters: [] as NovelCharacterCard[] })

  const cfg: NovelModelConfig = useMemo(() => {
    const raw = (book?.modelConfig ?? {}) as Partial<NovelModelConfig>
    const base: NovelModelConfig = {
      writing_model: defaultModelId ?? 'openrouter/auto',
      summary_model: defaultModelId ?? 'openrouter/auto',
      context_window_chapters: 3,
      prompts: { outline_prompt: '', writing_prompt: '', summary_prompt: '', character_gen_prompt: '' },
    }
    return {
      ...base,
      ...raw,
      prompts: { ...base.prompts, ...(raw.prompts ?? {}) },
    }
  }, [book?.modelConfig, defaultModelId])

  const reloadBooks = async () => { if (!user) return; setBooks(await listNovelBooks(user.id)) }
  useEffect(() => { void reloadBooks() }, [user?.id])

  const onCreate = async () => {
    if (!user) return
    const created = await createNovelBook({ userId: user.id, title: draft.title || '未命名小说', summary: draft.summary, outline: draft.outline, worldSetting: draft.worldSetting, characters: draft.characters, status: 'draft', modelConfig: cfg })
    await reloadBooks(); setBook(created)
  }

  const openDetail = async (item: NovelBook) => { setBook(item); setChapter(null); setChapters(await listNovelChaptersByBookId(item.id)) }

  const onContinue = async () => {
    if (!book) return
    const nextNumber = (chapters[chapters.length - 1]?.chapterNumber ?? 0) + 1
    const created = await createNovelChapter({ bookId: book.id, chapterNumber: nextNumber, title: `第 ${nextNumber} 章`, content: '（请在此编辑 AI 续写内容）', directorNote: '', summary: '' })
    setChapters((prev) => [...prev, created]); setChapter(created)
  }

  if (!book) return <div className='novel-page'><h1 className='ui-title'>📖 小说</h1><section className='novel-create'><textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder='关键词/简要描述' /><input value={draft.title} onChange={(e)=>setDraft((p)=>({...p,title:e.target.value}))} placeholder='书名' /><textarea value={draft.summary} onChange={(e)=>setDraft((p)=>({...p,summary:e.target.value}))} placeholder='简介' /><textarea value={draft.outline} onChange={(e)=>setDraft((p)=>({...p,outline:e.target.value}))} placeholder='大纲' /><textarea value={draft.worldSetting} onChange={(e)=>setDraft((p)=>({...p,worldSetting:e.target.value}))} placeholder='世界设定' /><button onClick={onCreate}>确认创建</button></section><section className='novel-shelf'>{books.map((item)=><button key={item.id} className='novel-card' onClick={()=>void openDetail(item)}><h3>{item.title}</h3><p>{item.summary}</p><span>{item.status}</span><span>{item.updatedAt}</span></button>)}</section></div>

  if (!chapter) return <div className='novel-page'><button onClick={()=>setBook(null)}>← 书架</button><h1>{book.title}</h1><p>{book.status}</p><div className='novel-detail-grid'><section><h3>设定</h3><pre>{book.worldSetting}</pre></section><section><h3>大纲</h3><pre>{book.outline}</pre></section><section><h3>配置</h3><select value={cfg.writing_model} onChange={(e)=>void updateNovelBookModelConfig(book.id,{...cfg,writing_model:e.target.value})}>{(enabledModelIds.length?enabledModelIds:[cfg.writing_model]).map((m)=><option key={m} value={m}>{m}</option>)}</select></section></div><section>{chapters.map((c)=><button key={c.id} onClick={()=>setChapter(c)}>第{c.chapterNumber}章 {c.title}</button>)}</section><button onClick={()=>void onContinue()}>续写下一章</button></div>

  return <div className='novel-reader'><button onClick={()=>setChapter(null)}>← 返回章节列表</button><h2>{chapter.title}</h2><details><summary>导演备注</summary><p>{chapter.directorNote || '暂无'}</p></details><article style={{ whiteSpace: 'pre-wrap' }}>{chapter.content}</article><button onClick={async ()=>{ const updated=await updateNovelChapter(chapter.id,{content:chapter.content, directorNote:chapter.directorNote}); setChapter(updated)}}>保存本章</button></div>
}

export default NovelPage
