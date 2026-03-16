type GameSettingsOverlayProps = {
  onClose: () => void
  onSwitchToPhoneMode: () => void
  onOpenSharedSettings: () => void
}

const GameSettingsOverlay = ({ onClose, onSwitchToPhoneMode, onOpenSharedSettings }: GameSettingsOverlayProps) => {
  return (
    <div className="game-overlay-backdrop" role="presentation" onClick={onClose}>
      <section
        className="game-overlay-panel game-overlay-panel--narrow"
        role="dialog"
        aria-modal="true"
        aria-label="游戏设置"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="game-overlay-header">
          <h2 className="ui-title">游戏设置</h2>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        <p className="game-overlay-subtitle">这里仅包含游戏侧显示与操作偏好，不包含 AI / 模型 / Prompt 配置。</p>
        <div className="game-settings-stack">
          <button type="button" className="game-control-button" disabled aria-disabled="true">
            HUD 显示偏好（占位）
          </button>
          <button type="button" className="game-control-button" disabled aria-disabled="true">
            操作方式偏好（占位）
          </button>
          <button type="button" className="game-control-button" disabled aria-disabled="true">
            游戏音效开关（占位）
          </button>
          <div className="game-shared-settings-entry">
            <p>AI 与模型等通用设置请前往「通用设置」，此处不重复实现。</p>
            <button type="button" className="ghost" onClick={onOpenSharedSettings}>
              前往通用设置
            </button>
          </div>
          <button type="button" className="primary" onClick={onSwitchToPhoneMode}>
            返回手机模式
          </button>
        </div>
      </section>
    </div>
  )
}

export default GameSettingsOverlay
