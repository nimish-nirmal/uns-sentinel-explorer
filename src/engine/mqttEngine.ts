/**
 * MQTT Engine — manages broker connections via backend gateway OR direct browser,
 * performance-buffered message dispatch (max 20 FPS re-render throttle).
 */
import { io, Socket } from 'socket.io-client';
import type {
  BrokerConfig,
  Session,
  SessionStats,
  SessionStatus,
  TopicSubscription,
} from '../types';
import { createRootNode, upsertTopicNode } from './topicTree';
import { getGatewayUrl } from '../lib/config';

/** Maximum re-render rate for incoming packets (20 FPS = 50ms interval) */
const BATCH_WINDOW_MS = 50;
const BATCH_MAX_ITEMS = 500;
const THROUGHPUT_HISTORY_LIMIT = 40;
const GATEWAY_URL = getGatewayUrl();

export interface MessageBatch {
  topic: string;
  payload: string;
  retained: boolean;
  qos: number;
  arriveTime: number;
}

export interface MqttEngineCallbacks {
  /** Called at most 20x/sec with accumulated messages */
  onBatch: (sessionId: string, batch: MessageBatch[]) => void;
  onStatus: (sessionId: string, status: SessionStatus, message?: string) => void;
  onStatsTick: (sessionId: string, stats: SessionStats) => void;
  /** Called when the backend gateway is unreachable (e.g. static hosting / GitHub Pages) */
  onGatewayUnavailable?: () => void;
  /** Called when the backend gateway Socket.io connection state changes */
  onGatewayStatus?: (connected: boolean) => void;
}

export class MqttEngine {
  private sessions = new Map<string, Session>();
  private callbacks: MqttEngineCallbacks;
  private pendingBatches = new Map<string, MessageBatch[]>();
  private batchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private throughputTimers = new Map<string, ReturnType<typeof setInterval>>();
  private lastFlushAt = new Map<string, number>();
  private destroyed = false;
  private socket: Socket | null = null;
  private connectingBrokers = new Set<string>(); // Track brokers being connected to prevent duplicates
  private gatewayFailures = 0;
  private gatewayUnavailableNotified = false;
  private static readonly GATEWAY_FAILURE_THRESHOLD = 3;
  /** Track browser-mode MQTT clients: sessionId -> mqtt client */
  private browserClients = new Map<string, any>();
  private gatewayConnectionPromise: Promise<void> | null = null;

  constructor(callbacks: MqttEngineCallbacks) {
    this.callbacks = callbacks;
    // Don't connect to gateway immediately - wait until gateway mode is used
    // This prevents connection errors when using browser mode
  }

