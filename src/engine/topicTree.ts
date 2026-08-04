/**
 * Dynamic Topic Tree Builder — handles ISA-95 hierarchies, legacy flat topics,
 * and $SYS broker topics. Parses topic strings by '/'.
 */
import type { UNSTreeNode, TreeNodeType } from '../types';

/**
 * ISA-95 level keywords — used as a fallback heuristic when the topic
 * structure doesn't match the standard `{enterprise}/{site}/{area}/{line}/{cell}/{asset}/{messageType}`
 * pattern (e.g. when the enterprise name is not a known keyword).
 */
const ISA95_LEVELS = ['enterprise', 'site', 'area', 'line', 'cell', 'unit', 'equipment'] as const;

/**
 * ISA-95 message types — the final segment(s) of a well-formed ISA-95 topic.
 * From the `unified-namespace-schemas` repo:
 *   {enterprise}/{site}/{area}/{line}/{cell}/{asset}/{messageType}
 * where messageType ∈ { asset, state, edge, alert }.
 */
const ISA95_MESSAGE_TYPES = new Set(['asset', 'state', 'edge', 'alert']);

/** Deep clone a tree node (needed for React state updates) */
export function cloneTree(node: UNSTreeNode): UNSTreeNode {
  return {
    ...node,
    children: new Map(
      Array.from(node.children.entries()).map(([name, child]) => [name, cloneTree(child)])
    ),
  };
}

/**
 * Classify a topic path to determine ISA-95 vs legacy vs $SYS.
 *
 * Detection strategy (in priority order):
 * 1. `$SYS/...` → sys
 * 2. `legacy/...` → legacy
 * 3. **Structural ISA-95 detection** — matches the standard ISA-95 hierarchy
 *    `{enterprise}/{site}/{area}/{line}/{cell}/{asset}/{messageType}`:
 *    - The topic has ≥ 4 segments (enterprise/site/area/line minimum)
 *    - The last segment (or second-to-last for `edge/{sensor}`) is a known
 *      ISA-95 message type: `asset`, `state`, `edge`, `alert`
 *    - The first segment is NOT `legacy` or `$SYS` (already handled above)
 *    - **Prefix support**: The `unified-namespace-schemas` repo allows an
 *      optional `TOPIC_PREFIX` before the enterprise level:
 *        `{TOPIC_PREFIX}/{enterprise}/{site}/{area}/{line}/{cell}/{asset}/{messageType}`
 *      e.g. `UnifiedNamespace/Plant/Plant-01/Utilities/CoolingSystem/PUMP-101/asset`
 *      Because detection is based on the **end** of the topic (message types),
 *      a prefix before enterprise does NOT affect classification.
 * 4. **Keyword heuristic** — first segment matches an ISA-95 level name
 *    (e.g. `Enterprise/Site1/Area1/...` from the demo simulator)
 * 5. Fallback → legacy
 */
export function classifyTopicPath(path: string): TreeNodeType {
  if (path.startsWith('$SYS')) return 'sys';

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return 'legacy';

  const first = segments[0].toLowerCase();
  if (first === 'legacy') return 'legacy';

  // Structural ISA-95 detection: {enterprise}/{site}/{area}/{line}/{cell}/{asset}/{messageType}
  // Requires at least 4 segments (enterprise/site/area/line) and a known message type.
  // NOTE: This works regardless of whether a TOPIC_PREFIX precedes the enterprise
  // level — we only inspect the LAST segments for message types.
  if (segments.length >= 4) {
    const last = segments[segments.length - 1].toLowerCase();
    const secondLast = segments[segments.length - 2]?.toLowerCase();

    // Direct message type: .../asset, .../state, .../alert
    if (ISA95_MESSAGE_TYPES.has(last)) return 'isa95';

    // Edge telemetry: .../edge/{sensorName} (e.g. .../edge/temperature)
    if (secondLast === 'edge') return 'isa95';
  }

  // Keyword heuristic: first segment matches an ISA-95 level name.
  // Note: with a TOPIC_PREFIX, the first segment is the prefix (e.g. `UnifiedNamespace`),
  // so this heuristic won't match — but the structural detection above already handles it.
  if ((ISA95_LEVELS as readonly string[]).includes(first)) return 'isa95';

  return 'legacy';
}

/** Create a fresh root node */
export function createRootNode(): UNSTreeNode {
  return {
    id: 'root',
    name: 'UNS Namespace',
    path: '',
    type: 'legacy',
    children: new Map(),
    isLeaf: false,
  };
}

/**
 * Insert or update a node in the tree by topic path.
 * Returns the leaf node that was created/updated.
 */
