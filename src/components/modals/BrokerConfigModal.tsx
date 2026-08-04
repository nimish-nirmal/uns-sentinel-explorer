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

const DEFAULT_TOPICS = ['UnifiedNamespace/Plant/Plant-01/Utilities/CoolingSystem/PumpStation-A/PUMP-101/#', 'legacy/sensors/+/temp', '$SYS/#'];
const DEFAULT_PORTS = {
  mqtt: 1883,   // Standard MQTT port
  mqtts: 8883,  // Secure MQTT port
  ws: 8080,     // WebSocket port (insecure — blocked on HTTPS pages!)
  wss: 8084,    // Secure WebSocket port
} as const;

export function BrokerConfigModal({ open, initial, onClose, onConnect }: BrokerConfigModalProps) {
  /** Whether the page is served over HTTPS — if so, ws:// connections are blocked by the browser */
  const pageIsHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  // If the page is HTTPS and no protocol was specified, default to WSS (browser mode)
  const defaultProtocol: 'mqtt' | 'mqtts' | 'ws' | 'wss' = pageIsHttps ? 'wss' : 'ws';
  const [name, setName] = useState(initial?.name ?? '');
  const [protocol, setProtocol] = useState<'mqtt' | 'mqtts' | 'ws' | 'wss'>(initial?.protocol ?? defaultProtocol);
  const [host, setHost] = useState(initial?.host ?? 'test.mosquitto.org');
  const [port, setPort] = useState(initial?.port ?? DEFAULT_PORTS[defaultProtocol]);
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [protocolVersion, setProtocolVersion] = useState<3 | 4 | 5>(initial?.protocolVersion ?? 4);
  const [connectTimeout, setConnectTimeout] = useState(initial?.connectTimeout ?? 10);
  const [keepAlive, setKeepAlive] = useState(initial?.keepAlive ?? 60);
  const [autoReconnect, setAutoReconnect] = useState(initial?.autoReconnect ?? true);
  const [cleanSession, setCleanSession] = useState(initial?.cleanSession ?? true);
  const [sessionExpiryInterval, setSessionExpiryInterval] = useState(initial?.sessionExpiryInterval ?? 0);
  const [receiveMaximum, setReceiveMaximum] = useState(initial?.receiveMaximum ?? 65535);
  const [maximumPacketSize, setMaximumPacketSize] = useState(initial?.maximumPacketSize ?? 0);
  const [topicAliasMaximum, setTopicAliasMaximum] = useState(initial?.topicAliasMaximum ?? 0);
  const [requestResponseInfo, setRequestResponseInfo] = useState(initial?.requestResponseInfo ?? false);
  const [requestProblemInfo, setRequestProblemInfo] = useState(initial?.requestProblemInfo ?? false);
  const [connectionMode, setConnectionMode] = useState<'gateway' | 'browser'>(initial?.connectionMode ?? 'gateway');
  const [anonymous, setAnonymous] = useState(true);

  useEffect(() => {
    if (!open) return;

    setName(initial?.name ?? '');
    // When no initial config and page is HTTPS, default to WSS so browser-mode
    // connections aren't blocked by the browser's Mixed Content policy.
    const effectiveDefaultProtocol = initial?.protocol ?? (pageIsHttps ? 'wss' : 'mqtt');
    setProtocol(effectiveDefaultProtocol);
    setHost(initial?.host ?? '');
    setPort(initial?.port ?? DEFAULT_PORTS[effectiveDefaultProtocol]);
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
    setShowAdvanced(true);
    setProtocolVersion(initial?.protocolVersion ?? 4);
    setConnectTimeout(initial?.connectTimeout ?? 10);
    setKeepAlive(initial?.keepAlive ?? 60);
    setAutoReconnect(initial?.autoReconnect ?? true);
    setCleanSession(initial?.cleanSession ?? true);
    setSessionExpiryInterval(initial?.sessionExpiryInterval ?? 0);
    setReceiveMaximum(initial?.receiveMaximum ?? 65535);
    setMaximumPacketSize(initial?.maximumPacketSize ?? 0);
    setTopicAliasMaximum(initial?.topicAliasMaximum ?? 0);
    setRequestResponseInfo(initial?.requestResponseInfo ?? false);
    setRequestProblemInfo(initial?.requestProblemInfo ?? false);
    setConnectionMode(initial?.connectionMode ?? 'gateway');
    // Default to anonymous if no username/password in initial config
    setAnonymous(!initial?.username && !initial?.password);
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleConnect(e);
  };

  const handleConnect = (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
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
      username: anonymous ? undefined : username.trim() || undefined,
      password: anonymous ? undefined : password.trim() || undefined,
      subscriptions,
      connectionMode,
      protocolVersion,
      connectTimeout,
      keepAlive,
      autoReconnect,
      cleanSession,
      sessionExpiryInterval: sessionExpiryInterval || undefined,
      receiveMaximum: receiveMaximum || undefined,
      maximumPacketSize: maximumPacketSize || undefined,
      topicAliasMaximum: topicAliasMaximum || undefined,
      requestResponseInfo,
      requestProblemInfo,
      rejectUnauthorized: rejectUnauthorized || undefined,
      caCert: caCert.trim() || undefined,
      clientCert: clientCert.trim() || undefined,
      clientKey: clientKey.trim() || undefined,
    };
    onConnect(config, save);
    onClose();
  };

  const handleProtocolChange = (p: 'mqtt' | 'mqtts' | 'ws' | 'wss') => {
    // Warn when selecting insecure WS on an HTTPS page — the browser will block it
    if (pageIsHttps && p === 'ws' && connectionMode === 'browser') {
      console.warn('[BrokerConfig] WS is blocked on HTTPS pages — consider using WSS instead.');
    }
    setProtocol(p);
    setPort(DEFAULT_PORTS[p]);
  };

  // Modal shell
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel w-[1100px] max-h-[95vh] overflow-y-auto animate-fade-in">
        <div className="panel-header">
          <span className="flex items-center gap-2">
            <Plug className="w-3.5 h-3.5 text-cyan-400" />
            {initial ? 'Edit Session' : 'New Broker Connection'}
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-12 gap-4">
            {/* LEFT COLUMN */}
            <div className="col-span-3 space-y-3">
              {/* Connection Mode - Vertical buttons */}
              <div>
                <label className="label">Connection Mode</label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => setConnectionMode('gateway')}
                    className={[
                      'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                      connectionMode === 'gateway'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                        : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                    ].join(' ')}
                  >
                    Backend Gateway
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectionMode('browser')}
                    className={[
                      'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                      connectionMode === 'browser'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                        : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                    ].join(' ')}
                  >
                    Direct Browser
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  {connectionMode === 'gateway' 
                    ? 'Routes through Node.js backend. Supports raw TCP (1883/8883) and self-signed TLS.'
                    : 'Connects directly via mqtt.js in browser. Use with WebSocket brokers (8083/8084).'}
                </p>
              </div>

              {/* Protocol - Vertical buttons */}
              <div>
                <label className="label">Protocol</label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => handleProtocolChange('mqtt')}
                    className={[
                      'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                      protocol === 'mqtt'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                        : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                    ].join(' ')}
                  >
                    MQTT (Plain TCP)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleProtocolChange('mqtts')}
                    className={[
                      'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                      protocol === 'mqtts'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                        : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                    ].join(' ')}
                  >
                    MQTTS (Secure TCP)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleProtocolChange('ws')}
                    className={[
                      'px-3 py-2 rounded-md text-sm font-semibold border transition-colors',
                      protocol === 'ws'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                        : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                    ].join(' ')}
                  >
                    WS (WebSocket)
                  </button>
                  <button
                    type="button"
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
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  MQTT/MQTTS = raw TCP (1883/8883). WS/WSS = WebSocket (8080/8084).
                  {pageIsHttps && (
                    <span className="text-amber-400/80 block mt-1">
                      ⚠️ This page is served over HTTPS — use WSS for browser connections (WS is blocked).
                    </span>
                  )}
                </p>
                <div className="mt-2 rounded-md bg-base-950 border border-slate-800 p-2 text-[10px] text-slate-500">
                  <div className="font-semibold text-slate-400 mb-1">Common Broker Ports:</div>
                  <div className="grid grid-cols-2 gap-1">
                    <div>MQTT: 1883 (TCP)</div>
                    <div>MQTTS: 8883 (TLS/TCP)</div>
                    <div>WS: 8080/8083/8000</div>
                    <div>WSS: 8084/8884</div>
                  </div>
                  <div className="mt-1 text-slate-600">* WebSocket ports vary by broker (EMQX: 8083, HiveMQ: 8000, Mosquitto: 8080) — WSS versions: Mosquitto 8081, EMQX 8084, HiveMQ 8884</div>
                </div>
              </div>

              {/* QoS + Save */}
              <div>
                <label className="label">QoS</label>
                <div className="flex items-center gap-3">
                  <select
                    value={qos}
                    onChange={(e) => setQos(Number(e.target.value) as 0 | 1 | 2)}
                    className="input !w-20 !py-1.5"
                  >
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                  <label className="label flex items-center gap-1 mb-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={save}
                      onChange={(e) => setSave(e.target.checked)}
                      className="accent-cyan-500"
                    />
                    <span className="text-xs text-slate-300">Save</span>
                  </label>
                </div>
              </div>
            </div>

            {/* MIDDLE COLUMN */}
            <div className="col-span-5 space-y-3">
              {/* Session Label */}
              <div>
                <label className="label">Session Label</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Factory UNS"
                />
              </div>

              {/* Host + Port */}
              <div className="grid grid-cols-2 gap-2">
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
              </div>

              {/* Client ID */}
              <div>
                <label className="label">Client ID</label>
                <input
                  className="input"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="auto-generated if empty"
                />
              </div>

              {/* Anonymous toggle */}
              <div>
                <label className="label flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={anonymous}
                    onChange={(e) => setAnonymous(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  <span className="text-xs text-slate-300">Anonymous (no authentication)</span>
                </label>
                {!anonymous && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label">Username</label>
                      <input
                        className="input"
                        autoComplete="username"
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
                )}
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
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="label">CA Certificate</label>
                      <input
                        className="input"
                        value={caCert}
                        onChange={(e) => setCaCert(e.target.value)}
                        placeholder="/path/to/ca.crt"
                      />
                    </div>
                    <div>
                      <label className="label">Client Certificate</label>
                      <input
                        className="input"
                        value={clientCert}
                        onChange={(e) => setClientCert(e.target.value)}
                        placeholder="/path/to/client.crt"
                      />
                    </div>
                    <div>
                      <label className="label">Client Key</label>
                      <input
                        className="input"
                        value={clientKey}
                        onChange={(e) => setClientKey(e.target.value)}
                        placeholder="/path/to/client.key"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Advanced Section */}
              <div className="rounded-md bg-base-950 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <span className="font-semibold uppercase tracking-wider">Advanced</span>
                  <span className="text-slate-600">{showAdvanced ? '▼' : '▶'}</span>
                </button>
                {showAdvanced && (
                  <div className="px-3 pb-3 space-y-2">
                    <div>
                      <label className="label text-[10px]">MQTT Version</label>
                      <select
                        value={protocolVersion}
                        onChange={(e) => setProtocolVersion(Number(e.target.value) as 3 | 4 | 5)}
                        className="input !text-xs"
                      >
                        <option value={3}>3.1</option>
                        <option value={4}>3.1.1</option>
                        <option value={5}>5.0</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label text-[10px]">Timeout (s)</label>
                        <input
                          className="input !text-xs"
                          type="number"
                          value={connectTimeout}
                          onChange={(e) => setConnectTimeout(Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <label className="label text-[10px]">Keep Alive (s)</label>
                        <input
                          className="input !text-xs"
                          type="number"
                          value={keepAlive}
                          onChange={(e) => setKeepAlive(Number(e.target.value))}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="label flex items-center gap-1 mb-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoReconnect}
                          onChange={(e) => setAutoReconnect(e.target.checked)}
                          className="accent-cyan-500"
                        />
                        <span className="text-[10px] text-slate-300">Auto Reconnect</span>
                      </label>
                      <label className="label flex items-center gap-1 mb-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cleanSession}
                          onChange={(e) => setCleanSession(e.target.checked)}
                          className="accent-cyan-500"
                        />
                        <span className="text-[10px] text-slate-300">Clean Session</span>
                      </label>
                    </div>

                    {protocolVersion === 5 && (
                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                          MQTT 5.0
                        </div>
                        <div>
                          <label className="label text-[10px]">Session Expiry (s)</label>
                          <input
                            className="input !text-xs"
                            type="number"
                            value={sessionExpiryInterval}
                            onChange={(e) => setSessionExpiryInterval(Number(e.target.value))}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="label text-[10px]">Receive Max</label>
                            <input
                              className="input !text-xs"
                              type="number"
                              value={receiveMaximum}
                              onChange={(e) => setReceiveMaximum(Number(e.target.value))}
                            />
                          </div>
                          <div>
                            <label className="label text-[10px]">Packet Size</label>
                            <input
                              className="input !text-xs"
                              type="number"
                              value={maximumPacketSize}
                              onChange={(e) => setMaximumPacketSize(Number(e.target.value))}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="label text-[10px]">Topic Alias Max</label>
                          <input
                            className="input !text-xs"
                            type="number"
                            value={topicAliasMaximum}
                            onChange={(e) => setTopicAliasMaximum(Number(e.target.value))}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="label flex items-center gap-1 mb-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={requestResponseInfo}
                              onChange={(e) => setRequestResponseInfo(e.target.checked)}
                              className="accent-cyan-500"
                            />
                            <span className="text-[10px] text-slate-300">Response Info</span>
                          </label>
                          <label className="label flex items-center gap-1 mb-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={requestProblemInfo}
                              onChange={(e) => setRequestProblemInfo(e.target.checked)}
                              className="accent-cyan-500"
                            />
                            <span className="text-[10px] text-slate-300">Problem Info</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN - Subscriptions */}
            <div className="col-span-4 flex flex-col">
              <label className="label text-xs">
                Subscription Patterns <span className="text-slate-600">(one per line)</span>
              </label>
              <textarea
                className="input font-mono text-xs flex-1 min-h-[320px] resize-y leading-relaxed"
                value={topicsText}
                onChange={(e) => setTopicsText(e.target.value)}
                placeholder={'UnifiedNamespace/Plant/Plant-01/Utilities/CoolingSystem/PumpStation-A/PUMP-101/#\nlegacy/sensors/+/temp\n$SYS/#'}
                spellCheck={false}
              />
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
                    username: anonymous ? undefined : username.trim() || undefined,
                    password: anonymous ? undefined : password.trim() || undefined,
                    subscriptions: parseSubscriptionPatterns(topicsText.split('\n'), qos),
                    connectionMode,
                    protocolVersion,
                    connectTimeout,
                    keepAlive,
                    autoReconnect,
                    cleanSession,
                    sessionExpiryInterval: sessionExpiryInterval || undefined,
                    receiveMaximum: receiveMaximum || undefined,
                    maximumPacketSize: maximumPacketSize || undefined,
                    topicAliasMaximum: topicAliasMaximum || undefined,
                    requestResponseInfo,
                    requestProblemInfo,
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