  /** Connect to backend gateway via Socket.io (lazy - only when needed) */
  private async connectToGateway(): Promise<void> {
    // If already connected, return immediately
    if (this.socket?.connected) {
      return;
    }

    // If already connecting, return existing promise
    if (this.gatewayConnectionPromise) {
      return this.gatewayConnectionPromise;
    }

    // If destroyed, don't connect
    if (this.destroyed) {
      return;
    }

    console.log('[Gateway] Connecting to backend gateway:', GATEWAY_URL);
    console.log('[Gateway] To configure, set VITE_GATEWAY_URL environment variable');

    // Create a promise that resolves when connected
    this.gatewayConnectionPromise = new Promise((resolve, reject) => {
      this.socket = io(GATEWAY_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
        timeout: 5000,
      });

      this.socket.on('connect', () => {
        if (this.destroyed) return;
        console.log('[Gateway] Socket.io connection established, socket ID:', this.socket?.id);
        this.gatewayFailures = 0; // Reset failure counter on successful connection
        this.callbacks.onGatewayStatus?.(true);
        resolve();
      });

      this.socket.on('disconnect', () => {
        if (this.destroyed) return;
        console.log('[Gateway] Disconnected from backend gateway');
        this.callbacks.onGatewayStatus?.(false);
      });

      this.socket.on('connect_error', (err) => {
        if (this.destroyed) return;
        console.error('[Gateway] Socket.io connection error:', err.message);
        console.error('[Gateway] Error details:', err);
        this.callbacks.onGatewayStatus?.(false);

        // After several consecutive failures, the gateway is likely unreachable
        // (e.g. static hosting on GitHub Pages with no backend). Notify the app
        // so it can fall back to the Demo Simulator.
        this.gatewayFailures++;
        if (!this.gatewayUnavailableNotified && this.gatewayFailures >= MqttEngine.GATEWAY_FAILURE_THRESHOLD) {
          this.gatewayUnavailableNotified = true;
          console.warn('[Gateway] Backend gateway unreachable — falling back to Demo Simulator mode');
          this.callbacks.onGatewayUnavailable?.();
        }
        
        reject(new Error(err.message));
      });

      // Listen for MQTT messages from backend
      this.socket.on('mqtt:message', (data: { topic: string; payload: string; timestamp: number }) => {
        if (this.destroyed) return;
        this.handleGatewayMessage(data);
      });

      // Listen for connection status updates
      this.socket.on('mqtt:connected', (data: { sessionId: string; host: string; port: number }) => {
        if (this.destroyed) return;
        console.log('[MQTT] Received mqtt:connected event:', data);
        const session = this.sessions.get(data.sessionId);
        if (session) {
          console.log('[MQTT] Session found, updating status to connected');
          session.status = 'connected';
          session.stats.connectedAt = Date.now();
          // Clear connecting flag
          const brokerKey = `${data.host}:${data.port}:${session.config.clientId}`;
          this.connectingBrokers.delete(brokerKey);
          this.callbacks.onStatus(data.sessionId, 'connected', `Connected to ${data.host}:${data.port}`);
        } else {
          console.warn('[MQTT] Session not found for mqtt:connected event:', data.sessionId);
        }
      });

      this.socket.on('mqtt:error', (data: { sessionId: string; error: string }) => {
        const readableError = getReadableError(data.error);
        console.error('[MQTT] Received mqtt:error event:', { ...data, readableError });
        const session = this.sessions.get(data.sessionId);
        if (session) {
          console.error('[MQTT] Session error:', readableError);
          session.status = 'error';
          // Clear connecting flag on error
          const brokerKey = `${session.config.host}:${session.config.port}:${session.config.clientId}`;
          this.connectingBrokers.delete(brokerKey);
          this.callbacks.onStatus(data.sessionId, 'error', readableError);
        } else {
          console.warn('[MQTT] Session not found for mqtt:error event:', data.sessionId);
        }
      });

      this.socket.on('mqtt:disconnect', (data: { sessionId: string }) => {
        console.log('[MQTT] Received mqtt:disconnect event:', data);
        const session = this.sessions.get(data.sessionId);
        if (session && session.status !== 'error') {
          console.log('[MQTT] Session disconnected');
          session.status = 'disconnected';
          session.stats.disconnectedAt = Date.now();
          session.mqttClient = null;
          this.callbacks.onStatus(data.sessionId, 'disconnected', 'Connection closed');
        } else {
          console.warn('[MQTT] Session not found for mqtt:disconnect event:', data.sessionId);
        }
      });

      this.socket.on('mqtt:offline', (data: { sessionId: string }) => {
        console.log('[MQTT] Received mqtt:offline event:', data);
        const session = this.sessions.get(data.sessionId);
        if (session && session.status !== 'error') {
          console.log('[MQTT] Broker offline');
          session.status = 'disconnected';
          this.callbacks.onStatus(data.sessionId, 'disconnected', 'Broker offline');
        } else {
          console.warn('[MQTT] Session not found for mqtt:offline event:', data.sessionId);
        }
      });

      // Listen for subscribe errors
      this.socket.on('mqtt:subscribe:error', (data: { sessionId: string; topic: string; error: string }) => {
        console.error('[MQTT] Subscribe error:', data);
        const session = this.sessions.get(data.sessionId);
        if (session) {
          // Update status with subscribe error but don't change connection status
          this.callbacks.onStatus(data.sessionId, session.status, `Subscribe error: ${data.error}`);
        }
      });
    });

