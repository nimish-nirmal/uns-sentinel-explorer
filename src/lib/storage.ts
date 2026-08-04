/**
 * Storage utilities — localStorage persistence for saved broker profiles,
 * plus workspace import/export as JSON files.
 */
import type { SavedBroker, TopicSubscription, WorkspaceExport } from '../types';

const STORAGE_KEY = 'uns-sentinel-explorer:brokers';
const EXPORT_FILENAME = 'uns-sentinel-explorer-workspace.json';

/** Load saved brokers from localStorage */
export function loadSavedBrokers(): SavedBroker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultBrokers();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return getDefaultBrokers();

    // Migrate old configs and filter valid brokers
    const migrated = parsed.map((broker: SavedBroker) => {
      // Migrate old test.mosquitto.org config from WebSocket port 8080 to standard MQTT port 1883
      if (broker.id === 'default-test-mosquitto' && broker.port === 8080) {
        return { ...broker, port: 1883, protocol: 'mqtt' };
      }
      // Migrate insecure WebSocket defaults → secure WSS (required when the
      // app is served over HTTPS, e.g. GitHub Pages / Vercel).
      if (broker.id === 'default-mosquitto-ws' && (broker.port === 8080 || broker.protocol === 'ws')) {
        return { ...broker, port: 8081, protocol: 'wss' };  // Mosquitto secure WebSocket
      }
      if (broker.id === 'default-emqx' && (broker.port === 8083 || broker.protocol === 'ws')) {
        return { ...broker, port: 8084, protocol: 'wss' };  // EMQX secure WebSocket
      }
      if (broker.id === 'default-hivemq' && (broker.port === 8000 || broker.protocol === 'ws')) {
        return { ...broker, port: 8884, protocol: 'wss' };  // HiveMQ secure WebSocket
      }
      return broker;
    });
    
    const validBrokers = migrated.filter(isValidBroker).filter((broker) => {
      const validProtocol = broker.protocol === 'mqtt' || broker.protocol === 'mqtts' || broker.protocol === 'ws' || broker.protocol === 'wss';
      const validPort = broker.port >= 1 && broker.port <= 65535;
      // In browser environments, all protocols use WebSocket, so accept WebSocket ports for all
      const transportMatchesPort =
        (broker.port === 1883) ||  // Legacy TCP MQTT (will be converted to WS in browser)
        (broker.port === 8000) ||  // WebSocket (HiveMQ)
        (broker.port === 8080) ||  // WebSocket (standard)
        (broker.port === 8081) ||  // Secure WebSocket (Mosquitto)
        (broker.port === 8083) ||  // WebSocket (EMQX)
        (broker.port === 8084) ||  // Secure WebSocket
        (broker.port === 8883) ||  // Secure MQTT
        (broker.port === 8884) ||  // Secure MQTT alternative
        (broker.port === 443);     // Standard HTTPS/WSS
      return validProtocol && validPort && transportMatchesPort;
    });

    const defaults = getDefaultBrokers();
    const merged = [...validBrokers];
    for (const def of defaults) {
      if (!merged.find((b) => b.id === def.id)) {
        merged.push(def);
      }
    }

    if (validBrokers.length !== parsed.filter(isValidBroker).length) {
      saveSavedBrokers(merged);
    }

    return merged;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return getDefaultBrokers();
  }
}

/** Persist saved brokers to localStorage */
export function saveSavedBrokers(brokers: SavedBroker[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(brokers));
  } catch {
    // localStorage may be full or unavailable — ignore for offline mode
  }
}

/** Add or update a broker profile */
export function upsertSavedBroker(broker: SavedBroker): SavedBroker[] {
  const brokers = loadSavedBrokers();
  const idx = brokers.findIndex((b) => b.id === broker.id);
  if (idx >= 0) brokers[idx] = broker;
  else brokers.push(broker);
  saveSavedBrokers(brokers);
  return brokers;
}

/** Delete a broker profile (prevents deletion of default brokers) */
export function deleteSavedBroker(id: string): SavedBroker[] {
  // Don't allow deletion of default brokers
  if (id.startsWith('default-')) {
    return loadSavedBrokers();
  }
  const brokers = loadSavedBrokers().filter((b) => b.id !== id);
  saveSavedBrokers(brokers);
  return brokers;
}

