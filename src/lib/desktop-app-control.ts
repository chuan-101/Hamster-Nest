export type DesktopControlRow = {
  id: string
  action: string
  status: string
  created_at: string | null
}

// A command receipt is not a live process heartbeat. Never gate open/quit on it.
export function desktopControlReceipt(row: DesktopControlRow | null): {
  tone: 'gray' | 'green' | 'yellow'
  label: string
} {
  if (!row) return { tone: 'gray', label: '尚无桌面 App 指令记录' }
  if (row.status === 'pending') return { tone: 'yellow', label: '最近指令：等待 Mini 执行' }
  if (row.status === 'executed') return {
    tone: 'green',
    label: row.action === 'wake' ? '最近打开指令已执行' : '最近关闭指令已执行',
  }
  return { tone: 'yellow', label: '最近指令失败或已过期' }
}

export async function waitForDesktopControl({
  id, read, signal, pause = abortablePause, attempts = 20,
}: {
  id: string
  read: (id: string) => Promise<DesktopControlRow | null>
  signal: AbortSignal
  pause?: (signal: AbortSignal) => Promise<void>
  attempts?: number
}): Promise<DesktopControlRow | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal.throwIfAborted()
    let row: DesktopControlRow | null = null
    try { row = await read(id) } catch { signal.throwIfAborted() }
    signal.throwIfAborted()
    if (row?.id === id && ['executed', 'failed'].includes(row.status)) return row
    if (attempt + 1 < attempts) await pause(signal)
  }
  return null
}

function abortablePause(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 1500)
    signal.addEventListener('abort', abort, { once: true })
  })
}