    return this.gatewayConnectionPromise;
  }

  /** Handle incoming message from backend gateway */
  private handleGatewayMessage(data: { topic: string; payload: string; timestamp: number }) {
    console.log('[MQTT] Received message from backend:', { topic: data.topic, payloadLength: data.payload.length });
    
    // Find the session that should receive this message
    // For now, broadcast to all active sessions
    let messageRouted = false;
    this.sessions.forEach((session, sessionId) => {
      if (session.status === 'connected' && !session.paused) {
        messageRouted = true;
        const batch: MessageBatch = {
          topic: data.topic,
          payload: data.payload,
          retained: false,
          qos: 0,
          arriveTime: data.timestamp
        };

        const batches = this.pendingBatches.get(sessionId) ?? [];
        batches.push(batch);
        this.pendingBatches.set(sessionId, batches);

        // Update stats
        session.stats.messagesReceived++;
        session.stats.bytesReceived += data.payload.length;
        session.stats.lastMessageAt = data.timestamp;

        // Throttle flush
        const last = this.lastFlushAt.get(sessionId) ?? 0;
        const now = Date.now();
        if (now - last >= BATCH_WINDOW_MS) {
          this.flushBatch(sessionId);
        } else if (!this.batchTimers.has(sessionId)) {
          const delay = BATCH_WINDOW_MS - (now - last);
          const timer = setTimeout(() => {
            this.batchTimers.delete(sessionId);
            this.flushBatch(sessionId);
          }, delay);
          this.batchTimers.set(sessionId, timer);
        }
      }
    });
    
    if (!messageRouted) {
      console.warn('[MQTT] Message received but no connected sessions to route to');
    }
  }

  /** Route a message from a browser-mode MQTT client into the batching pipeline */
  private handleBrowserMessage(sessionId: string, topic: string, payload: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected' || session.paused) return;

    const batch: MessageBatch = {
      topic,
      payload,
      retained: false,
      qos: 0,
      arriveTime: Date.now()
    };

    const batches = this.pendingBatches.get(sessionId) ?? [];
    batches.push(batch);
    this.pendingBatches.set(sessionId, batches);

    // Update stats
    session.stats.messagesReceived++;
    session.stats.bytesReceived += payload.length;
    session.stats.lastMessageAt = Date.now();

    // Throttle flush
    const last = this.lastFlushAt.get(sessionId) ?? 0;
    const now = Date.now();
    if (now - last >= BATCH_WINDOW_MS) {
      this.flushBatch(sessionId);
    } else if (!this.batchTimers.has(sessionId)) {
      const delay = BATCH_WINDOW_MS - (now - last);
      const timer = setTimeout(() => {
        this.batchTimers.delete(sessionId);
        this.flushBatch(sessionId);
      }, delay);
      this.batchTimers.set(sessionId, timer);
    }
  }

  /** Create a session and connect via backend gateway or direct browser */
  createSession(config: BrokerConfig): Session {
    // Prevent duplicate sessions for the same broker config ID.
    // This guard is defense-in-depth — App.tsx now also destroys any
    // existing session before calling createSession, but StrictMode or
    // rapid UI interactions could still attempt to create duplicates.
    const existing = this.sessions.get(config.id);
    if (existing && (existing.status === 'connecting' || existing.status === 'connected')) {
      console.warn(`[MQTT] Session ${config.id} already exists with status ${existing.status}, returning existing session`);
      this.callbacks.onStatus(config.id, existing.status, existing.statusMessage);
      return existing;
    }
    // If a session exists but is stale (error/disconnected), clean it up first
    if (existing) {
      console.log(`[MQTT] Session ${config.id} exists with stale status ${existing.status}, cleaning up before reconnect`);
      this.destroySession(config.id);
    }

    const session: Session = {
      config,
      status: 'connecting',
      tree: createRootNode(),
      mqttClient: null,
      stats: {
        messagesReceived: 0,
        messagesPerSecond: 0,
        bytesReceived: 0,
        throughputHistory: [],
      },
      activeSubscriptions: [],
    };
    this.sessions.set(config.id, session);
    this.pendingBatches.set(config.id, []);
    this.callbacks.onStatus(config.id, 'connecting', 'Connecting…');
    this.throughputTimers.set(
      config.id,
      setInterval(() => this.tickThroughput(config.id), 1000)
    );

    if (config.connectionMode === 'browser') {
      this.connectViaBrowser(session);
    } else {
      this.connectViaGateway(session).catch((err) => {
        console.error('[MQTT] Failed to connect via gateway:', err);
      });
    }

    return session;
  }

  /** Connect to MQTT broker directly in browser using mqtt.js */
  private connectViaBrowser(session: Session) {
    const { config } = session;
    const sessionId = config.id;

    // Prevent duplicate connections
    const brokerKey = `${config.host}:${config.port}:${config.clientId}`;
    if (this.connectingBrokers.has(brokerKey)) {
      console.warn(`[Browser] Already connecting to ${brokerKey}, skipping duplicate connection`);
      return;
    }

    console.log('[Browser] Initiating direct browser connection to broker:', {
      host: config.host,
      port: config.port,
      protocol: config.protocol,
      clientId: config.clientId,
      topics: config.subscriptions.map(s => s.pattern),
    });

    // Mark as connecting to prevent duplicates
    this.connectingBrokers.add(brokerKey);

    // Build WebSocket URL for browser connection.
    // Browsers can ONLY use WebSocket (ws/wss) — raw TCP (mqtt/mqtts) is not
    // possible from a browser. So we map the protocol to its WebSocket equivalent.
    //
    // CRITICAL: If the page is served over HTTPS (e.g. GitHub Pages, Vercel),
    // the browser BLOCKS insecure `ws://` connections (Mixed Content policy).
    // We must auto-upgrade `ws` → `wss` and remap the port to the broker's
    // secure WebSocket port.
    const pageIsHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

    // Determine the base WebSocket protocol from the config.
    let wsProtocol: string;
    if (config.protocol === 'wss' || config.protocol === 'mqtts') {
      wsProtocol = 'wss';
    } else {
      wsProtocol = 'ws';
    }

    // If the page is HTTPS but the config requests insecure `ws`, auto-upgrade
    // to `wss` and remap the port to the broker's secure WebSocket port.
    let effectivePort = config.port;
    if (pageIsHttps && wsProtocol === 'ws') {
      console.warn(
        `[Browser] Page is served over HTTPS — auto-upgrading ws:// to wss:// for ${config.host}:${config.port}`
      );
      wsProtocol = 'wss';
      // Map common insecure WebSocket ports to their secure equivalents.
      // If the port is not in the map, keep it (some brokers use the same
      // port for both ws and wss, e.g. 443).
      const securePortMap: Record<number, number> = {
        8000: 8884,  // HiveMQ: ws:8000 → wss:8884
        8080: 8081,  // Mosquitto: ws:8080 → wss:8081
        8083: 8084,  // EMQX: ws:8083 → wss:8084
      };
      effectivePort = securePortMap[config.port] ?? config.port;
    }

    // Add /mqtt path if not already present (standard WebSocket MQTT path)
    let wsPath = '/mqtt';
    if (effectivePort === 8000 || effectivePort === 8080 || effectivePort === 8083) {
      // Common WebSocket ports that typically use /mqtt path
      wsPath = '/mqtt';
    }
    const url = `${wsProtocol}://${config.host}:${effectivePort}${wsPath}`;

    // Build mqtt.js options
    const mqttOptions: any = {
      clientId: config.clientId,
      clean: config.cleanSession ?? true,
      connectTimeout: (config.connectTimeout ?? 10) * 1000,
      keepalive: config.keepAlive ?? 60,
      // Disable auto-reconnect to prevent connection thrashing
      // Users can manually reconnect using the UI
      reconnectPeriod: 0,
      // Increase WebSocket ping interval to prevent premature disconnects
      pingTimeout: (config.connectTimeout ?? 10) * 1000,
      pingInterval: 60000,
    };

    if (config.username) mqttOptions.username = config.username;
    if (config.password) mqttOptions.password = config.password;
    if (config.protocolVersion) mqttOptions.protocolVersion = config.protocolVersion;

    // MQTT 5.0 properties
    if (config.protocolVersion === 5) {
      if (config.sessionExpiryInterval !== undefined) mqttOptions.sessionExpiryInterval = config.sessionExpiryInterval;
      if (config.receiveMaximum !== undefined) mqttOptions.receiveMaximum = config.receiveMaximum;
      if (config.maximumPacketSize !== undefined) mqttOptions.maximumPacketSize = config.maximumPacketSize;
      if (config.topicAliasMaximum !== undefined) mqttOptions.topicAliasMaximum = config.topicAliasMaximum;
      if (config.requestResponseInfo !== undefined) mqttOptions.requestResponseInfo = config.requestResponseInfo;
      if (config.requestProblemInfo !== undefined) mqttOptions.requestProblemInfo = config.requestProblemInfo;
    }

    // Dynamic import of mqtt.js (only available in browser)
    import('mqtt').then((mqttModule) => {
      const mqttClient = mqttModule.default ? mqttModule.default.connect(url, mqttOptions) : mqttModule.connect(url, mqttOptions);
      
      // Store browser client for cleanup
      this.browserClients.set(sessionId, mqttClient);
      session.mqttClient = mqttClient;

      mqttClient.on('connect', () => {
        console.log(`[Browser] ✅ Connected to ${config.host}:${config.port} (session: ${sessionId})`);
        this.connectingBrokers.delete(brokerKey);
        session.status = 'connected';
        session.stats.connectedAt = Date.now();
        this.callbacks.onStatus(sessionId, 'connected', `Connected to ${config.host}:${config.port}`);

        // Subscribe to all topics
        console.log(`[Browser] Subscribing to ${config.subscriptions.length} topics...`);
        config.subscriptions.forEach((sub) => {
          // Mark as pending
          const subIndex = session.config.subscriptions.findIndex(s => s.pattern === sub.pattern);
          if (subIndex >= 0) {
            session.config.subscriptions[subIndex].status = 'pending';
          }
          
          mqttClient.subscribe(sub.pattern, { qos: sub.qos }, (err: any, granted: any) => {
            if (err) {
              // Log but don't fail - some subscriptions may fail (e.g., $SYS without /)
              console.warn(`[Browser] ⚠️  Subscription warning for ${sub.pattern}:`, err.message || err);
              if (subIndex >= 0) {
                session.config.subscriptions[subIndex].status = 'error';
                session.config.subscriptions[subIndex].errorMessage = err.message || String(err);
              }
              // Don't update session status - connection is still valid
            } else if (granted && granted[0] && granted[0].qos === 135) {
              const errorMsg = `Not authorized to subscribe to ${sub.pattern}`;
              console.warn(`[Browser] ⚠️  ${errorMsg}`);
              if (subIndex >= 0) {
                session.config.subscriptions[subIndex].status = 'error';
                session.config.subscriptions[subIndex].errorMessage = errorMsg;
              }
              // Don't update session status - connection is still valid
            } else {
              console.log(`[Browser] ✅ Subscribed to ${sub.pattern}`);
              if (subIndex >= 0) {
                session.config.subscriptions[subIndex].status = 'subscribed';
              }
            }
          });
        });
      });

      mqttClient.on('message', (topic: string, payload: Buffer) => {
        this.handleBrowserMessage(sessionId, topic, payload.toString());
      });

      mqttClient.on('error', (err: Error) => {
        console.error(`[Browser] ❌ MQTT error (${sessionId}):`, err);
        this.connectingBrokers.delete(brokerKey);
        session.status = 'error';
        const errorMsg = getReadableError(err.message);
        // Add helpful context for common browser connection issues
        if (err.message.includes('connack timeout')) {
          this.callbacks.onStatus(sessionId, 'error', 
            `Connection timeout - The broker may not support WebSocket or is blocking browser connections. Try Backend Gateway mode for TCP connections.`);
        } else if (err.message.includes('WebSocket')) {
          this.callbacks.onStatus(sessionId, 'error', 
            `WebSocket connection failed - The broker may require WSS (secure WebSocket) or a different port.`);
        } else {
          this.callbacks.onStatus(sessionId, 'error', errorMsg);
        }
      });

      mqttClient.on('close', () => {
        console.log(`[Browser] Connection closed (${sessionId})`);
        this.connectingBrokers.delete(brokerKey);
        this.browserClients.delete(sessionId);
        // Update status so the UI reflects the dead connection.
        // With auto-reconnect disabled, a closed connection means the
        // session is gone and the user needs to reconnect manually.
        if (session.status === 'connected' || session.status === 'connecting') {
          session.status = 'disconnected';
          session.stats.disconnectedAt = Date.now();
          session.mqttClient = null;
          this.callbacks.onStatus(sessionId, 'disconnected', 'Connection closed');
        }
      });

      mqttClient.on('reconnect', () => {
        console.log(`[Browser] Reconnecting (${sessionId})...`);
        // Don't update status - just log it
      });

      mqttClient.on('offline', () => {
        console.log(`[Browser] Client offline (${sessionId})`);
        // Don't update status - just log it
      });
    }).catch((err) => {
      console.error(`[Browser] Failed to load mqtt.js:`, err);
      this.connectingBrokers.delete(brokerKey);
      session.status = 'error';
      this.callbacks.onStatus(sessionId, 'error', 'Failed to load MQTT library. Ensure mqtt.js is installed.');
    });
  }

  /** Connect to MQTT broker via backend gateway */
  private async connectViaGateway(session: Session) {
    const { config } = session;
    
    // Prevent duplicate connections - check if already connecting to this broker
    const brokerKey = `${config.host}:${config.port}:${config.clientId}`;
    if (this.connectingBrokers.has(brokerKey)) {
      console.warn(`[MQTT] Already connecting to ${brokerKey}, skipping duplicate broker:connect event`);
      return;
    }
    
    console.log('[MQTT] Initiating connection to broker:', {
      host: config.host,
      port: config.port,
      protocol: config.protocol,
      clientId: config.clientId,
      username: config.username ? '***' : '(none)',
      password: config.password ? '***' : '(none)',
      topics: config.subscriptions.map(s => s.pattern),
      brokerId: config.id
    });

    // Ensure gateway is connected (lazy connection)
    if (!this.socket?.connected) {
      try {
        await this.connectToGateway();
      } catch (err) {
        const errorMsg = 'Cannot connect to backend gateway - Socket.io connection failed';
        console.error('[MQTT]', errorMsg, err);
        this.callbacks.onStatus(config.id, 'error', errorMsg);
        return;
      }
    }

    if (!this.socket?.connected) {
      const errorMsg = 'Not connected to backend gateway - Socket.io not connected';
      console.error('[MQTT]', errorMsg);
      this.callbacks.onStatus(config.id, 'error', errorMsg);
      return;
    }

    console.log('[MQTT] Socket.io connected, emitting broker:connect event');
    
    // Mark as connecting to prevent duplicates
    this.connectingBrokers.add(brokerKey);
    
    // Send connection request to backend with brokerId for session tracking
    this.socket.emit('broker:connect', {
      host: config.host,
      port: config.port,
      protocol: config.protocol,
      topics: config.subscriptions.map(s => s.pattern),
      clientId: config.clientId,
      username: config.username,
      password: config.password,
      brokerId: config.id,  // Send broker ID so backend can track sessions consistently
      // Advanced options
      protocolVersion: config.protocolVersion,
      connectTimeout: config.connectTimeout,
      keepAlive: config.keepAlive,
      autoReconnect: config.autoReconnect,
      cleanSession: config.cleanSession,
      sessionExpiryInterval: config.sessionExpiryInterval,
      receiveMaximum: config.receiveMaximum,
      maximumPacketSize: config.maximumPacketSize,
      topicAliasMaximum: config.topicAliasMaximum,
      requestResponseInfo: config.requestResponseInfo,
      requestProblemInfo: config.requestProblemInfo,
    });

    console.log('[MQTT] broker:connect event emitted, waiting for backend response...');
    
    // Store session (backend will confirm via mqtt:connected event)
    session.mqttClient = { connected: true } as any;
    
    // Clear connecting flag after timeout (in case backend never responds)
    setTimeout(() => {
      this.connectingBrokers.delete(brokerKey);
    }, 10000);
  }

  /** Destroy a session and clean up timers */
  destroySession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      console.warn(`[MQTT] Cannot destroy session ${sessionId} - not found`);
      return;
    }
    
    console.log(`[MQTT] Destroying session ${sessionId}`);
    
    // Clear connecting flag to allow reconnection
    const brokerKey = `${session.config.host}:${session.config.port}:${session.config.clientId}`;
    this.connectingBrokers.delete(brokerKey);
    
    // Disconnect browser client if in browser mode
    if (session.config.connectionMode === 'browser') {
      const browserClient = this.browserClients.get(sessionId);
      if (browserClient) {
        try {
          browserClient.end(true);
          browserClient.removeAllListeners();
        } catch (e) {
          // Client may already be destroyed
        }
        this.browserClients.delete(sessionId);
      }
    } else {
      // Disconnect from backend gateway
      if (this.socket?.connected) {
        console.log(`[MQTT] Emitting broker:disconnect for ${sessionId}`);
        this.socket.emit('broker:disconnect', { sessionId });
      }
    }

    const timer = this.batchTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    const tTimer = this.throughputTimers.get(sessionId);
    if (tTimer) clearInterval(tTimer);
    this.batchTimers.delete(sessionId);
    this.throughputTimers.delete(sessionId);
    this.pendingBatches.delete(sessionId);
    this.lastFlushAt.delete(sessionId);
    if (session) {
      session.mqttClient = null;
      session.status = 'disconnected';
    }
    this.sessions.delete(sessionId);
    
    console.log(`[MQTT] Session ${sessionId} destroyed`);
  }

  disconnectAll() {
    for (const id of Array.from(this.sessions.keys())) {
      this.destroySession(id);
    }
  }

  /** Set paused state for all sessions (freezes live data stream to the UI) */
  setAllSessionsPaused(paused: boolean) {
    this.sessions.forEach((session) => {
      session.paused = paused;
    });
  }

  /** Set paused state for a single session */
  setSessionPaused(sessionId: string, paused: boolean) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.paused = paused;
    }
  }

  /** Reconnect a session */
  reconnect(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    
    console.log(`[MQTT] Reconnecting session ${sessionId}`);
    
    // Destroy old session
    this.destroySession(sessionId);
    
    // Create new session with same config
    const fresh = this.createSession(session.config);
    // Preserve the original session ID
    this.sessions.set(sessionId, fresh);
    return fresh;
  }

  /** Publish a message via backend gateway or browser client */
  publish(
    sessionId: string,
    topic: string,
    payload: string,
    qos: 0 | 1 | 2,
    retain: boolean
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.mqttClient || session.status !== 'connected') {
      return Promise.reject(new Error('Session is not connected'));
    }

    // Browser mode: publish directly via mqtt client
    if (session.config.connectionMode === 'browser') {
      return new Promise((resolve, reject) => {
        const client = session.mqttClient as any;
        if (!client || typeof client.publish !== 'function') {
          return reject(new Error('MQTT client not available'));
        }
        client.publish(topic, payload, { qos, retain }, (err: any) => {
          if (err) {
            reject(new Error(err.message || err));
          } else {
            resolve();
          }
        });
      });
    }

    // Gateway mode: publish via Socket.io
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        return reject(new Error('Not connected to backend gateway'));
      }

      this.socket.emit('broker:publish', {
        sessionId,
        topic,
        payload,
        qos,
        retain
      }, (response: { success: boolean; error?: string }) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      });
    });
  }

  private flushBatch(sessionId: string) {
    const batch = this.pendingBatches.get(sessionId);
    const timer = this.batchTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(sessionId);
    }
    if (!batch || batch.length === 0) return;
    this.lastFlushAt.set(sessionId, Date.now());
    this.pendingBatches.set(sessionId, []);
    this.callbacks.onBatch(sessionId, batch);
  }

  private tickThroughput(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    // Freeze stats while paused
    if (session.paused) return;

    const history = session.stats.throughputHistory;
    const current = session.stats.messagesReceived;
    const base = (session as any)._prevMsgCount ?? current;
    const delta = current - base;
    (session as any)._prevMsgCount = current;

    session.stats.messagesPerSecond = delta > 0 ? delta : 0;

    if (history.length >= THROUGHPUT_HISTORY_LIMIT) history.shift();
    history.push(delta);

    this.callbacks.onStatsTick(sessionId, { ...session.stats });
  }

  /** Cleanup on tab close */
  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    console.log('[MQTT] Destroying engine, disconnecting all sessions...');
    
    // Disconnect all sessions from backend BEFORE destroying socket
    const sessionIds = Array.from(this.sessions.keys());
    console.log(`[MQTT] Sending disconnect for ${sessionIds.length} sessions to backend`);
    
    if (this.socket?.connected) {
      sessionIds.forEach(sessionId => {
        console.log(`[MQTT] Sending broker:disconnect for ${sessionId}`);
        this.socket?.emit('broker:disconnect', { sessionId });
      });
    }
    
    // Disconnect all browser clients
    sessionIds.forEach(sessionId => {
      const browserClient = this.browserClients.get(sessionId);
      if (browserClient) {
        try {
          browserClient.end(true);
          browserClient.removeAllListeners();
        } catch (e) {
          // Client may already be destroyed
        }
      }
    });
    this.browserClients.clear();
    
    this.callbacks.onGatewayStatus?.(false);
    
    // Give backend time to process disconnect events
    setTimeout(() => {
      this.disconnectAll();
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
      }
      console.log('[MQTT] Engine destroyed');
    }, 100);
  }
}

