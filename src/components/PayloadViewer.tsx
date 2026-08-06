/**
 * Center Panel: Payload & Monaco Diff Viewer — shows the selected topic's
 * JSON payload with a diff against the previous payload, plus a real-time
 * streaming line chart for selected numeric telemetry attributes.
 */
import { useEffect, useMemo, useState, useRef, memo } from 'react';
import { DiffEditor, Editor } from '@monaco-editor/react';
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
import { FileCode2, GitCompare, CircleDot, RefreshCcw, Send, Copy, Trash2, Check } from 'lucide-react';
import type { UNSTreeNode } from '../types';
import { prettyJSON } from '../lib/format';
import { extractNumericSeries } from '../engine/topicTree';

interface PayloadViewerProps {
  selectedNode: UNSTreeNode | null;
  onPublishTopic: (topic: string) => void;
  selectedKeys: Set<string>;
  onToggleKey: (key: string) => void;
  /** Pass dark mode state so Monaco can use the correct editor theme */
  darkMode?: boolean;
}

interface TelemetrySample {
  t: string;
  [key: string]: string | number;
}

type DiffFormat = 'json' | 'text' | 'csv';

const TELEMETRY_MAX_POINTS = 120;

const CHART_COLORS = ['#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#f87171'];

/** Convert a payload value to a flat key-value map for CSV/Text rendering */
function flattenPayload(value: any, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {};
  if (value === null || value === undefined) {
    result[prefix || 'value'] = '';
    return result;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        Object.assign(result, flattenPayload(item, prefix ? `${prefix}[${i}]` : `[${i}]`));
      });
    } else {
      for (const [key, val] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object') {
          Object.assign(result, flattenPayload(val, path));
        } else {
          result[path] = val;
        }
      }
    }
  } else {
    result[prefix || 'value'] = value;
  }
  return result;
}

