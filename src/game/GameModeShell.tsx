import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { EventBus, GAME_EVENTS, type OpenNpcActionsPayload } from "./EventBus";
import GameHud from "./ui/GameHud";
import GameMenuOverlay, { type GameFeatureId } from "./ui/GameMenuOverlay";
import GameSettingsOverlay from "./ui/GameSettingsOverlay";
import GameFeatureShell from "./ui/GameFeatureShell";
import SnacksPage from "../pages/SnacksPage";
import SyzygyFeedPage from "../pages/SyzygyFeedPage";
import CheckinPage from "../pages/CheckinPage";
import ExportPage from "../pages/ExportPage";
import "./gameHud.css";

type SharedSnackAiConfig = {
  model: string;
  reasoning: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  systemPrompt: string;
  snackSystemOverlay: string;
  syzygyPostSystemPrompt: string;
  syzygyReplySystemPrompt: string;
};

type GameModeShellProps = {
  onSwitchToPhoneMode: () => void;
  onOpenSharedSettings: () => void;
  onOpenChat: (npcId: OpenNpcActionsPayload["npcId"]) => void;
  user: User | null;
  snackAiConfig: SharedSnackAiConfig;
  syzygyAiConfig: SharedSnackAiConfig;
};

type ActiveNpcMenu = OpenNpcActionsPayload;

const GAME_FEATURE_META: Record<
  GameFeatureId,
  { title: string; subtitle: string }
