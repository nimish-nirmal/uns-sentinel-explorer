/**
 * Top Session Tab Bar — renders session tabs with live status indicators,
 * protocol badges, and global action buttons.
 */
import { Plus, Send, Settings2, Radio, X, RotateCcw, Activity } from 'lucide-react';
import type { Session } from '../types';

interface SessionBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onAddSession: () => void;
  onRemoveSession: (id: string) => void;
  onReconnect: (id: string) => void;
  onPublish: () => void;
  onSavedBrokers: () => void;
  onActiveSessions: () => void;
}

export function SessionBar({
  sessions,
  activeSessionId,
  onSelectSession,
  onAddSession,
  onRemoveSession,
  onReconnect,
  onPublish,
  onSavedBrokers,
  onActiveSessions,
}: SessionBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-base-900 border-b border-slate-800">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2 shrink-0">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/30 flex items-center justify-center">
          <Radio className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="leading-tight">
          <div className="text-xs font-bold text-slate-200 tracking-wide">UNS Sentinel Explorer</div>
          <div className="text-[10px] text-slate-500">Unified Namespace Dashboard</div>
        </div>
      </div>

      {/* Session tabs */}
      <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
        {sessions.map((session) => {
          const isActive = session.config.id === activeSessionId;
          const statusColor =
            session.status === 'connected'
              ? 'text-emerald-400'
              : session.status === 'connecting'
                ? 'text-amber-400'
                : session.status === 'error'
                  ? 'text-red-400'
                  : 'text-slate-500';
          const liveDot =
            session.status === 'connected'
              ? 'bg-emerald-400 animate-pulse'
              : session.status === 'connecting'
                ? 'bg-amber-400 animate-pulse'
                : 'bg-slate-600';

          return (
            <button
              key={session.config.id}
              onClick={() => onSelectSession(session.config.id)}
              className={[
                'group flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors shrink-0',
                'border',
                isActive
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                  : 'bg-base-850 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200',
              ].join(' ')}
            >
              <span className={`w-2 h-2 rounded-full ${liveDot}`} />
              <span className="font-semibold max-w-[120px] truncate">{session.config.name}</span>
              {session.status === 'connected' && (
                <span className={`badge-live ${statusColor}`}>● LIVE</span>
              )}
              <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-mono uppercase">
                {session.config.protocol}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onReconnect(session.config.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    onReconnect(session.config.id);
                  }
                }}
                className="text-slate-500 hover:text-cyan-400 transition-colors cursor-pointer"
                title="Reconnect session"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveSession(session.config.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    onRemoveSession(session.config.id);
                  }
                }}
                className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                title="Remove session"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            </button>
          );
        })}

        {/* Add session */}
        <button
          onClick={onAddSession}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-slate-400 border border-dashed border-slate-700 hover:border-cyan-500/50 hover:text-cyan-400 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Session
        </button>
      </div>

      {/* Global actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onActiveSessions} className="btn-ghost" title="View active backend sessions">
          <Activity className="w-3.5 h-3.5" />
          Active Sessions
        </button>
        <button onClick={onPublish} className="btn-emerald" title="Publish MQTT data">
          <Send className="w-3.5 h-3.5" />
          Publish
        </button>
        <button onClick={onSavedBrokers} className="btn-ghost" title="Saved broker profiles">
          <Settings2 className="w-3.5 h-3.5" />
          Saved Brokers
        </button>
      </div>
    </div>
  );
}