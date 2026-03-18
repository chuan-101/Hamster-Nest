import GameSystemModal from './GameSystemModal'

type GameSettingsOverlayProps = {
  onClose: () => void
  onSwitchToPhoneMode: () => void
  onOpenSharedSettings: () => void
}

const GameSettingsOverlay = ({ onClose, onSwitchToPhoneMode, onOpenSharedSettings }: GameSettingsOverlayProps) => {
  const placeholderSettings = ['HUD 显示偏好（占位）', '操作方式偏好（占位）', '游戏音效开关（占位）']

  return (
    <GameSystemModal
      title="游戏设置"
      ariaLabel="游戏设置"
      subtitle="这里仅包含游戏侧显示与操作偏好，不包含 AI / 模型 / Prompt 配置。"
      onClose={onClose}
      contentClassName="game-system-modal__content--settings"
      footer={
        <>
          <button type="button" className="game-settings-action game-settings-action--secondary" onClick={onClose}>
            关闭面板
          </button>
          <button type="button" className="game-settings-action game-settings-action--primary" onClick={onSwitchToPhoneMode}>
            返回手机模式
          </button>
        </>
      }
    >
      <div className="game-system-modal__content-shell game-settings-layout">
        <section className="game-settings-section" aria-label="游戏侧设置">
          <p className="game-settings-section__title">游戏侧设置（占位）</p>
          <div className="game-settings-placeholder-list">
            {placeholderSettings.map((setting) => (
              <div key={setting} className="game-settings-placeholder-item" role="presentation">
                <span>{setting}</span>
                <span className="game-settings-placeholder-item__badge">未开放</span>
              </div>
            ))}
          </div>
        </section>

        <section className="game-settings-section game-settings-section--shared" aria-label="通用设置说明">
          <p className="game-settings-section__title">通用设置说明</p>
          <p className="game-shared-settings-entry__text">AI、模型与 Prompt 相关配置继续维护在「通用设置」，本面板不做重复实现。</p>
          <button type="button" className="game-settings-action game-settings-action--secondary" onClick={onOpenSharedSettings}>
            前往通用设置
          </button>
        </section>
      </div>
    </GameSystemModal>
  )
}

export default GameSettingsOverlay
