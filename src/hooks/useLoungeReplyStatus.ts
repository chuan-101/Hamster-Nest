import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase/client'

// E-4A：仓鼠客厅「正在回复」状态。
//
// 数据源选型（只读，不改 schema / Runtime / Edge Function）：
//  - lounge_messages 表没有 read_by 列 → 方案①（read_by 状态标记）不存在，排除。
//  - agent_tasks 不在 supabase_realtime 发布里，无法实时推送 → 不选。
//  - syzygy_commands 命中所有需求且在 realtime 发布里：
//      payload.source = 'lounge_messages'
//      payload.target_role = claude_code_cli_syzygy / codex_cli_syzygy
//      payload.source_message_id / lounge_message_id = 被 @ 的原消息 id
//      payload.lounge_sofa_id = 沙发 id（按沙发隔离）
//      payload.source_role = 发起者（chuanchuan 或某模型）→ 天然兼容「模型 @ 模型」
//      status = pending / running / done / failed（E-4B 本地 Runtime 写入）
//    RLS：select 限定 auth.uid() = user_id，前端登录用户能读自己的命令，
//    无 service_role 也可读；读不到时优雅降级（不显示动画、不崩溃）。

export type LoungeReplyStatusPhase = 'processing' | 'timeout' | 'failed'

export type LoungeReplyStatus = {
  commandId: string
  sourceMessageId: string
  targetRole: string
  phase: LoungeReplyStatusPhase
}

type CommandRow = {
  id: string
  status: string | null
  payload: Record<string, unknown> | null
  created_at: string | null
  completed_at: string | null
}

// 只关心近期命令：避免历史 done/failed 把客厅塞满旧提示（保持动画「轻」）。
const STATUS_WINDOW_MS = 30 * 60 * 1000
// 超过 2 分钟仍未 done/failed → 判定为「可能卡住了」。
const TIMEOUT_MS = 2 * 60 * 1000

// 状态值归一：兼容 syzygy_commands(pending/running/done/failed) 与
// agent_tasks(processing/completed)、read_by 标记(processing) 等旧写法。
const PROCESSING_STATUSES = new Set(['pending', 'running', 'processing', 'claimed', 'in_progress'])
const DONE_STATUSES = new Set(['done', 'completed', 'complete', 'success', 'succeeded'])
const FAILED_STATUSES = new Set(['failed', 'fail', 'error', 'errored', 'cancelled', 'canceled'])

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const matchesSofa = (row: CommandRow, sofaId: string): boolean => {
  const payload = row.payload ?? {}
  return (
    asString(payload['source']) === 'lounge_messages' &&
    asString(payload['lounge_sofa_id']) === sofaId
  )
}

/**
 * 读取某张沙发上「被 @ 角色正在回复」的状态，返回
 * Map<原消息 id, 该消息下方要展示的状态指示器列表>。
 */
export const useLoungeReplyStatus = (
  sofaId: string | undefined,
  userId: string | undefined,
): Map<string, LoungeReplyStatus[]> => {
  const [rows, setRows] = useState<Map<string, CommandRow>>(() => new Map())
  // 超时判定依赖时间推进，定时刷新 now 触发重算。
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!supabase || !sofaId || !userId) {
      setRows(new Map())
      return
    }
    const client = supabase
    let active = true

    const load = async () => {
      // 滚动 30 分钟窗口：每次重取都重建 map，自动淘汰过旧的 done/failed，避免堆积。
      const windowStart = new Date(Date.now() - STATUS_WINDOW_MS).toISOString()
      try {
        const { data, error } = await client
          .from('syzygy_commands')
          .select('id,status,payload,created_at,completed_at')
          .eq('user_id', userId)
          .gte('created_at', windowStart)
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) {
          throw error
        }
        if (!active) {
          return
        }
        const next = new Map<string, CommandRow>()
        for (const row of (data ?? []) as CommandRow[]) {
          if (matchesSofa(row, sofaId)) {
            next.set(row.id, row)
          }
        }
        setRows(next)
      } catch (loadError) {
        // 权限不足 / 网络异常：优雅降级，不显示动画也不让页面崩溃。
        console.warn('读取客厅回复状态失败（降级为不显示动画）', loadError)
        if (active) {
          setRows(new Map())
        }
      }
    }
    void load()

    // Realtime：本地 Runtime 把 pending→running→done/failed 写进 syzygy_commands，
    // 这里实时收 INSERT/UPDATE，让动画即时出现 / 消失。filter 只能按顶层列，
    // 用 user_id 收窄，沙发 / 来源再在客户端过滤。
    const channel = client
      .channel(`lounge-reply-status-${sofaId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'syzygy_commands',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as CommandRow | null
          if (!row?.id || !matchesSofa(row, sofaId)) {
            return
          }
          setRows((prev) => {
            const next = new Map(prev)
            next.set(row.id, row)
            return next
          })
        },
      )
      .subscribe()

    // 兜底轮询：万一某条 realtime UPDATE（尤其 done）丢了，避免动画卡着不消失。
    const refetch = window.setInterval(() => void load(), 25000)

    return () => {
      active = false
      window.clearInterval(refetch)
      void client.removeChannel(channel)
    }
  }, [sofaId, userId])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  return useMemo(() => {
    // 同一原消息 + 同一角色可能有多条命令（重试），收敛到 created_at 最新的一条。
    const latestByKey = new Map<string, { row: CommandRow; messageId: string; targetRole: string }>()
    for (const row of rows.values()) {
      const payload = row.payload ?? {}
      const messageId =
        asString(payload['source_message_id']) ?? asString(payload['lounge_message_id'])
      const targetRole = asString(payload['target_role'])
      if (!messageId || !targetRole) {
        continue
      }
      const key = `${messageId}::${targetRole}`
      const prev = latestByKey.get(key)
      const rowTime = row.created_at ? new Date(row.created_at).getTime() : 0
      const prevTime = prev?.row.created_at ? new Date(prev.row.created_at).getTime() : -1
      if (!prev || rowTime >= prevTime) {
        latestByKey.set(key, { row, messageId, targetRole })
      }
    }

    const byMessage = new Map<string, LoungeReplyStatus[]>()
    for (const { row, messageId, targetRole } of latestByKey.values()) {
      const status = (row.status ?? '').toLowerCase()
      let phase: LoungeReplyStatusPhase | null = null
      if (DONE_STATUSES.has(status)) {
        // 完成：动画消失，真正的回复消息会通过 lounge_messages 实时出现。
        phase = null
      } else if (FAILED_STATUSES.has(status)) {
        phase = 'failed'
      } else if (PROCESSING_STATUSES.has(status) || status === '') {
        const startedMs = row.created_at ? new Date(row.created_at).getTime() : nowMs
        phase = nowMs - startedMs > TIMEOUT_MS ? 'timeout' : 'processing'
      }
      if (!phase) {
        continue
      }
      const list = byMessage.get(messageId) ?? []
      list.push({ commandId: row.id, sourceMessageId: messageId, targetRole, phase })
      byMessage.set(messageId, list)
    }
    return byMessage
  }, [rows, nowMs])
}