export function upsertTopicNode(
  root: UNSTreeNode,
  topic: string,
  payload: any,
  rawPayload: string,
  retained: boolean | undefined,
  now: number
): { node: UNSTreeNode; isNew: boolean; changed: string[] } {
  const segments = topic.split('/').filter(Boolean);
  const type = classifyTopicPath(topic);
  const changed: string[] = [];
  let isNew = false;

  let current = root;
  let acc = '';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    acc = acc ? `${acc}/${seg}` : seg;

    if (!current.children.has(seg)) {
      isNew = true;
      const child: UNSTreeNode = {
        id: `${acc}__${Math.random().toString(36).slice(2, 8)}`,
        name: seg,
        path: acc,
        type,
        children: new Map(),
        isLeaf: i === segments.length - 1,
        lastUpdated: now,
      };
      current.children.set(seg, child);
      current = child;
    } else {
      const existing = current.children.get(seg)!;
      existing.type = type;
      existing.isLeaf = i === segments.length - 1;
      existing.lastUpdated = now;
      current = existing;
    }
  }

  // Update payload on the leaf
  const leaf = current;
  if (leaf.payload !== undefined) {
    leaf.previousPayload = leaf.payload;
  }

  // Compute changed keys between old and new payload (for diff highlight)
  if (leaf.payload !== undefined) {
    const oldKeys = extractLeafKeys(leaf.payload);
    const newKeys = extractLeafKeys(payload);
    for (const k of newKeys.keys()) {
      if (!oldKeys.has(k)) changed.push(k);
      else if (!deepEqual(oldKeys.get(k), newKeys.get(k))) changed.push(k);
    }
  }

  leaf.payload = payload;
  leaf.rawPayload = rawPayload;
  leaf.retained = retained;
  leaf.lastUpdated = now;

  // Propagate lastUpdated upward so parent branches show activity
  let parent: UNSTreeNode = root;
  let acc2 = '';
  for (const seg of segments.slice(0, -1)) {
    if (!parent) break;
    acc2 = acc2 ? `${acc2}/${seg}` : seg;
    const childNode = parent.children.get(seg);
    if (childNode) {
      childNode.lastUpdated = now;
      parent = childNode;
    } else {
      break;
    }
  }

  return { node: leaf, isNew, changed };
}

/** Find a node in the tree by full path (e.g. "Enterprise/Site1/Area1") */
export function findNodeByPath(root: UNSTreeNode, path: string): UNSTreeNode | null {
  if (!path) return root;
  const segments = path.split('/').filter(Boolean);
  let current: UNSTreeNode = root;
  for (const seg of segments) {
    const child = current.children.get(seg);
    if (!child) return null;
    current = child;
  }
  return current;
}

/** Recursively extract scalar leaves as a flat key/value map (for telemetry/diff) */
function extractLeafKeys(value: any, prefix = '', out = new Map<string, any>()): Map<string, any> {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => extractLeafKeys(v, prefix ? `${prefix}[${i}]` : `[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      extractLeafKeys(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  out.set(prefix, value);
  return out;
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** Extract scalar numeric telemetry series from a payload object */
export function extractNumericSeries(payload: any): Record<string, number> {
  const out: Record<string, number> = {};
  const flat = extractLeafKeys(payload);
  for (const key of flat.keys()) {
    const value = flat.get(key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

/** Filter the tree by a text query — returns matching full paths */
export function filterTreePaths(
  root: UNSTreeNode,
  query: string
): { matchedPaths: Set<string>; expandedPaths: Set<string>; allPaths: Set<string> } {
  const q = query.trim().toLowerCase();
  const matchedPaths = new Set<string>();
  const allPaths = new Set<string>();
  const expandedPaths = new Set<string>();

  const walk = (node: UNSTreeNode, depth: number) => {
    const fullPath = node.path;
    if (fullPath) allPaths.add(fullPath);

    if (
      q &&
      (fullPath.toLowerCase().includes(q) ||
        node.name.toLowerCase().includes(q) ||
        // Include matches against payload values
        payloadMatchesQuery(node.payload, q))
    ) {
      matchedPaths.add(fullPath);
      // Expand all ancestors of a match
      const parts = fullPath.split('/');
      let acc = '';
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        expandedPaths.add(acc);
      }
    }

    for (const child of node.children.values()) {
      walk(child, depth + 1);
    }
  };

  walk(root, 0);

  // When no query, nothing is "matched" but everything can expand
  return { matchedPaths, expandedPaths, allPaths };
}

function payloadMatchesQuery(payload: any, q: string): boolean {
  if (payload === undefined || payload === null) return false;
  try {
    const str = JSON.stringify(payload).toLowerCase();
    return str.includes(q);
  } catch {
    return false;
  }
}

/** Serialize tree (Map → plain object) for exported snapshots */
export function serializeTree(node: UNSTreeNode): any {
  return {
    ...node,
    children: Array.from(node.children.entries()).map(([name, child]: [string, UNSTreeNode]) => ({
      name,
      node: serializeTree(child),
    })),
  };
}

/** Count nodes in the tree */
export function countNodes(root: UNSTreeNode): number {
  let count = 0;
  const walk = (n: UNSTreeNode) => {
    count++;
    for (const c of n.children.values()) walk(c);
  };
  walk(root);
  return count;
}

/** Count topics that carry payloads (leaves with data) */
export function countPayloadNodes(root: UNSTreeNode): number {
  let count = 0;
  const walk = (n: UNSTreeNode) => {
    if (n.isLeaf && n.payload !== undefined) count++;
    for (const c of n.children.values()) walk(c);
  };
  walk(root);
  return count;
}

/** Collect all leaf nodes with numeric payloads for telemetry */
export function collectNumericLeafs(root: UNSTreeNode): Array<{ path: string; values: Record<string, number> }> {
  const out: Array<{ path: string; values: Record<string, number> }> = [];
  const walk = (n: UNSTreeNode) => {
    if (n.isLeaf && n.payload !== undefined && typeof n.payload === 'object') {
      const series = extractNumericSeries(n.payload);
      if (Object.keys(series).length > 0) {
        out.push({ path: n.path, values: series });
      }
    }
    for (const c of n.children.values()) walk(c);
  };
  walk(root);
  return out;
}