/**
 * MQTT Payload Publisher Modal — form with Target Topic Path, Payload Editor
 * (JSON/Text), retain checkbox (default true for UNS), and QoS Selector.
 */
import { useEffect, useState } from 'react';
import { X, Send, AlertCircle } from 'lucide-react';
import type { Session } from '../../types';

interface PublishModalProps {
  open: boolean;
  session: Session | null;
  selectedTopic?: string;
  onClose: () => void;
  onPublish: (topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) => Promise<void>;
}

export function PublishModal({ open, session, selectedTopic, onClose, onPublish }: PublishModalProps) {
  const [topic, setTopic] = useState(selectedTopic ?? '');
  const [payload, setPayload] = useState('{\n  "ts": "' + new Date().toISOString() + '",\n  "value": 0\n}');
  const [qos, setQos] = useState<0 | 1 | 2>(0);
  const [retain, setRetain] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (selectedTopic) {
      setTopic(selectedTopic);
    }
    setError(null);
    setSuccess(false);
  }, [open, selectedTopic]);

  if (!open) return null;

  const handlePublish = async () => {
    setError(null);
    setSuccess(false);
    if (!topic.trim()) {
      setError('Target topic path is required');
      return;
    }
    if (!session) {
      setError('No active session. Create a session first.');
      return;
    }
    setSending(true);
    try {
      await onPublish(topic.trim(), payload, qos, retain);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      setError(err?.message ?? 'Publish failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel w-[520px] max-h-[85vh] overflow-y-auto animate-fade-in">
        <div className="panel-header">
          <span className="flex items-center gap-2">
            <Send className="w-3.5 h-3.5 text-emerald-400" />
            Publish MQTT Data
            {session && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                → {session.config.name}
              </span>
            )}
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Target topic */}
          <div>
            <label className="label">Target Topic Path</label>
            <input
              className="input font-mono text-xs"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enterprise/Site1/Area1/Line1/Cell1/Machine/Setpoint"
              spellCheck={false}
            />
          </div>

          {/* Payload editor */}
          <div>
            <label className="label">
              Payload <span className="text-slate-600">(JSON or plain text)</span>
            </label>
            <textarea
              className="input font-mono text-xs h-48 resize-y leading-relaxed"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* QoS + retain */}
          <div className="flex items-center gap-4">
            <div>
              <label className="label">QoS</label>
              <div className="flex gap-1">
                {([0, 1, 2] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => setQos(q)}
                    className={[
                      'px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors',
                      qos === q
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                        : 'bg-base-950 border-slate-700 text-slate-500 hover:text-slate-300',
                    ].join(' ')}
                  >
                    QoS {q}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-5">
              <input
                type="checkbox"
                checked={retain}
                onChange={(e) => setRetain(e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
              <span className="text-sm text-slate-300">
                Retain <span className="text-slate-600 text-xs">(default ON for UNS)</span>
              </span>
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
              ✓ Published successfully
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={sending || !session}
              className="btn-emerald"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Build a default publish payload template */
export function buildDefaultPublishPayload(): string {
  return JSON.stringify(
    {
      ts: new Date().toISOString(),
      value: 0,
      unit: '',
      quality: 'GOOD',
    },
    null,
    2
  );
}