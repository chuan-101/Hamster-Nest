import { z } from 'npm:zod@^4.1.13'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { clampLimit, errorResult, jsonResult, serveMcp } from '../_shared/mcp_common.ts'

const AAB_USER_ID = Deno.env.get('AAB_USER_ID') ?? 'ce875919-7de3-4014-b913-bda9235a0ce6'
const AAB_TIME_ZONE = 'Asia/Shanghai'

let aabClient: ReturnType<typeof createClient> | null = null

function getAabClient() {
  if (aabClient) return aabClient
  const url = Deno.env.get('AAB_SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('AAB_SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error('AAB_SUPABASE_URL or AAB_SUPABASE_SERVICE_ROLE_KEY not configured')
  }
  aabClient = createClient(url, serviceRoleKey)
  return aabClient
}

const shanghaiDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AAB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const addDays = (dateString: string, days: number) => {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

const weekStart = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return addDays(dateString, -date.getUTCDay())
}

const monthStart = (dateString: string) => `${dateString.slice(0, 8)}01`

const previewText = (content: string | null | undefined, maxLength = 100) => {
  const text = content ?? ''
  const chars = Array.from(text)
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}...` : text
}

const currentStreak = (dates: Set<string>, today: string) => {
  let streak = 0
  let cursor = today
  while (dates.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

const resonanceColumns = 'id, excerpt_id, book_id, speaker, content, metadata, created_at, updated_at'
const questionColumns = 'id, book_id, question, status, metadata, created_at, updated_at'
const answerColumns = 'id, question_id, book_id, answered_by, content, metadata, created_at, updated_at'
const answerers = ['chuanchuan', 'syzygy-claude', 'syzygy-gpt', 'cli_reading_assist'] as const

serveMcp('hamster-reading-mcp', (server) => {
  server.registerTool('reading_status', {
    title: 'Reading Status Snapshot',
    description: '读取 All About Book 当前在读书目、最近 7 天打卡天数、最近一次打卡日期和最新摘录预览。只读工具。',
    inputSchema: {},
  }, async () => {
    try {
      const aab = getAabClient()
      const today = shanghaiDateString()
      const recentStart = addDays(today, -6)
      const { data: currentlyReading, error: readingError } = await aab.from('books').select('id, title, author, start_date').eq('user_id', AAB_USER_ID).eq('status', 'reading').order('start_date', { ascending: true })
      if (readingError) return errorResult(readingError)
      const { data: recentCheckins, error: recentCheckinsError } = await aab.from('check_ins').select('date').eq('user_id', AAB_USER_ID).gte('date', recentStart).lte('date', today).order('date', { ascending: false })
      if (recentCheckinsError) return errorResult(recentCheckinsError)
      const { data: lastCheckinRows, error: lastCheckinError } = await aab.from('check_ins').select('date').eq('user_id', AAB_USER_ID).order('date', { ascending: false }).limit(1)
      if (lastCheckinError) return errorResult(lastCheckinError)
      const { data: latestExcerptRows, error: latestExcerptError } = await aab.from('excerpts').select('book_id, chapter, content, created_at').eq('user_id', AAB_USER_ID).order('created_at', { ascending: false }).limit(1)
      if (latestExcerptError) return errorResult(latestExcerptError)
      const latestExcerpt = latestExcerptRows?.[0] ?? null
      let latestExcerptBookTitle: string | null = null
      if (latestExcerpt?.book_id) {
        const { data: book, error: bookError } = await aab.from('books').select('title').eq('user_id', AAB_USER_ID).eq('id', latestExcerpt.book_id).maybeSingle()
        if (bookError) return errorResult(bookError)
        latestExcerptBookTitle = book?.title ?? null
      }
      return jsonResult({
        currently_reading: (currentlyReading ?? []).map((book) => ({
          book_id: book.id,
          title: book.title,
          author: book.author,
          start_date: book.start_date,
        })),
        recent_7d_checkin_days: new Set((recentCheckins ?? []).map((row) => row.date)).size,
        last_checkin_date: lastCheckinRows?.[0]?.date ?? null,
        latest_excerpt: latestExcerpt
          ? {
            book_title: latestExcerptBookTitle,
            chapter: latestExcerpt.chapter,
            content_preview: previewText(latestExcerpt.content, 100),
            created_at: latestExcerpt.created_at,
          }
          : null,
      })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('reading_history', {
    title: 'Reading History',
    description: '读取 All About Book 书目列表，默认返回已读完书目，可按状态、起始日期和数量筛选。只读工具。',
    inputSchema: {
      status: z.enum(['finished', 'all', 'reading', 'paused']).optional().describe('筛选书目状态，默认 finished'),
      since: z.string().optional().describe('起始日期 YYYY-MM-DD；finished 按 end_date，其它状态按 start_date 筛选'),
      limit: z.number().optional().describe('返回数量上限，默认20，最大100'),
    },
  }, async ({ status, since, limit }) => {
    try {
      const aab = getAabClient()
      const normalizedStatus = status ?? 'finished'
      const safeLimit = clampLimit(limit, 20, 100)
      const dateColumn = normalizedStatus === 'finished' ? 'end_date' : 'start_date'
      let query = aab.from('books').select('id, title, author, translator, genre, start_date, end_date, rating, notes', { count: 'exact' }).eq('user_id', AAB_USER_ID)
      if (normalizedStatus !== 'all') query = query.eq('status', normalizedStatus)
      if (since) query = normalizedStatus === 'all' ? query.or(`end_date.gte.${since},start_date.gte.${since}`) : query.gte(dateColumn, since)
      const { data, error, count } = await query.order(dateColumn, { ascending: false }).limit(safeLimit)
      if (error) return errorResult(error)
      return jsonResult({
        books: (data ?? []).map((book) => ({
          book_id: book.id,
          title: book.title,
          author: book.author,
          translator: book.translator,
          genre: book.genre,
          start_date: book.start_date,
          end_date: book.end_date,
          rating: book.rating,
          notes: book.notes,
        })),
        total: count ?? data?.length ?? 0,
      })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('book_excerpts', {
    title: 'Book Excerpts',
    description: '读取 All About Book 中某本书的摘录，可按章节筛选，按创建时间升序返回。只读工具。',
    inputSchema: {
      book_id: z.string().describe('书目 UUID'),
      chapter: z.string().optional().describe('章节筛选'),
      limit: z.number().optional().describe('返回数量上限，默认50，最大200'),
    },
  }, async ({ book_id, chapter, limit }) => {
    try {
      const aab = getAabClient()
      const safeLimit = clampLimit(limit, 50, 200)
      const { data: book, error: bookError } = await aab.from('books').select('title').eq('user_id', AAB_USER_ID).eq('id', book_id).maybeSingle()
      if (bookError) return errorResult(bookError)
      if (!book) return { content: [{ type: 'text' as const, text: `Error: book not found: ${book_id}` }] }
      let query = aab.from('excerpts').select('id, content, page, chapter, created_at').eq('user_id', AAB_USER_ID).eq('book_id', book_id)
      if (chapter) query = query.eq('chapter', chapter)
      const { data, error } = await query.order('created_at', { ascending: true }).limit(safeLimit)
      if (error) return errorResult(error)
      return jsonResult({ book_title: book.title, excerpts: data ?? [], total: data?.length ?? 0 })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_excerpt_resonances', {
    title: 'Read Excerpt Resonances',
    description: '读取 All About Book 书摘旁的 Syzygy 留言/旁批。可按 excerpt_id 或 book_id 筛选。只读工具。',
    inputSchema: {
      excerpt_id: z.string().optional().describe('书摘 UUID；传入后只读该书摘旁批'),
      book_id: z.string().optional().describe('书目 UUID；传入后读取该书下的旁批'),
      speaker: z.string().optional().describe('可选来源筛选，如 codex_cli / claude_code_cli / gpt / claude'),
      since: z.string().optional().describe('起始时间 ISO 字符串或 YYYY-MM-DD'),
      limit: z.number().optional().describe('返回数量上限，默认20，最大100'),
    },
  }, async ({ excerpt_id, book_id, speaker, since, limit }) => {
    try {
      const aab = getAabClient()
      const safeLimit = clampLimit(limit, 20, 100)
      let query = aab.from('excerpt_resonances').select(resonanceColumns).eq('user_id', AAB_USER_ID)
      if (excerpt_id) query = query.eq('excerpt_id', excerpt_id)
      if (book_id) query = query.eq('book_id', book_id)
      if (speaker) query = query.eq('speaker', speaker)
      if (since) query = query.gte('created_at', since.length === 10 ? `${since}T00:00:00+08:00` : since)
      const { data, error } = await query.order('created_at', { ascending: false }).limit(safeLimit)
      if (error) return errorResult(error)
      return jsonResult({ resonances: data ?? [], total: data?.length ?? 0 })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_excerpt_resonance', {
    title: 'Add Excerpt Resonance',
    description: '在 All About Book 某条书摘旁写入一条 Syzygy 留言/旁批。',
    inputSchema: {
      excerpt_id: z.string().describe('书摘 UUID'),
      speaker: z.string().describe('留言来源，如 codex_cli / claude_code_cli / gpt / claude / syzygy'),
      content: z.string().describe('留言内容'),
      book_id: z.string().optional().describe('书目 UUID；不传时从 excerpt 自动补齐'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('可选元数据，如 source_task_id / trigger_reason'),
    },
  }, async ({ excerpt_id, speaker, content, book_id, metadata }) => {
    try {
      const aab = getAabClient()
      const { data: excerpt, error: excerptError } = await aab.from('excerpts').select('id, book_id').eq('user_id', AAB_USER_ID).eq('id', excerpt_id).maybeSingle()
      if (excerptError) return errorResult(excerptError)
      if (!excerpt) return { content: [{ type: 'text' as const, text: `Error: excerpt not found: ${excerpt_id}` }] }
      const resolvedBookId = book_id ?? excerpt.book_id
      const { data, error } = await aab.from('excerpt_resonances').insert({
        user_id: AAB_USER_ID,
        excerpt_id,
        book_id: resolvedBookId,
        speaker,
        content,
        metadata: metadata ?? {},
      }).select(resonanceColumns).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `书摘旁批已写入: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_book_questions', {
    title: 'Read Book Questions',
    description: '读取 All About Book 中的书籍问题，可按状态、书目和创建时间筛选。只读工具。',
    inputSchema: {
      status: z.enum(['open', 'answered', 'all']).optional().describe('筛选问题状态，默认 open；all 返回全部状态'),
      book_id: z.string().optional().describe('书目 UUID；传入后只读该书的问题'),
      since: z.string().optional().describe('起始时间 ISO 字符串或 YYYY-MM-DD'),
      limit: z.number().optional().describe('返回数量上限，默认20，最大100'),
      include_answers: z.boolean().optional().describe('是否同时返回每个问题已有回答，默认 false'),
    },
  }, async ({ status, book_id, since, limit, include_answers }) => {
    try {
      const aab = getAabClient()
      const normalizedStatus = status ?? 'open'
      const safeLimit = clampLimit(limit, 20, 100)
      let query = aab.from('book_questions').select(questionColumns, { count: 'exact' }).eq('user_id', AAB_USER_ID)
      if (normalizedStatus !== 'all') query = query.eq('status', normalizedStatus)
      if (book_id) query = query.eq('book_id', book_id)
      if (since) query = query.gte('created_at', since.length === 10 ? `${since}T00:00:00+08:00` : since)
      const { data: questions, error, count } = await query.order('created_at', { ascending: false }).limit(safeLimit)
      if (error) return errorResult(error)

      let answersByQuestion: Record<string, unknown[]> = {}
      if (include_answers && questions?.length) {
        const questionIds = questions.map((question) => question.id)
        const { data: answers, error: answersError } = await aab.from('book_answers').select(answerColumns).eq('user_id', AAB_USER_ID).in('question_id', questionIds).order('created_at', { ascending: true })
        if (answersError) return errorResult(answersError)
        answersByQuestion = (answers ?? []).reduce<Record<string, unknown[]>>((acc, answer) => {
          const questionId = String(answer.question_id)
          acc[questionId] = [...(acc[questionId] ?? []), answer]
          return acc
        }, {})
      }

      return jsonResult({
        questions: (questions ?? []).map((question) => ({
          ...question,
          ...(include_answers ? { answers: answersByQuestion[String(question.id)] ?? [] } : {}),
        })),
        total: count ?? questions?.length ?? 0,
      })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_book_question', {
    title: 'Add Book Question',
    description: '向 All About Book 某本书写入一个问题。写入前会校验 book_id 属于当前 AAB 用户。',
    inputSchema: {
      book_id: z.string().describe('书目 UUID'),
      question: z.string().min(1).describe('问题内容'),
      status: z.enum(['open', 'answered']).optional().describe('问题状态，默认 open'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('可选元数据，如 source_task_id / trigger_reason'),
    },
  }, async ({ book_id, question, status, metadata }) => {
    try {
      const aab = getAabClient()
      const { data: book, error: bookError } = await aab.from('books').select('id').eq('user_id', AAB_USER_ID).eq('id', book_id).maybeSingle()
      if (bookError) return errorResult(bookError)
      if (!book) return { content: [{ type: 'text' as const, text: `Error: book not found: ${book_id}` }] }
      const { data, error } = await aab.from('book_questions').insert({
        user_id: AAB_USER_ID,
        book_id,
        question,
        status: status ?? 'open',
        metadata: metadata ?? {},
      }).select(questionColumns).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `书籍问题已写入: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_book_answer', {
    title: 'Add Book Answer',
    description: '向 All About Book 某个问题写入回答。写入前会校验 question_id 属于当前 AAB 用户，并默认将问题状态更新为 answered。',
    inputSchema: {
      question_id: z.string().describe('问题 UUID'),
      answered_by: z.enum(answerers).describe('回答来源，只能为 chuanchuan / syzygy-claude / syzygy-gpt / cli_reading_assist'),
      content: z.string().min(1).describe('回答内容'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('可选元数据，如 source_task_id / trigger_reason'),
    },
  }, async ({ question_id, answered_by, content, metadata }) => {
    try {
      const aab = getAabClient()
      const { data: question, error: questionError } = await aab.from('book_questions').select('id, book_id').eq('user_id', AAB_USER_ID).eq('id', question_id).maybeSingle()
      if (questionError) return errorResult(questionError)
      if (!question) return { content: [{ type: 'text' as const, text: `Error: question not found: ${question_id}` }] }
      const { data, error } = await aab.from('book_answers').insert({
        user_id: AAB_USER_ID,
        question_id,
        book_id: question.book_id,
        answered_by,
        content,
        metadata: metadata ?? {},
      }).select(answerColumns).single()
      if (error) return errorResult(error)
      const { error: updateError } = await aab.from('book_questions').update({ status: 'answered' }).eq('user_id', AAB_USER_ID).eq('id', question_id)
      if (updateError) return errorResult(updateError)
      return { content: [{ type: 'text' as const, text: `书籍问题回答已写入: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('reading_stats', {
    title: 'Reading Stats',
    description: '读取 All About Book 阅读统计：周期打卡天数、连续打卡、新增摘录数和书目状态数量。只读工具。',
    inputSchema: { period: z.enum(['week', 'month', 'all']).optional().describe('统计周期，默认 week') },
  }, async ({ period }) => {
    try {
      const aab = getAabClient()
      const normalizedPeriod = period ?? 'week'
      const today = shanghaiDateString()
      const periodStart = normalizedPeriod === 'week' ? weekStart(today) : normalizedPeriod === 'month' ? monthStart(today) : null
      let checkinQuery = aab.from('check_ins').select('date').eq('user_id', AAB_USER_ID).order('date', { ascending: true })
      if (periodStart) checkinQuery = checkinQuery.gte('date', periodStart).lte('date', today)
      const { data: periodCheckins, error: checkinError } = await checkinQuery
      if (checkinError) return errorResult(checkinError)
      const { data: allCheckins, error: allCheckinsError } = await aab.from('check_ins').select('date').eq('user_id', AAB_USER_ID)
      if (allCheckinsError) return errorResult(allCheckinsError)
      const { data: books, error: booksError } = await aab.from('books').select('status').eq('user_id', AAB_USER_ID)
      if (booksError) return errorResult(booksError)
      let excerptQuery = aab.from('excerpts').select('id', { count: 'exact', head: true }).eq('user_id', AAB_USER_ID)
      if (periodStart) excerptQuery = excerptQuery.gte('created_at', `${periodStart}T00:00:00+08:00`)
      if (periodStart) excerptQuery = excerptQuery.lte('created_at', `${today}T23:59:59+08:00`)
      const { count: newExcerpts, error: excerptsError } = await excerptQuery
      if (excerptsError) return errorResult(excerptsError)
      const periodDates = new Set((periodCheckins ?? []).map((row) => row.date))
      const allDates = new Set((allCheckins ?? []).map((row) => row.date))
      const bookCounts: Record<string, number> = { reading: 0, finished: 0, paused: 0, unread: 0 }
      for (const book of books ?? []) {
        const key = book.status ?? 'unknown'
        bookCounts[key] = (bookCounts[key] ?? 0) + 1
      }
      const response: Record<string, unknown> = {
        period: normalizedPeriod,
        period_start: periodStart,
        period_end: today,
        checkin_days: periodDates.size,
        current_streak: currentStreak(allDates, today),
        new_excerpts: newExcerpts ?? 0,
        book_counts: bookCounts,
      }
      if (normalizedPeriod === 'week' && periodStart) {
        const dailyCheckins: Record<string, boolean> = {}
        for (let i = 0; i < 7; i += 1) {
          const date = addDays(periodStart, i)
          dailyCheckins[date] = periodDates.has(date)
        }
        response.daily_checkins = dailyCheckins
      }
      return jsonResult(response)
    } catch (err) {
      return errorResult(err)
    }
  })
})