/** Export all saved brokers as a downloadable JSON file */
export function exportWorkspace(): void {
  const brokers = loadSavedBrokers();
  const payload: WorkspaceExport = {
    app: 'uns-sentinel-explorer',
    version: 1,
    exportedAt: new Date().toISOString(),
    brokers,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = EXPORT_FILENAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Import brokers from an uploaded JSON file. Returns imported brokers. */
export function importWorkspace(file: File): Promise<SavedBroker[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const brokers: SavedBroker[] = Array.isArray(parsed)
          ? parsed.filter(isValidBroker)
          : Array.isArray(parsed?.brokers)
            ? parsed.brokers.filter(isValidBroker)
            : [];
        // Merge with existing (dedupe by id, imported wins)
        const existing = loadSavedBrokers();
        const existingIds = new Set(existing.map((b) => b.id));
        const merged = [...existing, ...brokers.filter((b) => !existingIds.has(b.id))];
        saveSavedBrokers(merged);
        resolve(merged);
      } catch (err) {
        reject(new Error('Invalid workspace file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function isValidBroker(b: any): b is SavedBroker {
  return (
    b &&
    typeof b === 'object' &&
    typeof b.id === 'string' &&
    typeof b.name === 'string' &&
    typeof b.host === 'string' &&
    typeof b.port === 'number' &&
    (b.protocol === 'mqtt' || b.protocol === 'mqtts' || b.protocol === 'ws' || b.protocol === 'wss') &&
    typeof b.clientId === 'string' &&
    Array.isArray(b.subscriptions)
  );
}

/**
 * Default UNS subscription patterns used by all default brokers.
 * The ISA-95 pattern follows the standard hierarchy from the
 * `unified-namespace-schemas` repo:
 *   {enterprise}/{site}/{area}/{line}/{cell}/{asset}/{messageType}
 * The `#` wildcard captures all message types (asset, state, edge, alert).
 */
const DEFAULT_UNS_TOPICS: TopicSubscription[] = [
  { pattern: 'UnifiedNamespace/Plant/Plant-01/Utilities/CoolingSystem/PumpStation-A/PUMP-101/#', qos: 0 },
  { pattern: 'legacy/sensors/+/temp', qos: 0 },
  { pattern: '$SYS/#', qos: 0 },
];

/** Get default brokers that should always be available */
export function getDefaultBrokers(): SavedBroker[] {
  const clientId = () => `uns-explorer-${Math.random().toString(36).slice(2, 8)}`;
  return [
    {
      id: 'default-test-mosquitto',
      name: 'Mosquitto Public Broker',
      host: 'test.mosquitto.org',
      port: 1883,  // Standard MQTT port (backend Node.js connects directly)
      protocol: 'mqtt',
      connectionMode: 'gateway',
      clientId: clientId(),
      subscriptions: DEFAULT_UNS_TOPICS.map((s) => ({ ...s })),
      savedAt: Date.now(),
    },
    {
      id: 'default-mosquitto-ws',
      name: 'Mosquitto Public Broker (WebSocket)',
      host: 'test.mosquitto.org',
      port: 8081,  // Secure WebSocket port (WSS) — required when page is served over HTTPS
      protocol: 'wss',
      connectionMode: 'browser',
      clientId: clientId(),
      subscriptions: DEFAULT_UNS_TOPICS.map((s) => ({ ...s })),
      savedAt: Date.now(),
    },
    {
      id: 'default-emqx',
      name: 'EMQX Public Broker',
      host: 'broker.emqx.io',
      port: 8084,  // Secure WebSocket port (WSS) — required when page is served over HTTPS
      protocol: 'wss',
      connectionMode: 'browser',
      clientId: clientId(),
      subscriptions: DEFAULT_UNS_TOPICS.map((s) => ({ ...s })),
      savedAt: Date.now(),
    },
    {
      id: 'default-emqx-tcp',
      name: 'EMQX Public Broker (TCP)',
      host: 'broker.emqx.io',
      port: 1883,  // Standard MQTT port (backend Node.js connects directly)
      protocol: 'mqtt',
      connectionMode: 'gateway',
      clientId: clientId(),
      subscriptions: DEFAULT_UNS_TOPICS.map((s) => ({ ...s })),
      savedAt: Date.now(),
    },
    {
      id: 'default-hivemq',
      name: 'HiveMQ Public Broker',
      host: 'broker.hivemq.com',
      port: 8884,  // Secure WebSocket port (WSS) — required when page is served over HTTPS
      protocol: 'wss',
      connectionMode: 'browser',
      clientId: clientId(),
      subscriptions: DEFAULT_UNS_TOPICS.map((s) => ({ ...s })),
      savedAt: Date.now(),
    },
    {
      id: 'default-hivemq-tcp',
      name: 'HiveMQ Public Broker (TCP)',
      host: 'broker.hivemq.com',
      port: 1883,  // Standard MQTT port (backend Node.js connects directly)
      protocol: 'mqtt',
      connectionMode: 'gateway',
      clientId: clientId(),
      subscriptions: DEFAULT_UNS_TOPICS.map((s) => ({ ...s })),
      savedAt: Date.now(),
    },
    {
      id: 'default-eclipse',
      name: 'Eclipse Public Broker',
      host: 'mqtt.eclipseprojects.io',
      port: 443,  // Secure WebSocket port (works in browser mode on static hosting)
      protocol: 'wss',
      connectionMode: 'browser',
      clientId: clientId(),
      subscriptions: DEFAULT_UNS_TOPICS.map((s) => ({ ...s })),
      savedAt: Date.now(),
    },
    {
      id: 'default-eclipse-tcp',
      name: 'Eclipse Public Broker (TCP)',
      host: 'mqtt.eclipseprojects.io',
      port: 1883,  // Standard MQTT port (backend Node.js connects directly)
      protocol: 'mqtt',
      connectionMode: 'gateway',
      clientId: clientId(),
      subscriptions: DEFAULT_UNS_TOPICS.map((s) => ({ ...s })),
      savedAt: Date.now(),
    },
  ];
}
