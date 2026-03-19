import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { EventBus, GAME_EVENTS, type OpenNpcActionsPayload, type SyzygyPositionPayload, type PlayerPositionPayload } from "./EventBus";
import GameHud from "./ui/GameHud";
import GameMenuOverlay, { type GameFeatureId } from "./ui/GameMenuOverlay";
import GameSettingsOverlay from "./ui/GameSettingsOverlay";
import GameFeatureShell from "./ui/GameFeatureShell";
import SpeechBubbleOverlay from "./ui/SpeechBubbleOverlay";
import SnacksPage from "../pages/SnacksPage";
import SyzygyFeedPage from "../pages/SyzygyFeedPage";
import CheckinPage from "../pages/CheckinPage";
import ExportPage from "../pages/ExportPage";
import { supabase } from "../supabase/client";
import { parseBubbleReply } from "./utils/parseBubbleReply";
import { persistBubbleMessage, resolveTodaySession, invalidateSessionCache } from "./utils/bubbleChatHistory";
import { fetchBubbleMessages } from "../storage/supabaseSync";
import BubbleChatHistoryModal from "./ui/BubbleChatHistoryModal";
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

type BubbleChatConfig = {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
};

type GameModeShellProps = {
  onSwitchToPhoneMode: () => void;
  onOpenSharedSettings: () => void;
  onOpenChat: (npcId: OpenNpcActionsPayload["npcId"]) => void;
  user: User | null;
  snackAiConfig: SharedSnackAiConfig;
  syzygyAiConfig: SharedSnackAiConfig;
  bubbleChatConfig: BubbleChatConfig;
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
  bubbleChatConfig,
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

  // Bubble chat state
  const [isBubbleHistoryOpen, setIsBubbleHistoryOpen] = useState(false);
  const [bubbleSending, setBubbleSending] = useState(false);
  const [bubbleSegments, setBubbleSegments] = useState<string[]>([]);
  const [playerBubbleText, setPlayerBubbleText] = useState<string | null>(null);
  const [syzygyPos, setSyzygyPos] = useState<SyzygyPositionPayload | null>(null);
  const [playerPos, setPlayerPos] = useState<PlayerPositionPayload | null>(null);
  const bubbleChatHistoryRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const bubbleSessionRestoredRef = useRef(false);
  const sceneBubblesVisibleRef = useRef(false);

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

  const handleSyzygyPositionUpdate = useCallback((pos: SyzygyPositionPayload) => {
    setSyzygyPos(pos);
  }, []);

  const handlePlayerPositionUpdate = useCallback((pos: PlayerPositionPayload) => {
    setPlayerPos(pos);
  }, []);

  // Restore persisted bubble chat history on mount
  useEffect(() => {
    if (bubbleSessionRestoredRef.current || !user || !supabase) {
      return;
    }
    bubbleSessionRestoredRef.current = true;
    invalidateSessionCache();

    const restore = async () => {
      try {
        const session = await resolveTodaySession();
        const messages = await fetchBubbleMessages(session.id);
        if (messages.length > 0) {
          bubbleChatHistoryRef.current = messages
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content }));
        }
      } catch (error) {
        console.warn('[bubble-chat] Failed to restore history:', error);
      }
    };
    restore();
  }, [user]);

  const handleBubbleSend = useCallback(async (text: string) => {
    if (bubbleSending || !user || !supabase) {
      return;
    }
    setBubbleSending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        return;
      }
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      if (!anonKey) {
        return;
      }

      bubbleChatHistoryRef.current = [
        ...bubbleChatHistoryRef.current.slice(-10),
        { role: 'user' as const, content: text },
      ];

      // Show player bubble immediately
      setPlayerBubbleText(text);
      sceneBubblesVisibleRef.current = true;

      try {
        await persistBubbleMessage('user', text);
      } catch (error) {
        console.warn('[bubble-chat] Failed to persist user message:', error);
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/openrouter-chat`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: bubbleChatConfig.model,
            modelId: bubbleChatConfig.model,
            module: 'bubble-chat',
            messages: [
              { role: 'system', content: bubbleChatConfig.systemPrompt },
              ...bubbleChatHistoryRef.current,
            ],
            temperature: bubbleChatConfig.temperature,
            max_tokens: bubbleChatConfig.maxTokens,
            stream: false,
          }),
        },
      );

      if (!response.ok) {
        console.warn('Bubble chat request failed', response.status);
        return;
      }

      const payload = await response.json();
      const choice = payload?.choices?.[0];
      const message = choice?.message ?? choice ?? {};
      const content = typeof message?.content === 'string' ? message.content : '';

      if (content) {
        bubbleChatHistoryRef.current = [
          ...bubbleChatHistoryRef.current,
          { role: 'assistant' as const, content },
        ];

        try {
          await persistBubbleMessage('assistant', content);
        } catch (error) {
          console.warn('[bubble-chat] Failed to persist assistant message:', error);
        }

        const segments = parseBubbleReply(content);
        if (segments.length > 0) {
          setBubbleSegments(segments);
          sceneBubblesVisibleRef.current = true;
        }
      }
    } catch (error) {
      console.warn('Bubble chat error', error);
    } finally {
      setBubbleSending(false);
    }
  }, [bubbleSending, user, bubbleChatConfig]);

  const handleBubbleDismiss = useCallback(() => {
    setBubbleSegments([]);
    setPlayerBubbleText(null);
    sceneBubblesVisibleRef.current = false;
  }, []);

  useEffect(() => {
    EventBus.on(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions);
    EventBus.on(GAME_EVENTS.SYZYGY_POSITION_UPDATE, handleSyzygyPositionUpdate);
    EventBus.on(GAME_EVENTS.PLAYER_POSITION_UPDATE, handlePlayerPositionUpdate);

    return () => {
      EventBus.off(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions);
      EventBus.off(GAME_EVENTS.SYZYGY_POSITION_UPDATE, handleSyzygyPositionUpdate);
      EventBus.off(GAME_EVENTS.PLAYER_POSITION_UPDATE, handlePlayerPositionUpdate);
    };
  }, [handleOpenNpcActions, handleSyzygyPositionUpdate, handlePlayerPositionUpdate]);

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

  // Click-away dismissal for scene bubbles
  useEffect(() => {
    if (!sceneBubblesVisibleRef.current) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        handleBubbleDismiss();
        return;
      }

      // Don't dismiss when interacting with the bubble input bar
      if (target.closest('.game-bubble-input-bar')) {
        return;
      }

      // Don't dismiss when interacting with the speech bubbles themselves
      if (target.closest('.speech-bubble-overlay')) {
        return;
      }

      handleBubbleDismiss();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [handleBubbleDismiss, playerBubbleText, bubbleSegments]);

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
          onBubbleSend={handleBubbleSend}
          onOpenBubbleHistory={() => setIsBubbleHistoryOpen(true)}
          bubbleSending={bubbleSending}
        />

        {playerBubbleText && playerPos ? (
          <SpeechBubbleOverlay
            segments={[playerBubbleText]}
            anchorX={playerPos.x}
            anchorY={playerPos.y}
            onDismiss={handleBubbleDismiss}
            variant="player"
          />
        ) : null}

        {bubbleSegments.length > 0 && syzygyPos ? (
          <SpeechBubbleOverlay
            segments={bubbleSegments}
            anchorX={syzygyPos.x}
            anchorY={syzygyPos.y}
            onDismiss={handleBubbleDismiss}
            variant="npc"
          />
        ) : null}

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

        {isBubbleHistoryOpen ? (
          <BubbleChatHistoryModal
            onClose={() => setIsBubbleHistoryOpen(false)}
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
