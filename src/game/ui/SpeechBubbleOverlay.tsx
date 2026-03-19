import { useEffect, useMemo, useRef, useState } from 'react'

type SpeechBubbleOverlayProps = {
  segments: string[]
  anchorX: number
  anchorY: number
  onDismiss: () => void
}

const BUBBLE_DISPLAY_MS = 4000
const BUBBLE_PER_CHAR_MS = 80
const MIN_DISPLAY_MS = 2500
const MAX_VISIBLE_BUBBLES = 3
const STAGGER_DELAY_MS = 400

const computeDisplayTime = (text: string) =>
  Math.max(MIN_DISPLAY_MS, BUBBLE_DISPLAY_MS + text.length * BUBBLE_PER_CHAR_MS)

type BubbleItemProps = {
  text: string
  showTail: boolean
  staggerIndex: number
}

const BubbleItem = ({ text, showTail, staggerIndex }: BubbleItemProps) => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(true)
    }, staggerIndex * STAGGER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [staggerIndex])

  if (!visible) {
    return null
  }

  return (
    <div className="speech-bubble-stack__item" style={{ animationDelay: '0ms' }}>
      <div className="speech-bubble">
        <span className="speech-bubble__text">{text}</span>
      </div>
      {showTail ? <div className="speech-bubble__tail" aria-hidden="true" /> : null}
    </div>
  )
}

const SpeechBubbleStack = ({
  segments,
  onDismiss,
}: {
  segments: string[]
  onDismiss: () => void
}) => {
  const dismissTimerRef = useRef<number | null>(null)

  // Cap visible bubbles
  const visibleSegments = segments.length > MAX_VISIBLE_BUBBLES
    ? segments.slice(segments.length - MAX_VISIBLE_BUBBLES)
    : segments

  useEffect(() => {
    if (segments.length === 0) {
      return
    }

    // Calculate total time: stagger delays + last bubble display time
    const lastIndex = visibleSegments.length - 1
    const staggerTotal = lastIndex * STAGGER_DELAY_MS
    const lastBubbleTime = computeDisplayTime(visibleSegments[lastIndex])
    const totalTime = staggerTotal + lastBubbleTime

    dismissTimerRef.current = window.setTimeout(() => {
      onDismiss()
    }, totalTime)

    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current)
      }
    }
  }, [segments, visibleSegments, onDismiss])

  if (segments.length === 0) {
    return null
  }

  return (
    <div className="speech-bubble-stack">
      {visibleSegments.map((text, index) => (
        <BubbleItem
          key={`${index}-${text}`}
          text={text}
          showTail={index === visibleSegments.length - 1}
          staggerIndex={index}
        />
      ))}
    </div>
  )
}

const SpeechBubbleOverlay = ({
  segments,
  anchorX,
  anchorY,
  onDismiss,
}: SpeechBubbleOverlayProps) => {
  const sequenceKey = useMemo(() => segments.join('\n'), [segments])

  if (segments.length === 0) {
    return null
  }

  return (
    <div
      className="speech-bubble-overlay"
      style={{
        left: `${anchorX}px`,
        top: `${anchorY}px`,
      }}
      role="status"
      aria-live="polite"
      aria-label="Syzygy 的回复"
    >
      <SpeechBubbleStack
        key={sequenceKey}
        segments={segments}
        onDismiss={onDismiss}
      />
    </div>
  )
}

export default SpeechBubbleOverlay
