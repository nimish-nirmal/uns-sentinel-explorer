/**
 * UNS Sentinel Explorer — Core TypeScript type definitions
 */

/** Node classification for visual distinction in the topic tree */
export type TreeNodeType = 'isa95' | 'legacy' | 'sys';

/** A single topic subscription rule */
export interface TopicSubscription {
  pattern: string;
  qos: 0 | 1 | 2;
}

/** Broker connection configuration */
export interface BrokerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'mqtt' | 'mqtts' | 'ws' | 'wss';
  clientId: string;
  username?: string;
  password?: string;
  subscriptions: TopicSubscription[];
  /** Skip TLS certificate validation (for self-signed certs) */
  rejectUnauthorized?: boolean;
  /** Path to CA certificate file (optional) */
  caCert?: string;
  /** Path to client certificate file (optional) */
  clientCert?: string;
  /** Path to client key file (optional) */
  clientKey?: string;
}

/** Live session status */
export type SessionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/** A node in the dynamic topic tree */
export interface UNSTreeNode {
  id: string;
  name: string;
  path: string;
  type: TreeNodeType;
  children: Map<string, UNSTreeNode>;
  /** Most recent parsed payload (object or primitive) */
  payload?: any;
  /** Previous payload — used to compute diffs */
  previousPayload?: any;
  rawPayload?: string;
  retained?: boolean;
  lastUpdated?: number;
  /** Whether this node directly holds a payload (leaf) vs is a structural branch */
  isLeaf: boolean;
}

/** Full session state managed by the engine */
export interface Session {
  config: BrokerConfig;
  status: SessionStatus;
  statusMessage?: string;
  tree: UNSTreeNode;
  mqttClient: any | null;
  /** Monitoring stats */
  stats: SessionStats;
  /** Subscriptions actively registered on the broker (effective after connect) */
  activeSubscriptions: TopicSubscription[];
  /** Whether the live data stream is paused (frozen) for this session */
  paused?: boolean;
}

/** Per-session performance & health counters */
export interface SessionStats {
  messagesReceived: number;
  messagesPerSecond: number;
  lastMessageAt?: number;
  bytesReceived: number;
  /** Ring buffer of recent throughput samples for sparkline */
  throughputHistory: number[];
  connectedAt?: number;
  disconnectedAt?: number;
}

/** A named saved broker profile stored in localStorage */
export interface SavedBroker extends BrokerConfig {
  savedAt: number;
}

/** Payload publisher form */
export interface PublishOptions {
  topic: string;
  payload: string;
  qos: 0 | 1 | 2;
  retain: boolean;
}

/** Telemetry point extracted from a numeric leaf payload */
export interface TelemetryPoint {
  t: number;
  value: number;
  label: string;
}

/** Filter returned by the tree search utility */
export interface TreeSearchResult {
  node: UNSTreeNode;
  matches: string[];
}

/** Export schema for workspace import/export */
export interface WorkspaceExport {
  app: 'uns-sentinel-explorer';
  version: 1;
  exportedAt: string;
  brokers: SavedBroker[];
}