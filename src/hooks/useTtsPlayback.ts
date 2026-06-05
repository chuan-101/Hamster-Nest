import { useCallback, useEffect, useRef, useState } from 'react'

const TTS_GENERATE_ENDPOINT = 'https://crfhiumxzmaszkapanrb.supabase.co/functions/v1/tts-generate'
export const TTS_TEXT_LIMIT = 2000

export type TtsPlaybackState = 'loading' | 'playing'

type CachedTtsAudio = {
  audio: HTMLAudioElement
  objectUrl: string
}

export const useTtsPlayback = () => {
  const [ttsStates, setTtsStates] = useState<Record<string, TtsPlaybackState>>({})
  const ttsCacheRef = useRef<Map<string, CachedTtsAudio>>(new Map())
  const activeTtsRef = useRef<{ id: string; audio: HTMLAudioElement } | null>(null)
  const pendingTtsRef = useRef<{ id: string; controller: AbortController } | null>(null)

  const setTtsState = useCallback((id: string, state: TtsPlaybackState | null) => {
    setTtsStates((current) => {
      const next = { ...current }
      if (state) {
        next[id] = state
      } else {
        delete next[id]
      }
      return next
    })
  }, [])

  const resetActiveTts = useCallback((exceptId?: string) => {
    const current = activeTtsRef.current
    if (!current || current.id === exceptId) {
      return
    }

    current.audio.pause()
    current.audio.currentTime = 0
    setTtsState(current.id, null)
    activeTtsRef.current = null
  }, [setTtsState])

  const abortPendingTts = useCallback(() => {
    const pendingTts = pendingTtsRef.current
    if (!pendingTts) {
      return
    }

    pendingTts.controller.abort()
    setTtsState(pendingTts.id, null)
    pendingTtsRef.current = null
  }, [setTtsState])

  const handleTtsClick = useCallback(async (id: string, content: string) => {
    const text = content.trim()
    if (!text || text.length > TTS_TEXT_LIMIT || ttsStates[id] === 'loading') {
      return
    }

    const active = activeTtsRef.current
    if (active?.id === id) {
      if (active.audio.paused) {
        try {
          await active.audio.play()
          setTtsState(id, 'playing')
        } catch (playError) {
          console.warn('TTS 播放失败', playError)
          setTtsState(id, null)
        }
      } else {
        active.audio.pause()
        setTtsState(id, null)
      }
      return
    }

    abortPendingTts()
    resetActiveTts()

    const cached = ttsCacheRef.current.get(id)
    if (cached) {
      cached.audio.currentTime = 0
      activeTtsRef.current = { id, audio: cached.audio }
      try {
        await cached.audio.play()
        setTtsState(id, 'playing')
      } catch (playError) {
        console.warn('TTS 播放失败', playError)
        activeTtsRef.current = null
        setTtsState(id, null)
      }
      return
    }

    const controller = new AbortController()
    pendingTtsRef.current = { id, controller }
    setTtsState(id, 'loading')

    try {
      const response = await fetch(TTS_GENERATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error('TTS generation failed')
      }

      const blob = await response.blob()
      if (controller.signal.aborted) {
        return
      }

      const objectUrl = URL.createObjectURL(blob)
      const audio = new Audio(objectUrl)
      audio.onended = () => {
        if (activeTtsRef.current?.id === id) {
          activeTtsRef.current = null
        }
        setTtsState(id, null)
      }
      audio.onerror = () => {
        if (activeTtsRef.current?.id === id) {
          activeTtsRef.current = null
        }
        setTtsState(id, null)
      }

      ttsCacheRef.current.set(id, { audio, objectUrl })
      activeTtsRef.current = { id, audio }
      await audio.play()
      setTtsState(id, 'playing')
    } catch (ttsError) {
      if (!controller.signal.aborted) {
        console.warn('TTS 生成失败', ttsError)
        setTtsState(id, null)
      }
    } finally {
      if (pendingTtsRef.current?.controller === controller) {
        pendingTtsRef.current = null
      }
    }
  }, [abortPendingTts, resetActiveTts, setTtsState, ttsStates])

  useEffect(() => {
    const ttsCache = ttsCacheRef.current

    return () => {
      pendingTtsRef.current?.controller.abort()
      activeTtsRef.current?.audio.pause()
      ttsCache.forEach(({ audio, objectUrl }) => {
        audio.pause()
        URL.revokeObjectURL(objectUrl)
      })
      ttsCache.clear()
      activeTtsRef.current = null
      pendingTtsRef.current = null
    }
  }, [])

  return {
    handleTtsClick,
    ttsStates,
    ttsTextLimit: TTS_TEXT_LIMIT,
  }
}
