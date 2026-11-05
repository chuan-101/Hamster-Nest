export type ModelToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export class ApiModelStream {
  buffer = ''
  content = ''
  model: string | null = null
  usage: Record<string, unknown> | null = null
  calls: ModelToolCall[] = []
  details: Record<string, unknown>[] = []
  finishReason = ''
  done = false
  push(chunk: string) {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) this.line(line)
  }
  finish() {
    if (this.buffer) this.line(this.buffer)
    this.buffer = ''
  }
  line(line: string) {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (data === '[DONE]') {
      this.done = true
      return
    }
    if (!data) return
    let payload
    try {
      payload = JSON.parse(data)
    } catch {
      throw new Error('模型回复格式不完整，请重试')
    }
    this.accept(payload)
  }
  accept(payload: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (payload.error) throw new Error('模型服务中断，请重试')
    if (typeof payload.model === 'string') this.model = payload.model
    if (payload.usage && typeof payload.usage === 'object') this.usage = payload.usage
    const choice = payload.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) this.finishReason = choice.finish_reason
    const delta = choice.delta ?? choice.message ?? {}
    if (typeof delta.content === 'string') this.content += delta.content
    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? this.calls.length
      if (!Number.isInteger(index) || index < 0 || index > 31) throw new Error('工具调用数量超限')
      const target = this.calls[index] ??
        { id: '', type: 'function', function: { name: '', arguments: '' } }
      if (call.id) target.id = call.id
      if (call.function?.name) target.function.name += call.function.name
      if (call.function?.arguments) target.function.arguments += call.function.arguments
      this.calls[index] = target
    }
    // OpenRouter requires reasoning_details to be replayed with tool-call messages.
    for (const detail of delta.reasoning_details ?? []) {
      const index = detail.index ?? this.details.length
      if (!Number.isInteger(index) || index < 0 || index > 1024) throw new Error('推理数据格式无效')
      const target = this.details[index] ?? {}
      for (const [key, value] of Object.entries(detail)) {
        if (['text', 'summary', 'data', 'signature'].includes(key) && typeof value === 'string') {
          target[key] = String(target[key] ?? '') + value
        } else target[key] = value
      }
      this.details[index] = target
    }
  }
  assistantMessage() {
    return {
      role: 'assistant',
      content: this.content || null,
      ...(this.calls.length ? { tool_calls: this.calls } : {}),
      ...(this.details.length ? { reasoning_details: this.details.filter(Boolean) } : {}),
    }
  }
}
