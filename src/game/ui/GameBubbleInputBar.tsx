import { useState, type FormEvent, type KeyboardEvent } from 'react'

type GameBubbleInputBarProps = {
  onSend: (text: string) => void
  onOpenHistory: () => void
  disabled?: boolean
}

const GameBubbleInputBar = ({ onSend, onOpenHistory, disabled }: GameBubbleInputBarProps) => {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const trimmed = draft.trim()
    if (!trimmed || disabled) {
      return
    }
    onSend(trimmed)
    setDraft('')
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="game-bubble-input-bar"
      aria-label="气泡聊天输入栏"
      onSubmit={handleSubmit}
    >
      <div className="game-bubble-input-bar__main-input">
        <input
          type="text"
          className="game-bubble-input-bar__input"
          placeholder="跟 Syzygy 说点什么..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="气泡聊天输入框"
        />
      </div>

      <div className="game-bubble-input-bar__mini-stack" aria-label="聊天快捷操作">
        <button
          type="button"
          className="game-bubble-input-bar__history-button"
          aria-label="聊天历史记录"
          onClick={onOpenHistory}
        >
          录
        </button>

        <button
          type="submit"
          className="game-bubble-input-bar__send-button"
          disabled={disabled || !draft.trim()}
          aria-label="发送消息"
        >
          {disabled ? '…' : '发'}
        </button>
      </div>
    </form>
  )
}

export default GameBubbleInputBar
