import { useEffect, useMemo, useState } from 'react'

type SpeechBubbleOverlayProps = {
  segments: string[]
  anchorX: number
  anchorY: number
  variant?: 'npc' | 'player'
}

const MAX_VISIBLE_BUBBLES = 3
const STAGGER_DELAY_MS = 400

type BubbleItemProps = {
  text: string
  showTail: boolean
  staggerIndex: number
  variant: 'npc' | 'player'
}

const BubbleItem = ({ text, showTail, staggerIndex, variant }: BubbleItemProps) => {
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

  const bubbleClass = variant === 'player'
    ? 'speech-bubble speech-bubble--player'
    : 'speech-bubble'

  return (
    <div className="speech-bubble-stack__item" style={{ animationDelay: '0ms' }}>
      <div className={bubbleClass}>
        <span className="speech-bubble__text">{text}</span>
      </div>
      {showTail ? <div className="speech-bubble__tail" aria-hidden="true" /> : null}
    </div>
  )
}

const SpeechBubbleStack = ({
  segments,
  variant,
}: {
  segments: string[]
  variant: 'npc' | 'player'
}) => {
  // Cap visible bubbles
  const visibleSegments = segments.length > MAX_VISIBLE_BUBBLES
    ? segments.slice(segments.length - MAX_VISIBLE_BUBBLES)
    : segments

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
          variant={variant}
        />
      ))}
    </div>
  )
}

const SpeechBubbleOverlay = ({
  segments,
  anchorX,
  anchorY,
  variant = 'npc',
}: SpeechBubbleOverlayProps) => {
  const sequenceKey = useMemo(() => segments.join('\n'), [segments])

  if (segments.length === 0) {
    return null
  }

  const ariaLabel = variant === 'player' ? '串串的消息' : 'Syzygy 的回复'

  return (
    <div
      className="speech-bubble-overlay"
      style={{
        left: `${anchorX}px`,
        top: `${anchorY}px`,
      }}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <SpeechBubbleStack
        key={sequenceKey}
        segments={segments}
        variant={variant}
      />
    </div>
  )
}

export default SpeechBubbleOverlay
