/**
 * Center Panel: Payload & Monaco Diff Viewer — shows the selected topic's
 * JSON payload with a diff against the previous payload, plus a real-time
 * streaming line chart for selected numeric telemetry attributes.
 */
import { useEffect, useMemo, useState, useRef, useCallback, memo } from 'react';
import { DiffEditor, Editor } from '@monaco-editor/react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { FileCode2, GitCompare, CircleDot, RefreshCcw, Send, Copy, Trash2, Check, X, ExternalLink } from 'lucide-react';
import type { UNSTreeNode } from '../types';
import { prettyJSON } from '../lib/format';
import { extractNumericSeries } from '../engine/topicTree';

interface PayloadViewerProps {
  selectedNode: UNSTreeNode | null;
  onPublishTopic: (topic: string) => void;
  selectedKeys: Set<string>;
  onToggleKey: (key: string) => void;
  /** Callback to clear previousPayload in parent state */
  onClearDiff?: (path: string) => void;
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

function toText(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const flat = flattenPayload(value);
  return Object.entries(flat)
    .map(([k, v]) => `${k}: ${v === null || v === undefined ? '' : v}`)
    .join('\n');
}

export function PayloadViewer({ selectedNode, onPublishTopic, selectedKeys, onToggleKey, onClearDiff, darkMode = true }: PayloadViewerProps) {
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetrySample[]>([]);
  const [diffFormat, setDiffFormat] = useState<DiffFormat>('json');
  const [copied, setCopied] = useState(false);
  const lastPayloadRef = useRef<any>(null);
  const pipWindowRef = useRef<Window | null>(null);

  // Extract numeric series for current node
  const numericSeries = useMemo(() => {
    if (!selectedNode?.payload) return {};
    if (typeof selectedNode.payload !== 'object') {
      if (typeof selectedNode.payload === 'number' && Number.isFinite(selectedNode.payload)) {
        return { value: selectedNode.payload };
      }
      return {};
    }
    return extractNumericSeries(selectedNode.payload);
  }, [selectedNode?.payload]);

  const localNumericKeys = useMemo(() => {
    return [...new Set(Object.keys(numericSeries))];
  }, [numericSeries]);

  const fullKeyMap = useMemo(() => {
    if (!selectedNode) return new Map<string, string>();
    const map = new Map<string, string>();
    localNumericKeys.forEach((key) => {
      map.set(key, `${selectedNode.path}:${key}`);
    });
    return map;
  }, [selectedNode, localNumericKeys]);

  const payloadRef = selectedNode?.payload;
  useEffect(() => {
    if (!selectedNode || localNumericKeys.length === 0) return;
    
    const payloadString = JSON.stringify(payloadRef);
    if (payloadString === lastPayloadRef.current) return;
    lastPayloadRef.current = payloadString;
    
    const sampleTime = new Date().toLocaleTimeString();
    setTelemetryHistory((prev) => {
      const last = prev[prev.length - 1];
      const newSample: TelemetrySample = { t: sampleTime, ...(last ? { ...last } : {}) };
      
      localNumericKeys.forEach((key) => {
        const fullKey = `${selectedNode.path}:${key}`;
        const val = numericSeries[key];
        if (typeof val === 'number') {
          newSample[fullKey] = val;
          newSample[key] = val;
        }
      });

      newSample.t = sampleTime;
      const next = [...prev, newSample];
      return next.length > TELEMETRY_MAX_POINTS ? next.slice(-TELEMETRY_MAX_POINTS) : next;
    });
  }, [selectedNode, payloadRef, localNumericKeys, numericSeries]);

  const activeChartKeys = useMemo(() => Array.from(selectedKeys), [selectedKeys]);
  const hasSelectedChartKeys = activeChartKeys.length > 0;

  // Build series definitions for PIP window rendering
  const activeSeriesMeta = useMemo(() => {
    return activeChartKeys.map((fullKey, idx) => {
      const label = fullKey.includes(':') 
        ? `${fullKey.split(':').slice(-1)[0]} (${fullKey.split('/')[fullKey.split('/').length - 1].split(':')[0]})`
        : fullKey;
      return {
        dataKey: fullKey,
        label,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      };
    });
  }, [activeChartKeys]);

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
    if (selectedNode) {
      if (onClearDiff) {
        onClearDiff(selectedNode.path);
      }
      setDiffFormat('json');
    }
  };