/** Convert a payload to CSV format */
function toCSV(value: any): string {
  const flat = flattenPayload(value);
  const keys = Object.keys(flat);
  if (keys.length === 0) return '';
  const header = keys.join(',');
  const row = keys.map((k) => {
    const v = flat[k];
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
  return `${header}\n${row}`;
}

/** Convert a payload to plain text representation */
function toText(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const flat = flattenPayload(value);
  return Object.entries(flat)
    .map(([k, v]) => `${k}: ${v === null || v === undefined ? '' : v}`)
    .join('\n');
}

export function PayloadViewer({ selectedNode, onPublishTopic, selectedKeys, onToggleKey, darkMode = true }: PayloadViewerProps) {
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetrySample[]>([]);
  const [diffFormat, setDiffFormat] = useState<DiffFormat>('json');
  const [copied, setCopied] = useState(false);
  const lastPayloadRef = useRef<any>(null);

  // Reset history when switching topics — only depends on the path string
  const nodePath = selectedNode?.path ?? null;
  useEffect(() => {
    setTelemetryHistory([]);
    setDiffFormat('json');
    lastPayloadRef.current = null;
  }, [nodePath]);

  // Extract numeric series — memoized on the payload value itself (stable reference)
  const numericSeries = useMemo(() => {
    if (!selectedNode?.payload) return {};
    // Handle both objects and primitives
    if (typeof selectedNode.payload !== 'object') {
      // For primitive numbers, create a simple series
      if (typeof selectedNode.payload === 'number' && Number.isFinite(selectedNode.payload)) {
        return { value: selectedNode.payload };
      }
      return {};
    }
    return extractNumericSeries(selectedNode.payload);
  }, [selectedNode?.payload]);

  const numericKeys = useMemo(() => {
    const keys = Object.keys(numericSeries);
    // Remove duplicates while preserving order
    return [...new Set(keys)];
  }, [numericSeries]);

  // Append a telemetry sample only when the payload actually changes.
  // Use a ref to compare payloads and prevent duplicate updates.
  const payloadRef = selectedNode?.payload;
  useEffect(() => {
    if (!payloadRef || numericKeys.length === 0) {
      lastPayloadRef.current = payloadRef;
      return;
    }
    
    // Skip if payload hasn't actually changed (compare by JSON string)
    const payloadString = JSON.stringify(payloadRef);
    if (payloadString === lastPayloadRef.current) {
      return;
    }
    lastPayloadRef.current = payloadString;
    
    const sample: TelemetrySample = { t: new Date().toLocaleTimeString() };
    for (const key of numericKeys) {
      const v = numericSeries[key];
      if (typeof v === 'number') sample[key] = v;
    }
    setTelemetryHistory((prev) => {
      const next = [...prev, sample];
      return next.length > TELEMETRY_MAX_POINTS ? next.slice(-TELEMETRY_MAX_POINTS) : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadRef, numericKeys.join(',')]);

  const selectedKeysArray = useMemo(() => Array.from(selectedKeys), [selectedKeys]);
  
  const chartKeys = useMemo(() => {
    const keys = numericKeys.filter((k) => selectedKeys.has(k));
    // Remove any duplicates
    return [...new Set(keys)];
  }, [numericKeys, selectedKeysArray]);
  
  const hasNumericSelected = chartKeys.length > 0;

  const formatPayload = (value: any, format: DiffFormat): string => {
    if (value === undefined) return '';
    switch (format) {
      case 'json':
        return prettyJSON(value);
      case 'csv':
        return toCSV(value);
      case 'text':
        return toText(value);
    }
  };

  const diffEditorContent = useMemo(() => {
    if (!selectedNode) return '';
    return formatPayload(selectedNode.payload, diffFormat);
  }, [selectedNode?.payload, selectedNode, diffFormat]);

  const originalContent = useMemo(() => {
    if (!selectedNode) return '';
    return formatPayload(selectedNode.previousPayload, diffFormat);
  }, [selectedNode?.previousPayload, selectedNode, diffFormat]);

  const editorLanguage = diffFormat === 'json' ? 'json' : 'plaintext';

  const handleCopyJSON = async () => {
    if (!selectedNode?.payload) return;
    try {
      await navigator.clipboard.writeText(prettyJSON(selectedNode.payload));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleClearDiff = () => {
    if (selectedNode && selectedNode.previousPayload !== undefined) {
      // We need to signal the parent to clear the previous payload
      // For now, we'll just reset the diff format which will refresh the view
      setDiffFormat('json');
    }
  };

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="panel-header">
        <span className="flex items-center gap-2">
          <GitCompare className="w-3.5 h-3.5 text-cyan-400" />
          Payload {selectedNode?.previousPayload !== undefined ? 'Diff' : 'Viewer'}
        </span>
        {selectedNode && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] text-slate-500 font-mono truncate max-w-[240px]">
              {selectedNode.path}
            </span>
            <button
              onClick={() => onPublishTopic(selectedNode.path)}
              className="btn-ghost !p-1"
              title="Publish to this topic"
            >
              <Send className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {!selectedNode ? (
        <div className="flex-1 flex items-center justify-center text-center text-xs text-slate-600 px-8">
          <div>
            <FileCode2 className="w-8 h-8 mx-auto mb-2 text-slate-700" />
            Select a topic from the namespace tree
            <br />
            to inspect its live payload and changes.
          </div>
        </div>
      ) : (
        <div className="flex flex-col h-full min-h-0">
          {/* Format selector */}
          <div className="flex items-center gap-1 px-3 pt-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mr-1">
              View:
            </span>
            {(['json', 'text', 'csv'] as DiffFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setDiffFormat(fmt)}
                className={[
                  'px-2 py-0.5 rounded text-[10px] font-mono border transition-colors uppercase',
                  diffFormat === fmt
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : 'bg-base-950 border-slate-800 text-slate-500 hover:text-slate-300',
                ].join(' ')}
              >
                {fmt}
              </button>
            ))}
          </div>

          {/* Editor container with overlay buttons */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {/* Action buttons overlay - top right corner */}
            {selectedNode && (
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                <button
                  onClick={handleCopyJSON}
                  className="btn-ghost !p-1.5 bg-base-900/80 backdrop-blur-sm border border-slate-700/50 rounded"
                  title="Copy JSON to clipboard"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {selectedNode.previousPayload !== undefined && (
                  <button
                    onClick={handleClearDiff}
                    className="btn-ghost !p-1.5 bg-base-900/80 backdrop-blur-sm border border-slate-700/50 rounded"
                    title="Clear diff comparison"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Use regular editor when no previous payload, diff editor when there is one.
                flex-1 + min-h-0 + overflow-hidden lets Monaco scroll internally
                while the numeric attributes section stays pinned at the bottom. */}
            {selectedNode.previousPayload === undefined ? (
              <Editor
                height="100%"
                theme={darkMode ? 'vs-dark' : 'light'}
                language={editorLanguage}
                value={diffEditorContent}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: 'on',
                  padding: { top: 8, bottom: 8 },
                  lineNumbers: 'on',
                  glyphMargin: false,
                  folding: false,
                  lineDecorationsWidth: 0,
                }}
                beforeMount={(monaco) => {
                  monaco.editor.defineTheme('uns-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [
                      { token: 'string.key.json', foreground: '22d3ee' },
                      { token: 'string.value.json', foreground: '34d399' },
                      { token: 'number', foreground: 'fbbf24' },
                    ],
                    colors: {
                      'editor.background': '#0f172a',
                      'editor.lineHighlightBackground': '#1e293b40',
                    },
                  });
                }}
              />
            ) : (
              <DiffEditor
                height="100%"
                theme={darkMode ? 'vs-dark' : 'light'}
                language={editorLanguage}
                original={originalContent}
                modified={diffEditorContent}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: 'on',
                  padding: { top: 8, bottom: 8 },
                  renderSideBySide: false,
                  lineNumbers: 'on',
                  glyphMargin: false,
                  folding: false,
                  lineDecorationsWidth: 0,
                }}
                beforeMount={(monaco) => {
                  monaco.editor.defineTheme('uns-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [
                      { token: 'string.key.json', foreground: '22d3ee' },
                      { token: 'string.value.json', foreground: '34d399' },
                      { token: 'number', foreground: 'fbbf24' },
                    ],
                    colors: {
                      'editor.background': '#0f172a',
                      'editor.lineHighlightBackground': '#1e293b40',
                      'diffEditor.insertedTextBackground': '#34d39920',
                      'diffEditor.removedTextBackground': '#f8717120',
                    },
                  });
                }}
              />
            )}
          </div>

          {/* Numeric attributes selector — pinned at bottom, never hidden by long payloads */}
          {numericKeys.length > 0 && (
            <div className="shrink-0 border-t border-slate-800 px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <CircleDot className="w-3 h-3 text-emerald-400" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Telemetry Tags
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">
                  {selectedKeys.size > 0 ? `${selectedKeys.size} selected` : 'Click to select'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {numericKeys.map((key, i) => {
                  const isSelected = selectedKeys.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => onToggleKey(key)}
                      className={[
                        'px-2 py-0.5 rounded text-[10px] font-mono border transition-all',
                        isSelected
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-base-950 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700',
                      ].join(' ')}
                      style={
                        isSelected
                          ? { borderColor: CHART_COLORS[i % CHART_COLORS.length] + '80', boxShadow: `0 0 8px ${CHART_COLORS[i % CHART_COLORS.length]}20` }
                          : undefined
                      }
                      title={`${isSelected ? 'Deselect' : 'Select'} ${key} for trends`}
                    >
                      {key}
                    </button>
                  );
                })}
              </div>

              {/* Telemetry chart - fixed height to prevent layout shifts */}
              <div className="mt-2 h-32">
                {hasNumericSelected && chartKeys.length > 0 ? (
                  <MemoizedTelemetryChart
                    data={telemetryHistory}
                    keys={chartKeys}
                    colors={CHART_COLORS}
                    onClear={() => setTelemetryHistory([])}
                  />
                ) : !hasNumericSelected && selectedKeys.size > 0 ? (
                  <div className="flex items-center justify-center h-full text-[10px] text-slate-600">
                    Selected tags have no numeric data
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-[10px] text-slate-600">
                    Select tags above to view trends
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Memoize TelemetryChart to prevent unnecessary re-renders
const MemoizedTelemetryChart = memo(TelemetryChart);

function TelemetryChart({
  data,
  keys,
  colors,
  onClear,
}: {
  data: TelemetrySample[];
  keys: string[];
  colors: string[];
  onClear: () => void;
}) {
  return (
    <div className="relative">
      <div className="absolute top-0 right-0 z-10 flex items-center gap-1">
        <button
          onClick={onClear}
          className="btn-ghost !p-1"
          title="Clear telemetry history"
        >
          <RefreshCcw className="w-3 h-3" />
        </button>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} />
          <YAxis tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 6,
              fontSize: 11,
            }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {keys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
