/**
 * Formatting & helper utilities
 */

/** Format large numbers with K/M/B suffixes */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Format a byte count as a human-readable string */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format relative time like "2s ago" */
export function formatRelativeTime(ts?: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 1000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

/** Prettify JSON, falling back to raw string on parse error */
export function prettyJSON(value: any): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Truncate a string in the middle */
export function truncateMiddle(str: string, maxLen = 40): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor(maxLen / 2);
  return `${str.slice(0, half)}…${str.slice(-half)}`;
}

/** Generate a deterministic-ish color from a string (for node styling) */
export function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 65%)`;
}

/** Compute payload diff lines between previous and current (simple JSON diff) */
export function computePayloadDiff(prev: any, curr: any): string | null {
  if (prev === undefined && curr === undefined) return null;
  if (prev === undefined) return prettyJSON(curr);
  if (curr === undefined) return prettyJSON(prev);
  // Both exist: produce unified-ish diff string with markers
  try {
    const prevStr = JSON.stringify(prev, null, 2).split('\n');
    const currStr = JSON.stringify(curr, null, 2).split('\n');
    return simpleLineDiff(prevStr, currStr).join('\n');
  } catch {
    return null;
  }
}

function simpleLineDiff(prevLines: string[], currLines: string[]): string[] {
  const out: string[] = [];
  const maxLen = Math.max(prevLines.length, currLines.length);
  for (let i = 0; i < maxLen; i++) {
    const a = prevLines[i];
    const b = currLines[i];
    if (a === b) {
      out.push(`  ${a}`);
    } else if (a !== undefined && b !== undefined) {
      out.push(`- ${a}`);
      out.push(`+ ${b}`);
    } else if (a !== undefined) {
      out.push(`- ${a}`);
    } else if (b !== undefined) {
      out.push(`+ ${b}`);
    }
  }
  return out;
}

/** Simple UUID generator (RFC4122-ish v4) */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}