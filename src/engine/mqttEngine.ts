/**
 * MQTT Engine — manages broker connections via backend gateway,
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

  constructor(callbacks: MqttEngineCallbacks) {
    this.callbacks = callbacks;
    this.connectToGateway();
  }

  /** Connect to backend gateway via Socket.io */
  private connectToGateway() {
    if (this.destroyed) {
      return;
    }

    console.log('[Gateway] Connecting to backend gateway:', GATEWAY_URL);
    console.log('[Gateway] To configure, set VITE_GATEWAY_URL environment variable');

    this.socket = io(GATEWAY_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity
    });

    this.socket.on('connect', () => {
      if (this.destroyed) return;
      console.log('[Gateway] Socket.io connection established, socket ID:', this.socket?.id);
    });

    this.socket.on('disconnect', () => {
      if (this.destroyed) return;
      console.log('[Gateway] Disconnected from backend gateway');
    });

    this.socket.on('connect_error', (err) => {
      if (this.destroyed) return;
      console.error('[Gateway] Socket.io connection error:', err.message);
      console.error('[Gateway] Error details:', err);

      // After several consecutive failures, the gateway is likely unreachable
      // (e.g. static hosting on GitHub Pages with no backend). Notify the app
      // so it can fall back to the Demo Simulator.
      this.gatewayFailures++;
      if (!this.gatewayUnavailableNotified && this.gatewayFailures >= MqttEngine.GATEWAY_FAILURE_THRESHOLD) {
        this.gatewayUnavailableNotified = true;
        console.warn('[Gateway] Backend gateway unreachable — falling back to Demo Simulator mode');
        this.callbacks.onGatewayUnavailable?.();
      }
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

  /** Create a session and connect via backend gateway */
  createSession(config: BrokerConfig): Session {
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
    this.connectViaGateway(session);
    return session;
  }

  /** Connect to MQTT broker via backend gateway */
  private connectViaGateway(session: Session) {
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
      brokerId: config.id  // Send broker ID so backend can track sessions consistently
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
    
    // Clear connecting flag
    const brokerKey = `${session.config.host}:${session.config.port}:${session.config.clientId}`;
    this.connectingBrokers.delete(brokerKey);
    
    // Disconnect from backend
    if (this.socket?.connected) {
      console.log(`[MQTT] Emitting broker:disconnect for ${sessionId}`);
      this.socket.emit('broker:disconnect', { sessionId });
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

  /** Publish a message via backend gateway */
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