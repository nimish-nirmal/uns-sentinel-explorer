/**
 * Active Sessions Modal — shows all active backend MQTT sessions
 * with the ability to forcefully close them.
 */
import { useEffect, useState } from 'react';
import { X, Activity, Trash2, RefreshCw, Server, Clock, Wifi } from 'lucide-react';
import { getGatewayUrl } from '../../lib/config';

interface BackendSession {
  id: string;
  host: string;
  port: number;
  protocol: string;
  topics: string[];
  connectedAt: number;
}

interface ActiveSessionsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ActiveSessionsModal({ open, onClose }: ActiveSessionsModalProps) {
  const [sessions, setSessions] = useState<BackendSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${getGatewayUrl()}/api/broker/sessions`);
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const forceCloseSession = async (sessionId: string) => {
    try {
      await fetch(`${getGatewayUrl()}/api/broker/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      // Refresh the list
      fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close session');
    }
  };

  useEffect(() => {
    if (open) {
      fetchSessions();
    }
  }, [open]);

  if (!open) return null;

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const formatDuration = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel w-[640px] max-h-[80vh] overflow-y-auto animate-fade-in">
        <div className="panel-header">
          <span className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            Active Backend Sessions
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchSessions}
              className="text-slate-500 hover:text-cyan-400 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Summary */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {sessions.length} active session{sessions.length !== 1 ? 's' : ''} on backend
            </span>
            <span className="flex items-center gap-1">
              <Server className="w-3 h-3" />
              {getGatewayUrl()}
            </span>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              {error}
            </div>
          )}

          {loading && sessions.length === 0 ? (
            <div className="text-center py-8 text-slate-600 text-xs">
              <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin text-slate-700" />
              Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-slate-600 text-xs">
              <Activity className="w-8 h-8 mx-auto mb-2 text-slate-700" />
              No active backend sessions.
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-md bg-base-950 border border-slate-800 p-3 space-y-2"
                >
                  {/* Session header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-mono text-slate-300">{session.id}</span>
                    </div>
                    <button
                      onClick={() => forceCloseSession(session.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 hover:bg-red-500/10 border border-red-500/30 transition-colors"
                      title="Forcefully close this session"
                    >
                      <Trash2 className="w-3 h-3" />
                      Force Close
                    </button>
                  </div>

                  {/* Session details */}
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Wifi className="w-3 h-3 text-cyan-500" />
                      <span className="text-slate-400">{session.protocol}://</span>
                      <span className="text-slate-300 font-mono">{session.host}</span>
                      <span className="text-slate-400">:{session.port}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-slate-600" />
                      <span>Connected {formatDuration(session.connectedAt)} ago</span>
                    </div>
                  </div>

                  {/* Topics */}
                  <div className="flex flex-wrap gap-1">
                    {session.topics.map((topic, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-400 border border-slate-700"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <span className="text-[10px] text-slate-600">
              These are MQTT connections maintained by the backend gateway.
              Force close will immediately terminate the connection.
            </span>
            <button onClick={onClose} className="btn-ghost">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}