> = {
  snacks: { title: "零食罐罐区", subtitle: "游戏模式面板 · 零食管理与投喂" },
  syzygy: { title: "仓鼠观察日志", subtitle: "游戏模式面板 · 观察记录" },
  checkin: { title: "打卡", subtitle: "游戏模式面板 · 每日陪伴打卡" },
  export: { title: "数据导出", subtitle: "游戏模式面板 · 导出数据包" },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const NPC_MENU_LAYOUT = {
  width: 176,
  estimatedHeight: 170,
  anchorOffset: 18,
  edgePadding: 12,
} as const;

const GameModeShell = ({
  onSwitchToPhoneMode,
  onOpenSharedSettings,
  onOpenChat,
  user,
  snackAiConfig,
  syzygyAiConfig,
}: GameModeShellProps) => {
  const [activeNpcMenu, setActiveNpcMenu] = useState<ActiveNpcMenu | null>(
    null,
  );
  const [isPawMenuOpen, setIsPawMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState<GameFeatureId | null>(
    null,
  );
  const npcMenuRef = useRef<HTMLDivElement | null>(null);
  const [npcMenuSize, setNpcMenuSize] = useState<{
    width: number;
    height: number;
  }>({
    width: NPC_MENU_LAYOUT.width,
    height: NPC_MENU_LAYOUT.estimatedHeight,
  });

  const handleOpenNpcActions = useCallback((payload: OpenNpcActionsPayload) => {
    setActiveNpcMenu(payload);
  }, []);

  const handleCloseNpcActions = useCallback(() => {
    setActiveNpcMenu(null);
  }, []);

  const handleOpenChat = useCallback(() => {
    if (!activeNpcMenu) {
      return;
    }
    onOpenChat(activeNpcMenu.npcId);
    setActiveNpcMenu(null);
  }, [activeNpcMenu, onOpenChat]);

  const handleOpenFeature = useCallback((featureId: GameFeatureId) => {
    setIsPawMenuOpen(false);
    setActiveFeature(featureId);
  }, []);

  useEffect(() => {
    EventBus.on(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions);

    return () => {
      EventBus.off(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions);
    };
  }, [handleOpenNpcActions]);

  useEffect(() => {
    if (!activeNpcMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const menuElement = npcMenuRef.current;
      if (!menuElement) {
        return;
      }
      if (event.target instanceof Node && menuElement.contains(event.target)) {
        return;
      }
      setActiveNpcMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activeNpcMenu]);

  useLayoutEffect(() => {
    if (!activeNpcMenu) {
      return;
    }

    const menuElement = npcMenuRef.current;
    if (!menuElement) {
      return;
    }

    const rect = menuElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    setNpcMenuSize((prev) =>
      prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height },
    );
  }, [activeNpcMenu]);

  const npcMenuPosition = useMemo(() => {
    if (!activeNpcMenu) {
      return null;
    }

    const { edgePadding, anchorOffset } = NPC_MENU_LAYOUT;
    const menuWidth = npcMenuSize.width;
    const menuHeight = npcMenuSize.height;

    const candidatePositions = [
      {
        left: activeNpcMenu.anchor.x + anchorOffset,
        top: activeNpcMenu.anchor.y - menuHeight - anchorOffset,
      },
      {
        left: activeNpcMenu.anchor.x + anchorOffset,
        top: activeNpcMenu.anchor.y + anchorOffset,
      },
      {
        left: activeNpcMenu.anchor.x - menuWidth - anchorOffset,
        top: activeNpcMenu.anchor.y - menuHeight - anchorOffset,
      },
      {
        left: activeNpcMenu.anchor.x - menuWidth - anchorOffset,
        top: activeNpcMenu.anchor.y + anchorOffset,
      },
    ];

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const findBestPosition = () => {
      for (const position of candidatePositions) {
        const fitsHorizontally =
          position.left >= edgePadding &&
          position.left + menuWidth <= viewportWidth - edgePadding;
        const fitsVertically =
          position.top >= edgePadding &&
          position.top + menuHeight <= viewportHeight - edgePadding;
        if (fitsHorizontally && fitsVertically) {
          return position;
        }
      }

      return {
        left: clamp(
          activeNpcMenu.anchor.x + anchorOffset,
          edgePadding,
          viewportWidth - edgePadding - menuWidth,
        ),
        top: clamp(
          activeNpcMenu.anchor.y - menuHeight - anchorOffset,
          edgePadding,
          viewportHeight - edgePadding - menuHeight,
        ),
      };
    };

    const position = findBestPosition();

    return {
      left: `${position.left}px`,
      top: `${position.top}px`,
    };
  }, [activeNpcMenu, npcMenuSize.height, npcMenuSize.width]);

  const featureMeta = activeFeature ? GAME_FEATURE_META[activeFeature] : null;

  return (
    <div className="app-shell game-mode-shell">
      <div className="game-mode-container">
        <GameHud
          onOpenPawMenu={() => setIsPawMenuOpen((open) => !open)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {activeNpcMenu && npcMenuPosition ? (
          <div className="npc-actions-layer" role="presentation">
            <div
              ref={npcMenuRef}
              className="npc-actions-menu"
              role="dialog"
              aria-label="仓鼠互动菜单"
              style={npcMenuPosition}
            >
              <button
                type="button"
                className="npc-actions-menu__button npc-actions-menu__button--chat"
                onClick={handleOpenChat}
              >
                聊天
              </button>
              <button
                type="button"
                className="npc-actions-menu__button npc-actions-menu__button--close"
                onClick={handleCloseNpcActions}
              >
                关闭
              </button>
              <button
                type="button"
                className="npc-actions-menu__button npc-actions-menu__button--disabled"
                disabled
              >
                互动（即将开放）
              </button>
            </div>
          </div>
        ) : null}

        {isPawMenuOpen ? (
          <GameMenuOverlay
            onClose={() => setIsPawMenuOpen(false)}
            onOpenFeature={handleOpenFeature}
          />
        ) : null}

        {isSettingsOpen ? (
          <GameSettingsOverlay
            onClose={() => setIsSettingsOpen(false)}
            onSwitchToPhoneMode={onSwitchToPhoneMode}
            onOpenSharedSettings={onOpenSharedSettings}
          />
        ) : null}

        {activeFeature && featureMeta ? (
          <div className="game-feature-shell-backdrop">
            <GameFeatureShell
              title={featureMeta.title}
              subtitle={featureMeta.subtitle}
              onBackToGame={() => setActiveFeature(null)}
            >
              {activeFeature === "snacks" ? (
                <SnacksPage
                  user={user}
                  snackAiConfig={snackAiConfig}
                  entryMode="game"
                />
              ) : null}
              {activeFeature === "syzygy" ? (
                <SyzygyFeedPage
                  user={user}
                  snackAiConfig={syzygyAiConfig}
                  entryMode="game"
                />
              ) : null}
              {activeFeature === "checkin" ? (
                <CheckinPage user={user} entryMode="game" />
              ) : null}
              {activeFeature === "export" ? (
                <ExportPage user={user} entryMode="game" />
              ) : null}
            </GameFeatureShell>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default GameModeShell;
