import { z } from 'npm:zod@^4.1.13'
import { serveMcp, supabase } from '../_shared/mcp_common.ts'

const TTS_DEFAULTS = {
  model_id: 'eleven_multilingual_v2',
  speed: 0.85,
  voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.20, use_speaker_boost: true },
}

async function parseMcpResponse(res: Response) {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/event-stream')) {
    const text = await res.text()
    const results: unknown[] = []
    for (const event of text.split('\n\n').filter(Boolean)) {
      const d = event.split('\n').find((l: string) => l.startsWith('data: '))
      if (d) {
        try {
          results.push(JSON.parse(d.slice(6)))
        } catch {
          // Skip malformed server-sent events from third-party MCP endpoints.
        }
      }
    }
    return results.length === 1 ? results[0] : results
  }
  return await res.json()
}

async function proxyMcpCall(
  endpoint: string,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  serviceName = 'MCP',
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const initRes = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'hamster-nest', version: '5.6.0' },
      },
    }),
  })
  if (!initRes.ok) throw new Error(`${serviceName} initialize failed (${initRes.status}): ${await initRes.text()}`)
  const sessionId = initRes.headers.get('mcp-session-id')
  await parseMcpResponse(initRes)

  const sessionHeaders = { ...headers }
  if (sessionId) sessionHeaders['mcp-session-id'] = sessionId
  await fetch(endpoint, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
  const callRes = await fetch(endpoint, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method, params }),
  })
  if (!callRes.ok) throw new Error(`${serviceName} call failed (${callRes.status}): ${await callRes.text()}`)
  return await parseMcpResponse(callRes)
}

const LUCKIN_ENDPOINT = 'https://gwmcp.lkcoffee.com/order/user/mcp'
const MCD_ENDPOINT = 'https://mcp.mcd.cn'
const AMAP_ENDPOINT_BASE = 'https://mcp.amap.com/mcp'

function luckinMcpCall(method: string, params: Record<string, unknown> = {}) {
  const token = Deno.env.get('LUCKIN_MCP_TOKEN')
  if (!token) throw new Error('LUCKIN_MCP_TOKEN not configured')
  return proxyMcpCall(LUCKIN_ENDPOINT, token, method, params, 'Luckin')
}

function mcdMcpCall(method: string, params: Record<string, unknown> = {}) {
  const token = Deno.env.get('MCD_MCP_TOKEN')
  if (!token) throw new Error('MCD_MCP_TOKEN not configured')
  return proxyMcpCall(MCD_ENDPOINT, token, method, params, "McDonald's")
}

function amapMcpCall(method: string, params: Record<string, unknown> = {}) {
  const key = Deno.env.get('AMAP_API_KEY')
  if (!key) throw new Error('AMAP_API_KEY not configured')
  return proxyMcpCall(`${AMAP_ENDPOINT_BASE}?key=${key}`, '', method, params, 'AMap')
}

serveMcp('hamster-life-mcp', (server) => {
  server.registerTool('generate_tts', {
    title: 'Generate TTS Audio',
    description: '调用 ElevenLabs 生成 Syzygy 语音，上传到 Supabase Storage，返回 7 天有效的签名音频 URL。',
    inputSchema: {
      text: z.string().describe('要转换为语音的文本，不超过2000字'),
      speed: z.number().optional().describe('语速，默认0.85'),
    },
  }, async ({ text, speed }) => {
    try {
      const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
      const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID')
      if (!apiKey || !voiceId) return { content: [{ type: 'text' as const, text: 'Error: ElevenLabs credentials not configured' }] }
      if (text.length > 2000) return { content: [{ type: 'text' as const, text: 'Error: Text exceeds 2000 character limit' }] }
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: TTS_DEFAULTS.model_id,
          voice_settings: TTS_DEFAULTS.voice_settings,
          speed: speed ?? TTS_DEFAULTS.speed,
        }),
      })
      if (!ttsRes.ok) return { content: [{ type: 'text' as const, text: `ElevenLabs error (${ttsRes.status}): ${await ttsRes.text()}` }] }
      const buf = await ttsRes.arrayBuffer()
      const fn = `syzygy-${new Date().toISOString().replace(/[:.]/g, '-')}.mp3`
      const { error: upErr } = await supabase.storage.from('tts-audio').upload(fn, buf, {
        contentType: 'audio/mpeg',
        upsert: false,
      })
      if (upErr) return { content: [{ type: 'text' as const, text: `Storage error: ${upErr.message}` }] }
      // The bucket is private (P1 · 1-4); links are shared into chats, so a
      // 7-day signed URL keeps them playable without a public bucket.
      const { data: signed, error: signErr } = await supabase.storage
        .from('tts-audio')
        .createSignedUrl(fn, 60 * 60 * 24 * 7)
      if (signErr || !signed) return { content: [{ type: 'text' as const, text: `Storage error: ${signErr?.message ?? 'signed url failed'}` }] }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'ok',
            audio_url: signed.signedUrl,
            filename: fn,
            text_length: text.length,
            speaker: 'Syzygy',
            voice: 'Syzygy-1',
          }, null, 2),
        }],
      }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }] }
    }
  })

  server.registerTool('luckin_list_tools', {
    title: 'List Luckin Coffee Tools',
    description: '列出瑞幸咖啡 MCP 提供的所有可用工具。不需要任何参数。',
    inputSchema: {},
  }, async () => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await luckinMcpCall('tools/list'), null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }] }
    }
  })

  server.registerTool('luckin_call', {
    title: 'Call Luckin Coffee Tool',
    description: '调用瑞幸咖啡 MCP 的具体工具。先用 luckin_list_tools 查看可用工具列表。',
    inputSchema: {
      tool_name: z.string().describe('工具名称'),
      arguments: z.record(z.unknown()).optional().describe('参数'),
    },
  }, async ({ tool_name, arguments: args }) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await luckinMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }] }
    }
  })

  server.registerTool('mcd_list_tools', {
    title: "List McDonald's Tools",
    description: '列出麦当劳 MCP 提供的所有可用工具。不需要任何参数。',
    inputSchema: {},
  }, async () => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await mcdMcpCall('tools/list'), null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }] }
    }
  })

  server.registerTool('mcd_call', {
    title: "Call McDonald's Tool",
    description: '调用麦当劳 MCP 的具体工具。先用 mcd_list_tools 查看可用工具列表。',
    inputSchema: {
      tool_name: z.string().describe('工具名称'),
      arguments: z.record(z.unknown()).optional().describe('参数'),
    },
  }, async ({ tool_name, arguments: args }) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await mcdMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }] }
    }
  })

  server.registerTool('amap_list_tools', {
    title: 'List AMap Tools',
    description: '列出高德地图 MCP 提供的所有可用工具（地理编码、天气、路径规划、周边搜索、打车、导航等）。不需要任何参数。',
    inputSchema: {},
  }, async () => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await amapMcpCall('tools/list'), null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }] }
    }
  })

  server.registerTool('amap_call', {
    title: 'Call AMap Tool',
    description: '调用高德地图 MCP 的具体工具。先用 amap_list_tools 查看可用工具列表。',
    inputSchema: {
      tool_name: z.string().describe('工具名称'),
      arguments: z.record(z.unknown()).optional().describe('参数'),
    },
  }, async ({ tool_name, arguments: args }) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await amapMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }] }
    }
  })
})
