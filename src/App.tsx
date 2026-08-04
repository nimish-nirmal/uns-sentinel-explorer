import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Loader2, Pause, Play, BookOpen, Github, AlertTriangle, X, Sun, Moon, Radar } from 'lucide-react';
import type { BrokerConfig, Session, SessionStatus, UNSTreeNode, SavedBroker } from './types';
import { MqttEngine, type MessageBatch, decodePayload, generateSessionId } from './engine/mqttEngine';
import { startSimulator, type SimulatorControl } from './engine/simulator';
import { upsertTopicNode, findNodeByPath, cloneTree } from './engine/topicTree';
import { loadSavedBrokers, upsertSavedBroker, deleteSavedBroker } from './lib/storage';
import { SessionBar } from './components/SessionBar';
import { TopicTree } from './components/TopicTree';
import { PayloadViewer } from './components/PayloadViewer';
import { HealthPanel } from './components/HealthPanel';
import { BrokerConfigModal } from './components/modals/BrokerConfigModal';
import { SavedBrokersList } from './components/modals/SavedBrokersList';
import { PublishModal } from './components/modals/PublishModal';
import { ActiveSessionsModal } from './components/modals/ActiveSessionsModal';

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [savedBrokers, setSavedBrokers] = useState<SavedBroker[]>([]);
  const [showBrokerModal, setShowBrokerModal] = useState(false);
  const [editingBroker, setEditingBroker] = useState<BrokerConfig | null>(null);
  const [showSavedBrokers, setShowSavedBrokers] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showActiveSessionsModal, setShowActiveSessionsModal] = useState(false);
  const [publishTopic, setPublishTopic] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<UNSTreeNode | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [selectedTelemetryKeys, setSelectedTelemetryKeys] = useState<Set<string>>(new Set());
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [showSplash, setShowSplash] = useState(true);

  const engineRef = useRef<MqttEngine | null>(null);
  const simControlRef = useRef<SimulatorControl | null>(null);
  const isSimulatingRef = useRef(false);
  const toggleSimulatorRef = useRef<() => void>(() => {});
  const [isPaused, setIsPaused] = useState(false);
  const connectingRef = useRef<Set<string>>(new Set());
  const sessionsRef = useRef<Session[]>([]);
  /** Tracks whether the user has ever used Backend Gateway mode (needs the Node.js server) */
  const gatewayModeUsedRef = useRef(false);

  const applyMessageBatch = useCallback((sessionId: string, batch: MessageBatch[]) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.config.id !== sessionId) return session;
        const now = Date.now();
        // Clone the tree before updating to ensure React detects the change
        const updatedTree = cloneTree(session.tree);
        for (const msg of batch) {
          const decoded = decodePayload(msg.payload);
          upsertTopicNode(updatedTree, msg.topic, decoded.value, decoded.raw, msg.retained, now);
        }
        // Return new session object with cloned tree
        return { ...session, tree: updatedTree };
      })
    );
    setSelectedNode((prev) => {
      if (!prev) return prev;
      const session = sessions.find((s) => s.config.id === sessionId);
      if (!session) return prev;
      return findNodeByPath(session.tree, prev.path) ?? prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatus = useCallback((sessionId: string, status: SessionStatus, message?: string) => {
    setSessions((prev) => {
      const session = prev.find((s) => s.config.id === sessionId);
      // Clear connecting flag when connection succeeds or fails
      if (session && (status === 'connected' || status === 'error')) {
        connectingRef.current.delete(sessionId);
      }
      return prev.map((s) => (s.config.id === sessionId ? { ...s, status, statusMessage: message ?? s.statusMessage } : s));
    });
  }, []);

  const handleStatsTick = useCallback((sessionId: string, stats: Session['stats']) => {
    setSessions((prev) => prev.map((s) => (s.config.id === sessionId ? { ...s, stats: { ...stats } } : s)));
  }, []);

  useEffect(() => {
    const engine = new MqttEngine({
      onBatch: applyMessageBatch,
      onStatus: handleStatus,
      onStatsTick: handleStatsTick,
      // When the backend gateway is unreachable (e.g. static GitHub Pages demo),
      // automatically launch the Demo Simulator so the app is fully functional.
      // IMPORTANT: This only applies to Backend Gateway mode. Direct Browser
      // connections don't need the gateway, so the warning is suppressed when
      // the user has only used browser-mode sessions.
      onGatewayStatus: (connected) => {
        setGatewayConnected(connected);
      },
      onGatewayUnavailable: () => {
        // Direct Browser connections don't need the gateway. If there are active
        // browser sessions (or only browser mode was ever used), the gateway
        // being down is irrelevant — do NOT show the warning or auto-launch the
        // simulator (which would wipe the active browser sessions).
        const hasActiveSessions = sessionsRef.current.length > 0;
        if (!gatewayModeUsedRef.current || hasActiveSessions) {
          console.log('[App] Gateway unavailable, suppressing warning (no gateway sessions in use).');
          return;
        }
        console.log('[App] Gateway unavailable — auto-launching Demo Simulator');
        // Show warning popup
        setShowGatewayWarning(true);
        // Use a small delay to let the engine settle before starting the simulator
        setTimeout(() => {
          if (!isSimulatingRef.current) {
            toggleSimulatorRef.current();
          }
        }, 100);
      },
    });
    engineRef.current = engine;
    setSavedBrokers(loadSavedBrokers());
    
    // Stop MQTT reconnection when tab closes
    const handleBeforeUnload = () => {
      engine.destroy();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      engine.destroy();
      if (simControlRef.current) simControlRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = useCallback((config: BrokerConfig, save: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    
    // Prevent duplicate connections
    if (connectingRef.current.has(config.id)) {
      console.log(`[App] Already connecting to ${config.id}, skipping duplicate`);
      return;
    }
    
    // Always save to localStorage if requested
    if (save) setSavedBrokers(upsertSavedBroker({ ...config, savedAt: Date.now() }));
    
    // Mark as connecting
    connectingRef.current.add(config.id);
    
    // Track whether the user is using Backend Gateway mode — the gateway
    // unavailable fallback only applies to gateway-mode connections.
    if (config.connectionMode === 'gateway') {
      gatewayModeUsedRef.current = true;
    }
    
    // Destroy any existing session with the same ID (supports "Update & Reconnect").
    // This MUST run outside the state updater — React StrictMode double-invokes
    // updaters in development, and calling createSession/destroySession inside a
    // setSessions updater caused duplicate MQTT connections to the same broker.
    const existingSession = sessionsRef.current.find((s) => s.config.id === config.id);
    if (existingSession) {
      engine.destroySession(config.id);
    }
    
    // Create the engine session outside the state updater so it runs exactly
    // once per click (event handlers are not double-invoked by StrictMode).
    const session = engine.createSession(config);
    
    setSessions((prev) => {
      // Pure updater — no side effects — safe under React StrictMode.
      const idx = prev.findIndex((s) => s.config.id === config.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = session;
        return next;
      }
      return [...prev, session];
    });
    setActiveSessionId(config.id);
    
    // Clear connecting flag after a short delay to allow the connection to start
    setTimeout(() => {
      connectingRef.current.delete(config.id);
    }, 500);
  }, []);

  const handleRemoveSession = useCallback((sessionId: string) => {
    engineRef.current?.destroySession(sessionId);
    setSessions((prev) => {
      const next = prev.filter((s) => s.config.id !== sessionId);
      if (activeSessionId === sessionId) setActiveSessionId(next[0]?.config.id ?? null);
      return next;
    });
    if (selectedPath) {
      setSelectedPath(null);
      setSelectedNode(null);
    }
  }, [activeSessionId, selectedPath]);

  const handleReconnect = useCallback((sessionId: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const fresh = engine.reconnect(sessionId);
    if (!fresh) return;
    setSessions((prev) => prev.map((session) => (session.config.id === sessionId ? fresh : session)));
    setActiveSessionId(sessionId);
  }, []);

  const handlePublish = useCallback(
    async (topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) => {
      const engine = engineRef.current;
      if (!engine || !activeSessionId) throw new Error('No active session');
      await engine.publish(activeSessionId, topic, payload, qos, retain);
    },
    [activeSessionId]
  );

  const toggleSimulator = useCallback(() => {
    if (isSimulating) {
      if (simControlRef.current) simControlRef.current.stop();
      simControlRef.current = null;
      setIsSimulating(false);
      isSimulatingRef.current = false;
      setIsPaused(false);
      return;
    }
    setSessions([]);
    setActiveSessionId(null);
    setSelectedPath(null);
    setSelectedNode(null);

    const simSessionId = generateSessionId();
    const simSession: Session = {
      config: {
        id: simSessionId,
        name: 'Simulator',
        host: 'demo',
        port: 0,
        protocol: 'ws',
        clientId: 'simulator',
        subscriptions: [],
      },
      status: 'connected',
      statusMessage: 'Simulated telemetry stream',
      tree: {
        id: 'root',
        name: 'UNS Namespace',
        path: '',
        type: 'legacy',
        children: new Map(),
        isLeaf: false,
      },
      mqttClient: null,
      stats: { messagesReceived: 0, messagesPerSecond: 0, bytesReceived: 0, throughputHistory: [] },
      activeSubscriptions: [],
      paused: false,
    };
    setSessions([simSession]);
    setActiveSessionId(simSessionId);

    simControlRef.current = startSimulator(
      [
        { pattern: 'Enterprise/Site1/Area1/Line1/Cell1/#', qos: 0 },
        { pattern: 'legacy/sensors/+/temp', qos: 0 },
        { pattern: 'legacy/sensors/+/pressure', qos: 0 },
        { pattern: '$SYS/#', qos: 0 },
      ],
      (msg) => {
        applyMessageBatch(simSessionId, [
          { topic: msg.topic, payload: msg.payload, retained: msg.retain, qos: msg.qos, arriveTime: Date.now() },
        ]);
      },
      1500
    );
    setIsSimulating(true);
    isSimulatingRef.current = true;
  }, [isSimulating, applyMessageBatch]);

  // Keep refs in sync for the gateway-unavailable auto-fallback
  useEffect(() => {
    toggleSimulatorRef.current = toggleSimulator;
  }, [toggleSimulator]);

  // Splash screen: show project description for 5 seconds, then
  // auto-open the Saved Brokers list so the user can pick a broker.
  useEffect(() => {
    if (!showSplash) return;
    const timer = setTimeout(() => {
      setShowSplash(false);
      setShowSavedBrokers(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [showSplash]);

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;

      // Pause/resume the simulator if it's running
      if (simControlRef.current) {
        if (next) simControlRef.current.pause();
        else simControlRef.current.resume();
      }

      // Pause/resume all MQTT sessions (freeze the live data stream)
      engineRef.current?.setAllSessionsPaused(next);
      setSessions((prevSessions) => prevSessions.map((s) => ({ ...s, paused: next })));

      return next;
    });
  }, []);

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].config.id);
    }
  }, [sessions.length, activeSessionId]);

  // Keep sessionsRef in sync for synchronous reads in event handlers
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.config.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const handleSelectNode = useCallback((path: string, node: UNSTreeNode) => {
    setSelectedPath(path);
    setSelectedNode(node);
  }, []);

  const handleToggleTelemetryKey = useCallback((key: string) => {
    setSelectedTelemetryKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handlePublishFromTree = useCallback((topic: string) => {
    setPublishTopic(topic);
    setShowPublishModal(true);
  }, []);

  const handleEditBroker = useCallback((broker: SavedBroker) => {
    setEditingBroker(broker);
    setShowSavedBrokers(false);
    setShowBrokerModal(true);
  }, []);

  const handleDeleteBroker = useCallback((id: string) => {
    setSavedBrokers(deleteSavedBroker(id));
  }, []);

  const handleLaunchBroker = useCallback(
    (config: BrokerConfig) => {
      setShowSavedBrokers(false);
      handleConnect(config, false);
    },
    [handleConnect]
  );

  const handleImported = useCallback(() => {
    setSavedBrokers(loadSavedBrokers());
  }, []);

  // Toggle dark/light mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const statusInfo =
    activeSession?.status === 'connected'
      ? activeSession.statusMessage?.startsWith('Subscribe error:')
        ? activeSession.config.name
        : activeSession.config.name
      : activeSession?.status === 'connecting'
        ? 'Connecting…'
        : activeSession?.status === 'error'
          ? `Error: ${activeSession.statusMessage ?? 'Unknown'}`
          : activeSession
            ? 'Disconnected'
            : 'No session';

  const statusDot =
    activeSession?.status === 'connected'
      ? 'bg-emerald-400'
      : activeSession?.status === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : activeSession?.status === 'error'
          ? 'bg-red-400'
          : 'bg-slate-600';

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-200">
      <div className="px-3 py-1.5 bg-base-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-cyan-400">UNS Sentinel Explorer</span>
          <span className="text-[10px] text-slate-600">by Nimish Nirmal</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Backend gateway connection indicator */}
          <span
            className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${
              gatewayConnected
                ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                : 'text-slate-500 border-slate-700 bg-slate-800/50'
            }`}
            title={
              gatewayConnected
                ? 'Backend gateway connected — TCP (1883) and self-signed TLS brokers available'
                : 'Backend gateway not connected — use Direct Browser mode or run locally with npm run dev:all'
            }
          >
            <span className={`w-1.5 h-1.5 rounded-full ${gatewayConnected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            {gatewayConnected ? 'Gateway Online' : 'Gateway Offline'}
          </span>
          <button
            onClick={() => setDarkMode((prev) => !prev)}
            className="text-slate-500 hover:text-cyan-400 transition-colors"
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <a
            href="https://github.com/nimish-nirmal/uns-sentinel-explorer/blob/main/README.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyan-400 transition-colors"
            title="Documentation"
          >
            <BookOpen className="w-3 h-3" />
            Docs
          </a>
          <a
            href="https://github.com/nimish-nirmal/uns-sentinel-explorer"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyan-400 transition-colors"
            title="GitHub Repository"
          >
            <Github className="w-3 h-3" />
            GitHub
          </a>
        </div>
      </div>
      <SessionBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onAddSession={() => {
          setEditingBroker(null);
          setShowBrokerModal(true);
        }}
        onRemoveSession={handleRemoveSession}
        onReconnect={handleReconnect}
        onPublish={() => {
          setPublishTopic(null);
          setShowPublishModal(true);
        }}
        onSavedBrokers={() => setShowSavedBrokers(true)}
        onActiveSessions={() => setShowActiveSessionsModal(true)}
      />

      <div className="px-3 py-1.5 bg-base-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-slate-600">
          <span>Status: </span>
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
            <span className="text-slate-400">{statusInfo}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTogglePause}
            disabled={!activeSession}
            className={[
              'btn !py-1 text-[10px]',
              isPaused
                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25'
                : 'btn-ghost',
              !activeSession ? 'opacity-40 pointer-events-none' : '',
            ].join(' ')}
            title={isPaused ? 'Resume live data stream' : 'Pause live data stream'}
          >
            {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={toggleSimulator}
            className={[
              'btn !py-1 text-[10px]',
              isSimulating
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
                : 'btn-ghost',
            ].join(' ')}
          >
            <FlaskConical className="w-3 h-3" />
            {isSimulating ? 'Stop Simulator' : 'Launch Demo Simulator'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-2 p-2 min-h-0">
        <div className="w-[30%] min-w-[220px]">
          {activeSession ? (
            <TopicTree tree={activeSession.tree} selectedPath={selectedPath} onSelect={handleSelectNode} />
          ) : (
            <div className="panel h-full flex items-center justify-center text-center text-xs text-slate-600 px-8">
              <div>
                <Loader2 className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                No active session. Connect to a broker or launch the simulator.
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-[320px]">
          <PayloadViewer
            selectedNode={selectedNode}
            onPublishTopic={handlePublishFromTree}
            selectedKeys={selectedTelemetryKeys}
            onToggleKey={handleToggleTelemetryKey}
            darkMode={darkMode}
          />
        </div>
        <div className="w-[25%] min-w-[200px]">
          <HealthPanel
            session={activeSession}
            selectedTelemetryKeys={selectedTelemetryKeys}
            onToggleTelemetryKey={handleToggleTelemetryKey}
          />
        </div>
      </div>

      <BrokerConfigModal
        open={showBrokerModal}
        initial={editingBroker}
        onClose={() => {
          setShowBrokerModal(false);
          setEditingBroker(null);
        }}
        onConnect={handleConnect}
      />
      <SavedBrokersList
        open={showSavedBrokers}
        brokers={savedBrokers}
        activeSessions={sessions}
        onClose={() => setShowSavedBrokers(false)}
        onLaunch={handleLaunchBroker}
        onEdit={handleEditBroker}
        onDelete={handleDeleteBroker}
        onImported={handleImported}
      />
      <PublishModal
        open={showPublishModal}
        session={activeSession}
        selectedTopic={publishTopic ?? undefined}
        onClose={() => setShowPublishModal(false)}
        onPublish={handlePublish}
      />
      <ActiveSessionsModal
        open={showActiveSessionsModal}
        onClose={() => setShowActiveSessionsModal(false)}
      />

      {/* Splash screen — shown on first load for 2 seconds */}
      {showSplash && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/95 backdrop-blur-sm">
          <div className="panel w-[520px] animate-fade-in">
            <div className="panel-header">
              <span className="flex items-center gap-2 text-cyan-400">
                <Radar className="w-4 h-4" />
                UNS Sentinel Explorer
              </span>
              <span className="text-[10px] text-slate-500">by Nimish Nirmal</span>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-300 leading-relaxed">
                <strong className="text-cyan-400">UNS Sentinel Explorer</strong> is a real-time
                monitoring tool for <strong className="text-slate-200">ISA-95 / UNS (Unified Namespace)</strong>{' '}
                MQTT namespaces. It visualizes live telemetry as a dynamic topic tree, tracks
                payload diffs, and plots numeric trends — all in your browser.
              </p>
              <div className="rounded-md bg-base-950 border border-slate-800 p-3 text-xs text-slate-400 space-y-1">
                <div>• Connect to any public MQTT broker (EMQX, Mosquitto, HiveMQ, Eclipse)</div>
                <div>• Explore the UNS topic hierarchy in real time</div>
                <div>• Monitor throughput, health KPIs & telemetry trends</div>
                <div>• Publish messages & diff payload changes</div>
              </div>
              <p className="text-xs text-slate-500">
                Opening the broker list…
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Gateway unavailable warning popup */}
      {showGatewayWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="panel w-[420px] animate-fade-in">
            <div className="panel-header">
              <span className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                Gateway Not Connected
              </span>
              <button
                onClick={() => setShowGatewayWarning(false)}
                className="text-slate-500 hover:text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-300">
                The backend gateway is <strong className="text-amber-400">not reachable</strong>.
                This usually happens on <strong>static hosting</strong> (like GitHub Pages)
                where no Node.js server can run.
              </p>
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
                <strong>Only Demo Simulator mode will work.</strong>
                <br />
                Real MQTT broker connections require the backend gateway.
              </div>
              <p className="text-xs text-slate-500">
                To use real MQTT brokers, run locally with{' '}
                <code className="text-cyan-400">npm run dev:all</code>.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowGatewayWarning(false)}
                  className="btn-primary"
                >
                  Got it — use Demo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
