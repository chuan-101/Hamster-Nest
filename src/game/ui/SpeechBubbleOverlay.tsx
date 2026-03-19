import { useEffect, useMemo, useState } from 'react'

type SpeechBubbleOverlayProps = {
  segments: string[]
  anchorX: number
  anchorY: number
  onDismiss: () => void
}

const BUBBLE_DISPLAY_MS = 4000
const BUBBLE_PER_CHAR_MS = 80
const MIN_DISPLAY_MS = 2500

const computeDisplayTime = (text: string) =>
  Math.max(MIN_DISPLAY_MS, BUBBLE_DISPLAY_MS + text.length * BUBBLE_PER_CHAR_MS)

const SpeechBubbleSequence = ({
  segments,
  onDismiss,
}: {
  segments: string[]
  onDismiss: () => void
}) => {
  const [visibleIndex, setVisibleIndex] = useState(0)

  useEffect(() => {
    if (segments.length === 0) {
      return
    }
    if (visibleIndex >= segments.length) {
      onDismiss()
      return
    }
    const duration = computeDisplayTime(segments[visibleIndex])
    const timer = window.setTimeout(() => {
      setVisibleIndex((i) => i + 1)
    }, duration)
    return () => window.clearTimeout(timer)
  }, [segments, visibleIndex, onDismiss])

  if (segments.length === 0 || visibleIndex >= segments.length) {
    return null
  }

  const currentText = segments[visibleIndex]

  return (
    <>
      <div className="speech-bubble">
        <span className="speech-bubble__text">{currentText}</span>
        {segments.length > 1 ? (
          <span className="speech-bubble__counter">
            {visibleIndex + 1}/{segments.length}
          </span>
        ) : null}
      </div>
      <div className="speech-bubble__tail" aria-hidden="true" />
    </>
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
      <SpeechBubbleSequence
        key={sequenceKey}
        segments={segments}
        onDismiss={onDismiss}
      />
    </div>
  )
}

export default SpeechBubbleOverlay
