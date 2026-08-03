/**
 * Multi-Topic Connection Modal — inputs for broker connection details and
 * multiple subscription patterns. Saves to localStorage on connect.
 */
import { useEffect, useState } from 'react';
import { X, Plug, Save, Eye, EyeOff } from 'lucide-react';
import type { BrokerConfig, TopicSubscription } from '../../types';
import { generateBrokerId, parseSubscriptionPatterns } from '../../engine/mqttEngine';

interface BrokerConfigModalProps {
  open: boolean;
  initial?: BrokerConfig | null;
  onClose: () => void;
  onConnect: (config: BrokerConfig, save: boolean) => void;
}

const DEFAULT_TOPICS = ['Enterprise/Site1/Area1/Line1/Cell1/#', 'legacy/sensors/+/temp', '$SYS/#'];
const DEFAULT_PORTS = {
  mqtt: 1883,   // Standard MQTT port
  mqtts: 8883,  // Secure MQTT port
  ws: 8080,     // WebSocket port
  wss: 8084,    // Secure WebSocket port
} as const;

export function BrokerConfigModal({ open, initial, onClose, onConnect }: BrokerConfigModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [protocol, setProtocol] = useState<'mqtt' | 'mqtts' | 'ws' | 'wss'>(initial?.protocol ?? 'ws');
  const [host, setHost] = useState(initial?.host ?? 'test.mosquitto.org');
  const [port, setPort] = useState(initial?.port ?? DEFAULT_PORTS.ws);
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState(initial?.password ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [topicsText, setTopicsText] = useState(
    initial?.subscriptions?.map((s) => s.pattern).join('\n') ?? DEFAULT_TOPICS.join('\n')
  );
  const [qos, setQos] = useState<0 | 1 | 2>(0);
  const [save, setSave] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectUnauthorized, setRejectUnauthorized] = useState(initial?.rejectUnauthorized ?? false);
  const [caCert, setCaCert] = useState(initial?.caCert ?? '');
  const [clientCert, setClientCert] = useState(initial?.clientCert ?? '');
  const [clientKey, setClientKey] = useState(initial?.clientKey ?? '');

  useEffect(() => {
    if (!open) return;

    setName(initial?.name ?? '');
    setProtocol(initial?.protocol ?? 'mqtt');
    setHost(initial?.host ?? '');
    setPort(initial?.port ?? DEFAULT_PORTS[initial?.protocol ?? 'mqtt']);
    setClientId(initial?.clientId ?? '');
    setUsername(initial?.username ?? '');
    setPassword(initial?.password ?? '');
    setShowPassword(false);
    setTopicsText(initial?.subscriptions?.map((s) => s.pattern).join('\n') ?? DEFAULT_TOPICS.join('\n'));
    setQos(0);
    setSave(true);
    setError(null);
    setRejectUnauthorized(initial?.rejectUnauthorized ?? false);
    setCaCert(initial?.caCert ?? '');
    setClientCert(initial?.clientCert ?? '');
    setClientKey(initial?.clientKey ?? '');
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleConnect();
  };

  const handleConnect = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    
    setError(null);
    if (!host.trim()) {
      setError('Host is required');
      return;
    }
    if (!port || port < 1 || port > 65535) {
      setError('Port must be between 1 and 65535');
      return;
    }
    
    // Port validation - just warn, don't block
    const expectedPorts: Record<string, number[]> = {
      mqtt: [1883],
      mqtts: [8883],
      ws: [8080, 8083],
      wss: [8084, 443],
    };
    const expected = expectedPorts[protocol] || [];
    if (expected.length > 0 && !expected.includes(port)) {
      console.warn(`Port ${port} may not match ${protocol.toUpperCase()} protocol. Expected: ${expected.join('/')}`);
    }
    const subscriptions: TopicSubscription[] = parseSubscriptionPatterns(
      topicsText.split('\n'),
      qos
    );
    if (subscriptions.length === 0) {
      setError('At least one valid topic pattern is required');
      return;
    }

    const config: BrokerConfig = {
      id: initial?.id ?? generateBrokerId(),
      name: name.trim() || host.trim(),
      host: host.trim(),
      port,
      protocol,
      clientId: clientId.trim() || `uns-explorer-${Math.random().toString(36).slice(2, 8)}`,
      username: username.trim() || undefined,
      password: password.trim() || undefined,
      subscriptions,
      rejectUnauthorized: rejectUnauthorized || undefined,
      caCert: caCert.trim() || undefined,
      clientCert: clientCert.trim() || undefined,
      clientKey: clientKey.trim() || undefined,
    };
    onConnect(config, save);
    onClose();
  };

  const handleProtocolChange = (p: 'mqtt' | 'mqtts' | 'ws' | 'wss') => {
    setProtocol(p);
    setPort(DEFAULT_PORTS[p]);
  };

  // Modal shell
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel w-[560px] max-h-[85vh] overflow-y-auto animate-fade-in">
        <div className="panel-header">
          <span className="flex items-center gap-2">
            <Plug className="w-3.5 h-3.5 text-cyan-400" />
            {initial ? 'Edit Session' : 'New Broker Connection'}
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Protocol selector */}
          <div>
            <label className="label">Protocol</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleProtocolChange('wss')}
                className={[
                  'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                  protocol === 'wss'
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                    : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                ].join(' ')}
              >
                WSS (Secure WebSocket)
              </button>
              <button
                onClick={() => handleProtocolChange('ws')}
                className={[
                  'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                  protocol === 'ws'
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                    : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                ].join(' ')}
              >
                WS (Plain WebSocket)
              </button>
              <button
                onClick={() => handleProtocolChange('mqtts')}
                className={[
                  'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                  protocol === 'mqtts'
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                    : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                ].join(' ')}
              >
                MQTTS (Secure) — uses WSS
              </button>
              <button
                onClick={() => handleProtocolChange('mqtt')}
                className={[
                  'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                  protocol === 'mqtt'
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                    : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                ].join(' ')}
              >
                MQTT (Plain) — uses WS
              </button>
            </div>
          </div>

          {/* Connection details */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Session Label</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Factory UNS"
              />
            </div>
            <div>
              <label className="label">Host</label>
              <input
                className="input"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="broker.emqx.io"
              />
            </div>
            <div>
              <label className="label">Port</label>
              <input
                className="input"
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                placeholder={protocol === 'wss' ? '8084' : '8083'}
              />
            </div>
            <div className="col-span-2">
              <label className="label">Client ID</label>
              <input
                className="input"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="auto-generated if empty"
              />
            </div>
            <div>
              <label className="label">Username</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  className="input pr-9"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="optional"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-400 transition-colors"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* TLS/Certificate options */}
          {(protocol === 'wss' || protocol === 'mqtts') && (
            <div className="rounded-md bg-base-950 border border-slate-800 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                TLS/Certificate Options
              </div>
              <label className="label flex items-center gap-1.5 mb-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rejectUnauthorized}
                  onChange={(e) => setRejectUnauthorized(e.target.checked)}
                  className="accent-cyan-500"
                />
                <span className="text-xs text-slate-300">Skip server certificate validation (rejectUnauthorized=false)</span>
              </label>
              <div>
                <label className="label">CA Certificate Path (optional)</label>
                <input
                  className="input"
                  value={caCert}
                  onChange={(e) => setCaCert(e.target.value)}
                  placeholder="/path/to/ca.crt"
                />
              </div>
              <div>
                <label className="label">Client Certificate Path (optional)</label>
                <input
                  className="input"
                  value={clientCert}
                  onChange={(e) => setClientCert(e.target.value)}
                  placeholder="/path/to/client.crt"
                />
              </div>
              <div>
                <label className="label">Client Key Path (optional)</label>
                <input
                  className="input"
                  value={clientKey}
                  onChange={(e) => setClientKey(e.target.value)}
                  placeholder="/path/to/client.key"
                />
              </div>
            </div>
          )}

          {/* Multi-topic subscriptions */}
          <div>
            <label className="label">
              Subscription Patterns <span className="text-slate-600">(one per line)</span>
            </label>
            <textarea
              className="input font-mono text-xs h-28 resize-y leading-relaxed"
              value={topicsText}
              onChange={(e) => setTopicsText(e.target.value)}
              placeholder={'Enterprise/Site1/Area1/Line1/Cell1/#\nlegacy/sensors/+/temp\n$SYS/#'}
              spellCheck={false}
            />
            <div className="flex items-center gap-3 mt-2">
              <label className="label flex items-center gap-1.5 mb-0 cursor-pointer">
                QoS
                <select
                  value={qos}
                  onChange={(e) => setQos(Number(e.target.value) as 0 | 1 | 2)}
                  className="input !w-20 !py-1"
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
              <label className="label flex items-center gap-1.5 mb-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={save}
                  onChange={(e) => setSave(e.target.checked)}
                  className="accent-cyan-500"
                />
                Save to local storage
              </label>
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              <Plug className="w-3.5 h-3.5" />
              {initial ? 'Update & Reconnect' : 'Connect Session'}
            </button>
            {initial && (
              <button
                type="button"
                onClick={() => {
                  // Save Only - just save to localStorage, don't connect
                  const config: BrokerConfig = {
                    id: initial.id,
                    name: name.trim() || host.trim(),
                    host: host.trim(),
                    port,
                    protocol,
                    clientId: clientId.trim() || `uns-explorer-${Math.random().toString(36).slice(2, 8)}`,
                    username: username.trim() || undefined,
                    password: password.trim() || undefined,
                    subscriptions: parseSubscriptionPatterns(topicsText.split('\n'), qos),
                    rejectUnauthorized: rejectUnauthorized || undefined,
                    caCert: caCert.trim() || undefined,
                    clientCert: clientCert.trim() || undefined,
                    clientKey: clientKey.trim() || undefined,
                  };
                  // Call onConnect with save=true but don't actually connect
                  // The parent component will handle saving without connecting
                  onConnect(config, true);
                  onClose();
                }}
                className="btn-emerald"
              >
                <Save className="w-3.5 h-3.5" />
                Save Only
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