/**
 * Decode an incoming MQTT payload
 */
export function decodePayload(payload: string): { value: any; raw: string } {
  const raw = payload;
  return { value: tryParseJSON(raw) ?? raw, raw };
}

function tryParseJSON(s: string): any | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !isNumeric(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isNumeric(s: string): boolean {
  return s !== '' && !isNaN(Number(s));
}

/** Build a fresh session_id */
export function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a fresh broker config id */
export function generateBrokerId(): string {
  return `broker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert an array of topic pattern strings + default QoS into subscription rules */
export function parseSubscriptionPatterns(patterns: string[], qos: 0 | 1 | 2 = 0): TopicSubscription[] {
  return patterns
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ pattern: p, qos }));
}

/** Convert MQTT error codes to human-readable messages */
export function getReadableError(error: string): string {
  if (error.includes('Unacceptable protocol version')) {
    return 'Connection refused: Unacceptable protocol version - The broker does not support the MQTT protocol version requested. The backend gateway will automatically retry with MQTT 3.1.1 (v4) and MQTT 3.1 (v3), which are supported by virtually all brokers.';
  }
  if (error.includes('ECONNRESET')) {
    return 'Connection reset by broker (ECONNRESET) - The broker forcibly closed the connection. This is common with public brokers like test.mosquitto.org.';
  }
  if (error.includes('ECONNREFUSED')) {
    return 'Connection refused (ECONNREFUSED) - The broker is not running or not accepting connections on this port.';
  }
  if (error.includes('ETIMEDOUT')) {
    return 'Connection timed out (ETIMEDOUT) - The broker did not respond within the timeout period.';
  }
  if (error.includes('ENOTFOUND')) {
    return 'Host not found (ENOTFOUND) - The broker hostname could not be resolved.';
  }
  if (error.includes('EHOSTUNREACH')) {
    return 'Host unreachable (EHOSTUNREACH) - The broker host is not reachable from this network.';
  }
  if (error.includes('EPIPE')) {
    return 'Broken pipe (EPIPE) - The connection was broken while writing data.';
  }
  if (error.includes('socket hang up')) {
    return 'Socket hang up - The broker closed the connection unexpectedly. Common with unstable public brokers.';
  }
  if (error.includes('connack timeout')) {
    return 'Connection acknowledgement timeout - The broker did not respond to the connection request in time.';
  }
  if (error.includes('Connection refused: Server busy')) {
    return 'Connection refused - The broker is busy and not accepting new connections. Try again later.';
  }
  return error;
}

/** Default demo topics for the simulator */
export const DEFAULT_DEMO_TOPICS: TopicSubscription[] = [
  { pattern: 'Enterprise/Site1/Area1/Line1/Cell1/#', qos: 0 },
  { pattern: 'legacy/sensors/+/temp', qos: 0 },
  { pattern: 'legacy/sensors/+/pressure', qos: 0 },
  { pattern: '$SYS/#', qos: 0 },
];