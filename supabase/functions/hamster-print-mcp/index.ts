import { z } from 'npm:zod@^4.1.13'
import { errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'
import {
  MAX_PRINT_CONTENT_LENGTH,
  MAX_PRINT_PAGES,
  normalizePrintRequest,
  PRINT_COMMAND_TYPE,
} from './print_contract.ts'
import {
  countTweetCharacters,
  isTwitterPostJob,
  MAX_TWEET_TEXT_LENGTH,
  normalizeTweetRequest,
  tweetRequestIdempotencyKey,
  TWITTER_COMMAND_TYPE,
} from './twitter_contract.ts'

const JOB_COLUMNS = 'id, command_type, status, payload, result, error_message, idempotency_key, claimed_by, claimed_at, created_at, updated_at, completed_at'

type CommandJob = Record<string, unknown>

const getJobByIdempotencyKey = async (
  commandType: string,
  idempotencyKey: string,
): Promise<CommandJob | null> => {
  const { data, error } = await supabase
    .from('syzygy_commands')
    .select(JOB_COLUMNS)
    .eq('user_id', USER_ID)
    .eq('command_type', commandType)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (error) throw error
  return data as CommandJob | null
}

const enqueueJob = async (
  commandType: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) => {
  const existing = await getJobByIdempotencyKey(commandType, idempotencyKey)
  if (existing) return { created: false, job: existing }

  const { data, error } = await supabase
    .from('syzygy_commands')
    .insert({
      user_id: USER_ID,
      command_type: commandType,
      payload,
      status: 'pending',
      idempotency_key: idempotencyKey,
    })
    .select(JOB_COLUMNS)
    .single()

  if (!error) return { created: true, job: data as CommandJob }
  if (error.code !== '23505') throw error

  const racedJob = await getJobByIdempotencyKey(commandType, idempotencyKey)
  if (!racedJob) throw error
  return { created: false, job: racedJob }
}

serveMcp('hamster-print-mcp', (server) => {
  server.registerTool('print_document', {
    title: 'Print Document',
    description: '把长文作为标准打印任务投递到 Supabase，由 Mac mini 常驻 worker 自动领取、按真实字体测量拆成多页 PDF，再送入本机打印队列。只有串串明确要求真实打印时才能调用；confirmed 必须为 true。同一 request_id 或同日同内容默认幂等，不会因网络重试重复打印。',
    inputSchema: {
      title: z.string().min(1).max(120).describe('打印标题，最长 120 字符'),
      content: z.string().min(1).max(MAX_PRINT_CONTENT_LENGTH).describe(`打印正文，最长 ${MAX_PRINT_CONTENT_LENGTH} 字符；长文会自动拆页`),
      confirmed: z.literal(true).describe('串串已明确授权这次真实打印，必须为 true'),
      date: z.string().max(64).optional().describe('页面日期；不传时由 Mac mini 使用执行日期'),
      footer: z.string().max(120).optional().describe('页脚；默认 — Syzygy'),
      copies: z.number().int().min(1).max(3).optional().describe('份数，默认 1，最大 3'),
      printer: z.string().max(120).optional().describe('可选 CUPS 打印机名；不传使用 Mac mini 默认打印机'),
      source: z.string().max(64).optional().describe('调用来源，如 chatgpt_web / codex_desktop / claude / expo_app'),
      request_id: z.string().max(120).optional().describe('本次逻辑请求的稳定幂等键；重试时复用同一个值'),
      allow_duplicate: z.boolean().optional().describe('明确需要再次打印相同内容时设为 true；默认 false'),
      max_pages: z.number().int().min(1).max(MAX_PRINT_PAGES).optional().describe('本次允许的最大页数，默认 50，最大 100；超出会失败且不会送印'),
    },
  }, async ({ title, content, date, footer, copies, printer, source, request_id, allow_duplicate, max_pages }) => {
    try {
      const normalized = await normalizePrintRequest({
        title,
        content,
        date,
        footer,
        copies,
        printer,
        source,
        request_id,
        allow_duplicate,
        max_pages,
      })
      const result = await enqueueJob(
        PRINT_COMMAND_TYPE,
        normalized.payload,
        normalized.idempotencyKey,
      )
      return jsonResult({
        created: result.created,
        deduplicated: !result.created,
        job: result.job,
      })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('get_print_status', {
    title: 'Get Print Status',
    description: '查询 hamster-print-mcp 投递的打印任务状态。pending=等待 Mac mini，running=已领取，done=已生成并送入 CUPS，failed=失败。只读工具。',
    inputSchema: {
      command_id: z.string().uuid().optional().describe('print_document 返回的任务 UUID'),
      request_id: z.string().max(120).optional().describe('print_document 使用的 request_id'),
    },
  }, async ({ command_id, request_id }) => {
    try {
      if (!command_id && !request_id) {
        throw new Error('command_id 与 request_id 至少提供一个')
      }

      let query = supabase
        .from('syzygy_commands')
        .select(JOB_COLUMNS)
        .eq('user_id', USER_ID)
        .eq('command_type', PRINT_COMMAND_TYPE)

      query = command_id
        ? query.eq('id', command_id)
        : query.eq('idempotency_key', `print:v1:request:${request_id?.trim()}`)

      const { data, error } = await query.maybeSingle()
      if (error) throw error
      if (!data) throw new Error('print job not found')
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('post_tweet', {
    title: 'Post Tweet',
    description: '把一条文字推文投递到 Supabase，由 Mac mini 常驻 worker 通过 OpenCLI 发布到 X/Twitter。只有串串明确要求真实发布时才能调用；confirmed 必须为 true。同一 request_id 或同日同内容默认幂等，避免网络重试造成重复推文。',
    inputSchema: {
      text: z.string().min(1).refine(
        (value) => countTweetCharacters(value.replace(/\r\n?/gu, '\n').trim()) <= MAX_TWEET_TEXT_LENGTH,
        `推文最长 ${MAX_TWEET_TEXT_LENGTH} 个 Unicode 字符`,
      ).describe(`推文正文，最长 ${MAX_TWEET_TEXT_LENGTH} 个 Unicode 字符；X/Twitter 仍会执行平台侧最终校验`),
      confirmed: z.literal(true).describe('串串已明确授权这次真实发推，必须为 true'),
      request_id: z.string().max(120).optional().describe('本次逻辑请求的稳定幂等键；重试时复用同一个值'),
      allow_duplicate: z.boolean().optional().describe('明确需要再次发布相同正文时设为 true；默认 false'),
    },
  }, async ({ text, request_id, allow_duplicate }) => {
    try {
      const normalized = await normalizeTweetRequest({
        text,
        request_id,
        allow_duplicate,
      })
      const result = await enqueueJob(
        TWITTER_COMMAND_TYPE,
        normalized.payload,
        normalized.idempotencyKey,
      )
      if (!isTwitterPostJob(result.job)) {
        throw new Error('tweet idempotency key resolved to a non-Twitter command')
      }
      return jsonResult({
        created: result.created,
        deduplicated: !result.created,
        job: result.job,
      })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('get_tweet_status', {
    title: 'Get Tweet Status',
    description: '查询 hamster-print-mcp 投递的推文任务状态。pending=等待 Mac mini，running=已领取，done=已发布并返回推文 ID/URL，failed=失败。只读工具。',
    inputSchema: {
      command_id: z.string().uuid().optional().describe('post_tweet 返回的任务 UUID'),
      request_id: z.string().max(120).optional().describe('post_tweet 使用的 request_id'),
    },
  }, async ({ command_id, request_id }) => {
    try {
      if (!command_id && !request_id) {
        throw new Error('command_id 与 request_id 至少提供一个')
      }

      let query = supabase
        .from('syzygy_commands')
        .select(JOB_COLUMNS)
        .eq('user_id', USER_ID)
        .eq('command_type', TWITTER_COMMAND_TYPE)

      query = command_id
        ? query.eq('id', command_id)
        : query.eq('idempotency_key', tweetRequestIdempotencyKey(request_id ?? ''))

      const { data, error } = await query.maybeSingle()
      if (error) throw error
      if (!data || !isTwitterPostJob(data)) throw new Error('tweet job not found')
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })
}, 'hamster-print')
