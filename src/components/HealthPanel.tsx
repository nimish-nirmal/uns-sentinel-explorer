/**
 * Right Panel: Namespace Health & Analytics — system KPIs, throughput rate,
 * active subscription rule counts, and throughput sparkline.
 */
import { useMemo } from 'react';
import { Activity, Gauge, MessageSquare, Radio, FileJson2, ListChecks, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Session } from '../types';
import { countNodes, countPayloadNodes } from '../engine/topicTree';
import { formatBytes, formatNumber, formatRelativeTime } from '../lib/format';

interface HealthPanelProps {
  session: Session | null;
}

export function HealthPanel({ session }: HealthPanelProps) {
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
  const tree = useMemo(() => session?.tree ?? { 
    id: 'root', 
    name: 'UNS Namespace', 
    path: '', 
    type: 'legacy' as const, 
    children: new Map(), 
    isLeaf: false 
  }, [session?.tree]);

  const statusMessage = session?.statusMessage;

  const treeCounts = useMemo(() => ({
    nodes: countNodes(tree),
    payloads: countPayloadNodes(tree),
  }), [tree]);

  const statusConfig = {
    connected: { label: 'CONNECTED', color: 'text-emerald-400', dot: 'bg-emerald-400' },
    connecting: { label: 'CONNECTING', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
    disconnected: { label: 'DISCONNECTED', color: 'text-slate-500', dot: 'bg-slate-500' },
    error: { label: 'ERROR', color: 'text-red-400', dot: 'bg-red-400' },
  }[status];

  const disconnectReason = status === 'disconnected' || status === 'error' ? statusMessage : null;
  const throughput = stats.throughputHistory;
  const maxThroughput = Math.max(1, ...throughput);

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
        {/* Connection Card */}
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

        {/* KPI Grid */}
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

        {/* Throughput Sparkline */}
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

        {/* Subscribed Topics List */}
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

        {disconnectReason && (
          <div className="text-[10px] text-red-400 text-center pb-2">
            Reason: {disconnectReason}
          </div>
        )}

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