  /** Build SVG markup for external PIP window */
  const renderPipChart = useCallback((win: Window | null) => {
    if (!win || win.closed) return;
    const chartData = telemetryHistory;
    const series = activeSeriesMeta;

    const W = 820;
    const H = 480;
    const PAD_L = 60;
    const PAD_R = 20;
    const PAD_T = 30;
    const PAD_B = 50;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

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

    const timeLabels = [];
    const labelCount = Math.min(6, chartData.length);
    for (let t = 0; t < labelCount; t++) {
      const idx = Math.round((t / Math.max(1, labelCount - 1)) * (chartData.length - 1));
      const tx = x(idx);
      timeLabels.push(`
        <text x="${tx}" y="${H - PAD_B + 20}" text-anchor="middle" fill="#64748b" font-size="10">${chartData[idx]?.t ?? ''}</text>
      `);
    }

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

    const legendItems = series.map((s, i) => `
      <rect x="${20 + (i % 4) * 200}" y="${10 + Math.floor(i / 4) * 18}" width="10" height="10" fill="${s.color}" rx="2"/>
      <text x="${34 + (i % 4) * 200}" y="${19 + Math.floor(i / 4) * 18}" fill="#94a3b8" font-size="11">${s.label}</text>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Telemetry Trends — UNS Sentinel Explorer</title>
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
              <div class="title">Telemetry Trends (PIP Mode)</div>
              <div class="subtitle">${chartData.length} samples · ${series.length} active series · LIVE</div>
            </div>
            <div class="subtitle">UNS Sentinel Explorer</div>
          </div>
          <div class="chart-wrap">
            ${
              chartData.length === 0 || series.length === 0
                ? '<div class="empty">No telemetry data available. Select tags to plot trends.</div>'
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
  }, [telemetryHistory, activeSeriesMeta]);

  const togglePipWindow = useCallback(() => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.focus();
      renderPipChart(pipWindowRef.current);
      return;
    }

    const newWindow = window.open('', '_blank', 'width=900,height=650');
    if (!newWindow) return;
    pipWindowRef.current = newWindow;

    renderPipChart(newWindow);

    const poll = setInterval(() => {
      if (newWindow.closed) {
        clearInterval(poll);
        if (pipWindowRef.current === newWindow) {
          pipWindowRef.current = null;
        }
      }
    }, 2000);
  }, [renderPipChart]);

  useEffect(() => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      renderPipChart(pipWindowRef.current);
    }
  }, [renderPipChart]);

  return (
    <div className="panel flex flex-col h-full min-h-0 overflow-hidden">
      <div className="panel-header shrink-0">
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
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Format selector */}
          <div className="flex items-center gap-1 px-3 pt-2 shrink-0">
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

          {/* Editor Container */}
          <div className="flex-1 min-h-0 w-full relative my-2 overflow-hidden">
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
              />
            )}
          </div>

          {/* Telemetry Tags & Single Consolidated Trend Chart with PIP Pop-out */}
          {localNumericKeys.length > 0 && (
            <div className="shrink-0 border-t border-slate-800/80 px-3 py-2 bg-base-950/60">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <CircleDot className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Telemetry Tags
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">
                    {selectedKeys.size > 0 ? `${selectedKeys.size} selected` : 'Click to select'}
                  </span>
                  {hasSelectedChartKeys && (
                    <button
                      onClick={togglePipWindow}
                      className="text-[9px] bg-base-900 border border-slate-700 text-slate-300 rounded px-1.5 py-0.5 hover:bg-slate-800 flex items-center gap-1 transition-colors"
                      title="Open trends in new window (PIP mode)"
                    >
                      <ExternalLink className="w-3 h-3 text-cyan-400" /> PIP
                    </button>
                  )}
                </div>
              </div>

              {/* Tag Selection Buttons (Compact Grid) */}
              <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto pr-1">
                {localNumericKeys.map((key, i) => {
                  const fullKey = fullKeyMap.get(key) || key;
                  const isSelected = selectedKeys.has(fullKey) || selectedKeys.has(key);
                  
                  return (
                    <button
                      key={key}
                      onClick={() => onToggleKey(fullKey)}
                      className={[
                        'px-2 py-0.5 rounded text-[10px] font-mono border transition-all',
                        isSelected
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-sm'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700',
                      ].join(' ')}
                      style={
                        isSelected
                          ? { borderColor: CHART_COLORS[i % CHART_COLORS.length] + '80' }
                          : undefined
                      }
                    >
                      {key}
                    </button>
                  );
                })}
              </div>

              {/* Active Selected Tags Bar */}
              {hasSelectedChartKeys && (
                <div className="flex flex-wrap gap-1 mt-2 pt-1.5 border-t border-slate-800/60">
                  {activeChartKeys.map((fullKey, idx) => {
                    const displayLabel = fullKey.includes(':') 
                      ? `${fullKey.split(':').slice(-1)[0]} (${fullKey.split('/')[fullKey.split('/').length - 1].split(':')[0]})`
                      : fullKey;

                    return (
                      <span
                        key={fullKey}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono border bg-cyan-500/10 text-cyan-300"
                        style={{ borderColor: CHART_COLORS[idx % CHART_COLORS.length] + '90' }}
                      >
                        <span 
                          className="w-1.5 h-1.5 rounded-full" 
                          style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} 
                        />
                        {displayLabel}
                        <button
                          onClick={() => onToggleKey(fullKey)}
                          className="hover:text-red-400 ml-0.5 transition-colors"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Dynamic Auto-Scaling Chart */}
              {hasSelectedChartKeys && (
                <div className="mt-2 h-44 shrink-0">
                  <MemoizedTelemetryChart
                    data={telemetryHistory}
                    keys={activeChartKeys}
                    colors={CHART_COLORS}
                    onClear={() => setTelemetryHistory([])}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
    <div className="relative h-full w-full pt-1">
      <div className="absolute top-0 right-0 z-10 flex items-center gap-1">
        <button 
          onClick={onClear} 
          className="btn-ghost !p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200" 
          title="Clear chart history"
        >
          <RefreshCcw className="w-3 h-3" />
        </button>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.6} />
          <XAxis 
            dataKey="t" 
            tick={{ fill: '#64748b', fontSize: 9 }} 
            tickLine={false} 
            axisLine={{ stroke: '#334155' }}
          />
          <YAxis 
            domain={['auto', 'auto']} 
            tick={{ fill: '#64748b', fontSize: 9 }} 
            tickLine={false} 
            axisLine={{ stroke: '#334155' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 6,
              fontSize: 11,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
            labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
          />
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