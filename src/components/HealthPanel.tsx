/**
 * Right Panel: Namespace Health & Analytics — system KPIs, throughput rate,
 * active subscription rule counts, and a mini throughput sparkline.
 */
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Gauge, MessageSquare, Radio, FileJson2, ListChecks, Clock, LineChart as LineChartIcon, ExternalLink, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import type { Session, TopicSubscription } from '../types';
import { countNodes, countPayloadNodes, collectNumericLeafs } from '../engine/topicTree';
import { formatBytes, formatNumber, formatRelativeTime } from '../lib/format';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';

interface HealthPanelProps {
  session: Session | null;
  selectedTelemetryKeys: Set<string>;
  /** Toggle a telemetry key on/off (used to remove tags from the trends chart) */
  onToggleTelemetryKey?: (key: string) => void;
}

interface TelemetrySeries {
  dataKey: string;
  label: string;
  color: string;
}

const CHART_COLORS = ['#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#f87171'];

export function HealthPanel({ session, selectedTelemetryKeys, onToggleTelemetryKey }: HealthPanelProps) {
  // All hooks MUST be called unconditionally - extract data first
  const stats = useMemo(() => session?.stats ?? { 
    messagesReceived: 0, 
    messagesPerSecond: 0, 
    bytesReceived: 0, 
    throughputHistory: [],
    lastMessageAt: undefined,
    connectedAt: undefined,
  }, [session?.stats]);
  const status = session?.status ?? 'disconnected';
  const config = useMemo(() => session?.config ?? { 
    id: '', 
    host: '', 
    port: 0, 
    protocol: 'ws' as const, 
    clientId: '', 
    subscriptions: [] 
  }, [session?.config]);
  const activeSubscriptions = session?.activeSubscriptions ?? [];
  const tree = session?.tree ?? { 
    id: 'root', 
    name: 'UNS Namespace', 
    path: '', 
    type: 'legacy' as const, 
    children: new Map(), 
    isLeaf: false 
  };
  const statusMessage = session?.statusMessage;

  // Now all hooks are called unconditionally
  const treeCounts = useMemo(() => ({
    nodes: countNodes(tree),
    payloads: countPayloadNodes(tree),
  }), [tree]);

  const [telemetryHistory, setTelemetryHistory] = useState<Array<{ time: string; [key: string]: number | string }>>([]);
  const [timeRange, setTimeRange] = useState(50);
  const pipWindowRef = useRef<Window | null>(null);

  const numericLeafs = useMemo(() => collectNumericLeafs(tree), [tree]);

  // Build available telemetry series from numeric leafs
  const availableSeries = useMemo<TelemetrySeries[]>(() => {
    const series: TelemetrySeries[] = [];
    numericLeafs.slice(0, 6).forEach((leaf, i) => {
      Object.entries(leaf.values).forEach(([key, value], j) => {
        if (typeof value === 'number') {
          const dataKey = `${leaf.path.replace(/\//g, '_')}_${key}`;
          const label = `${leaf.path.split('/').pop()}.${key}`;
          series.push({
            dataKey,
            label,
            color: CHART_COLORS[(i + j) % CHART_COLORS.length],
          });
        }
      });
    });
    return series;
  }, [numericLeafs]);

  useEffect(() => {
    if (!session || numericLeafs.length === 0) {
      setTelemetryHistory((prev) => (prev.length > 0 ? [] : prev));
      return;
    }

    const now = new Date().toLocaleTimeString();
    const sample: { time: string; [key: string]: number | string } = { time: now };
    const addedKeys = new Set<string>();

    numericLeafs.slice(0, 6).forEach((leaf) => {
      Object.entries(leaf.values).forEach(([key, value]) => {
        if (typeof value === 'number') {
          const pathKey = `${leaf.path.replace(/\//g, '_')}_${key}`;
          if (!addedKeys.has(pathKey)) {
            sample[pathKey] = value;
            addedKeys.add(pathKey);
          }
        }
      });
    });

    setTelemetryHistory((prev) => {
      // Skip appending if the last sample has identical values — this
      // prevents chart glitching/thrashing when brokers send repeated
      // messages with unchanged numeric payloads.
      const last = prev[prev.length - 1];
      if (last) {
        let same = true;
        for (const key of Object.keys(sample)) {
          if (key === 'time') continue;
          if (last[key] !== sample[key]) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      const next = [...prev, sample];
      return next.length > 100 ? next.slice(-100) : next;
    });
  }, [session?.config.id, session?.stats.lastMessageAt, numericLeafs]);

  // Match selected numeric attribute keys from the center panel against
  // namespace series by suffix — handles both plain keys ("temp") and
  // array/object paths like "d[0].value" or "sensors[2].temp".
  const visibleSeries = useMemo(() => availableSeries.filter((s) => {
    if (selectedTelemetryKeys.size === 0) return false;
    // Direct match on full dataKey
    if (selectedTelemetryKeys.has(s.dataKey)) return true;
    for (const selectedKey of selectedTelemetryKeys) {
      // Match if the selected key is a suffix of the series key path
      // e.g. selected "d[0].value" matches series "..._d[0].value"
      if (s.dataKey.endsWith(`_${selectedKey}`)) return true;
      // Match if selected key appears as a suffix of the label
      if (s.label.endsWith(selectedKey)) return true;
      // Fall back to bare last-segment match (e.g. "temp" matches "...temp")
      const bareKey = s.label.split('.').pop() ?? '';
      if (bareKey === selectedKey) return true;
    }
    return false;
  }), [availableSeries, selectedTelemetryKeys]);
  const visibleHistory = useMemo(() => telemetryHistory.slice(-timeRange), [telemetryHistory, timeRange]);

  /** Build the SVG chart HTML for the PIP window */
  const renderPipChart = useCallback((win: Window | null) => {
    if (!win || win.closed) return;
    const chartData = visibleHistory;
    const series = visibleSeries;

    // Compute chart dimensions
    const W = 820;
    const H = 480;
    const PAD_L = 60;
    const PAD_R = 20;
    const PAD_T = 30;
    const PAD_B = 50;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    // Compute min/max across all visible series
    let minVal = Infinity;
    let maxVal = -Infinity;
    chartData.forEach((d) => {
      series.forEach((s) => {
        const v = d[s.dataKey];
        if (typeof v === 'number') {
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
      });
    });
    if (!isFinite(minVal) || !isFinite(maxVal)) {
      minVal = 0;
      maxVal = 1;
    }
    const range = maxVal - minVal || 1;
    const pad = range * 0.1;
    minVal -= pad;
    maxVal += pad;

    const x = (i: number) => PAD_L + (i / Math.max(1, chartData.length - 1)) * plotW;
    const y = (v: number) => PAD_T + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

    // Build grid lines with axis labels
    const gridLines = [];
    const numGrid = 5;
    for (let g = 0; g <= numGrid; g++) {
      const gy = PAD_T + (g / numGrid) * plotH;
      const val = maxVal - (g / numGrid) * (maxVal - minVal);
      gridLines.push(`
        <line x1="${PAD_L}" y1="${gy}" x2="${W - PAD_R}" y2="${gy}" stroke="#1e293b" stroke-width="1" stroke-dasharray="4,4"/>
        <text x="${PAD_L - 8}" y="${gy + 3}" text-anchor="end" fill="#64748b" font-size="10">${val.toFixed(2)}</text>
      `);
    }

    // Build time labels
    const timeLabels = [];
    const labelCount = Math.min(6, chartData.length);
    for (let t = 0; t < labelCount; t++) {
      const idx = Math.round((t / Math.max(1, labelCount - 1)) * (chartData.length - 1));
      const tx = x(idx);
      timeLabels.push(`
        <text x="${tx}" y="${H - PAD_B + 20}" text-anchor="middle" fill="#64748b" font-size="10">${chartData[idx]?.time ?? ''}</text>
      `);
    }

    // Build series polylines
    const seriesPaths = series.map((s) => {
      const points = chartData
        .map((d, i) => {
          const v = d[s.dataKey];
          if (typeof v !== 'number') return null;
          return `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        })
        .filter(Boolean)
        .join(' ');
      return `
        <polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      `;
    }).join('');

    // Build legend (wrap into rows if many series)
    const legendItems = series.map((s, i) => `
      <rect x="${20 + (i % 4) * 200}" y="${10 + Math.floor(i / 4) * 18}" width="10" height="10" fill="${s.color}" rx="2"/>
      <text x="${34 + (i % 4) * 200}" y="${19 + Math.floor(i / 4) * 18}" fill="#94a3b8" font-size="11">${s.label}</text>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Telemetry Graph — UNS Sentinel Explorer</title>
          <style>
            body { margin: 0; padding: 0; background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
            .header { padding: 12px 20px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; }
            .title { color: #22d3ee; font-size: 13px; font-weight: 600; }
            .subtitle { color: #64748b; font-size: 11px; }
            .chart-wrap { padding: 20px; }
            .empty { color: #64748b; text-align: center; padding: 60px 20px; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="title">Telemetry Trends</div>
              <div class="subtitle" id="pip-subtitle">${session?.config.name ?? 'Session'} · ${chartData.length} samples · ${series.length} series · LIVE</div>
            </div>
            <div class="subtitle">UNS Sentinel Explorer</div>
          </div>
          <div class="chart-wrap">
            ${
              chartData.length === 0 || series.length === 0
                ? '<div class="empty">No telemetry data available yet. Select numeric attributes to plot.</div>'
                : `
                <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
                  <rect width="${W}" height="${H}" fill="#0f172a"/>
                  ${gridLines.join('')}
                  ${timeLabels.join('')}
                  ${seriesPaths}
                  ${legendItems}
                </svg>
                `
            }
          </div>
        </body>
      </html>
    `;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }, [visibleHistory, visibleSeries, session?.config.name]);

  /** Open a new live PIP window (or refresh existing one) */
  const togglePipWindow = useCallback(() => {
    // If already open, just focus it
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.focus();
      renderPipChart(pipWindowRef.current);
      return;
    }

    const newWindow = window.open('', '_blank', 'width=900,height=650');
    if (!newWindow) return;
    pipWindowRef.current = newWindow;

    // Render initial chart
    renderPipChart(newWindow);

    // Watch for window close to clear the ref
    const poll = setInterval(() => {
      if (newWindow.closed) {
        clearInterval(poll);
        if (pipWindowRef.current === newWindow) {
          pipWindowRef.current = null;
        }
      }
    }, 2000);
  }, [renderPipChart]);

  // Keep the PIP window live-updated whenever data or series change
  useEffect(() => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      renderPipChart(pipWindowRef.current);
    }
  }, [renderPipChart]);

  const statusConfig = {
    connected: { label: 'CONNECTED', color: 'text-emerald-400', dot: 'bg-emerald-400' },
    connecting: { label: 'CONNECTING', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
    disconnected: { label: 'DISCONNECTED', color: 'text-slate-500', dot: 'bg-slate-500' },
    error: { label: 'ERROR', color: 'text-red-400', dot: 'bg-red-400' },
  }[status];

  const disconnectReason = status === 'disconnected' || status === 'error' ? statusMessage : null;
  const throughput = stats.throughputHistory;
  const maxThroughput = Math.max(1, ...throughput);

  // Conditional rendering AFTER all hooks
  if (!session) {
    return (
      <div className="panel flex flex-col h-full overflow-hidden">
        <div className="panel-header">
          <span className="flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-emerald-400" />
            Namespace Health
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center text-center text-xs text-slate-600 px-6">
          <div>
            <Activity className="w-8 h-8 mx-auto mb-2 text-slate-700" />
            No active session.
            <br />
            Health & analytics will appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="panel-header">
        <span className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-emerald-400" />
          Namespace Health
        </span>
        <span className={`text-[10px] font-bold flex items-center gap-1 ${statusConfig.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
          {statusConfig.label}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Connection card */}
        <div className="rounded-md bg-base-950 border border-slate-800 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
            Broker Connection
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Host</span>
              <span className="font-mono text-slate-300 truncate max-w-[140px]" title={config.host}>
                {config.host}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Port</span>
              <span className="font-mono text-slate-300">{config.port}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Protocol</span>
              <span className="font-mono text-cyan-400 uppercase">{config.protocol}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Client ID</span>
              <span className="font-mono text-slate-300 truncate max-w-[140px]" title={config.clientId}>
                {config.clientId}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Connected At</span>
              <span className="font-mono text-slate-300">
                {stats.connectedAt ? new Date(stats.connectedAt).toLocaleTimeString() : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-2">
          <KpiCard
            icon={<MessageSquare className="w-3.5 h-3.5 text-cyan-400" />}
            label="Messages"
            value={formatNumber(stats.messagesReceived)}
            sub={formatBytes(stats.bytesReceived)}
          />
          <KpiCard
            icon={<Clock className="w-3.5 h-3.5 text-emerald-400" />}
            label="Throughput"
            value={`${stats.messagesPerSecond}/s`}
            sub="msg/sec"
          />
          <KpiCard
            icon={<FileJson2 className="w-3.5 h-3.5 text-amber-400" />}
            label="Tree Nodes"
            value={formatNumber(treeCounts.nodes)}
            sub={`${treeCounts.payloads} with payload`}
          />
          <KpiCard
            icon={<ListChecks className="w-3.5 h-3.5 text-fuchsia-400" />}
            label="Sub Rules"
            value={formatNumber(activeSubscriptions.length)}
            sub={`${config.subscriptions.length} configured`}
          />
        </div>

        {/* Throughput sparkline */}
        <div className="rounded-md bg-base-950 border border-slate-800 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Throughput (msg/sec)
            </div>
            <Radio className="w-3 h-3 text-emerald-400" />
          </div>
          <div className="h-16 flex items-end gap-[2px]">
            {throughput.length === 0 ? (
              <div className="text-[10px] text-slate-600 w-full text-center pb-4">
                Waiting for traffic…
              </div>
            ) : (
              throughput.map((v, i) => (
                <div
                  key={i}
                  className="flex-1 bg-emerald-500/40 hover:bg-emerald-500/70 transition-colors rounded-t"
                  style={{
                    height: `${Math.max(6, (v / maxThroughput) * 100)}%`,
                  }}
                  title={`${v} msg/s`}
                />
              ))
            )}
          </div>
        </div>

        {/* Telemetry graphs */}
        {availableSeries.length > 0 && (
          <div className="rounded-md bg-base-950 border border-slate-800 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <LineChartIcon className="w-3 h-3 text-cyan-400" />
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Telemetry Trends
                </div>
              </div>
              <div className="flex items-center gap-1">
                <select
                  value={timeRange}
                  className="text-[9px] bg-base-900 border border-slate-700 text-slate-300 rounded px-1 py-0.5"
                  onChange={(e) => setTimeRange(Number(e.target.value))}
                >
                  <option value={20}>Last 20</option>
                  <option value={50}>Last 50</option>
                  <option value={100}>Last 100</option>
                </select>
                <button
                  onClick={togglePipWindow}
                  className="text-[9px] bg-base-900 border border-slate-700 text-slate-300 rounded px-1.5 py-0.5 hover:bg-slate-800"
                  title="Open in new window (PIP mode)"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Selected series display (controlled from center panel numeric attributes) */}
            <div className="flex flex-wrap gap-1 mb-2">
              {visibleSeries.length > 0 ? (
                visibleSeries.map((s) => (
                  <span
                    key={s.dataKey}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors bg-cyan-500/15 text-cyan-300"
                    style={{ borderColor: s.color + '80' }}
                  >
                    {s.label}
                    {onToggleTelemetryKey && (
                      <button
                        onClick={() => {
                          // The selectedTelemetryKeys set stores bare keys (e.g. "temp"),
                          // not the full dataKey path. Use the last label segment so the
                          // removal matches what PayloadViewer toggled on.
                          const bareKey = s.label.split('.').pop() ?? s.dataKey;
                          onToggleTelemetryKey(bareKey);
                        }}
                        className="text-cyan-400/70 hover:text-red-400 transition-colors"
                        title={`Remove ${s.label} from trends`}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </span>
                ))
              ) : (
                <span className="text-[9px] text-slate-600">
                  Select numeric attributes from a topic in the center panel to plot trends
                </span>
              )}
            </div>

            <div className="h-40">
              {visibleSeries.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[10px] text-slate-600">
                  Select at least one series to plot
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={visibleHistory} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fill: '#64748b', fontSize: 8 }} 
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: '#64748b', fontSize: 8 }} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: 6,
                        fontSize: 10,
                      }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 9 }} />
                    {visibleSeries.map((s) => (
                      <Line
                        key={s.dataKey}
                        type="monotone"
                        dataKey={s.dataKey}
                        stroke={s.color}
                        dot={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                        name={s.label}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {/* Subscriptions list */}
        <div className="rounded-md bg-base-950 border border-slate-800 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
            Subscribed Topics ({config.subscriptions.length})
          </div>
          <div className="space-y-1">
            {config.subscriptions.length === 0 ? (
              <div className="text-[10px] text-slate-600">No subscriptions configured…</div>
            ) : (
              config.subscriptions.map((sub, i) => {
                const statusIcon = sub.status === 'subscribed' ? (
                  <span title="Subscribed">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  </span>
                ) : sub.status === 'error' ? (
                  <span title={`Error: ${sub.errorMessage || 'Unknown'}`}>
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                  </span>
                ) : (
                  <span className="w-3 h-3 rounded-full bg-slate-700 shrink-0" title="Pending" />
                );
                return (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {statusIcon}
                      <span className="font-mono text-[10px] text-cyan-400 truncate">{sub.pattern}</span>
                    </div>
                    <span className="text-[9px] px-1 py-px rounded bg-slate-800 text-slate-500 shrink-0">
                      QoS {sub.qos}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Disconnect reason */}
        {disconnectReason && (
          <div className="text-[10px] text-red-400 text-center pb-2">
            Reason: {disconnectReason}
          </div>
        )}

        {/* Last update */}
        <div className="text-[10px] text-slate-600 text-center pb-2">
          Last message {stats.lastMessageAt ? formatRelativeTime(stats.lastMessageAt) : '—'} · Session{' '}
          {(config.id || '').slice(0, 12)}…
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md bg-base-950 border border-slate-800 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
      </div>
      <div className="text-lg font-bold text-slate-100 leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}