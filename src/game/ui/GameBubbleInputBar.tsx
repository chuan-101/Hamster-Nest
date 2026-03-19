const GameBubbleInputBar = () => {
  return (
    <div className="game-bubble-input-bar" aria-label="气泡聊天输入栏">
      <button
        type="button"
        className="game-bubble-input-bar__history-button"
        aria-label="聊天历史记录"
      >
        🕐
      </button>

      <input
        type="text"
        className="game-bubble-input-bar__input"
        placeholder="跟 Syzygy 说点什么..."
        readOnly
        aria-label="气泡聊天输入框"
      />
    </div>
  )
}

export default GameBubbleInputBar
