/**
 * Left Panel: Dynamic Namespace Tree Navigator — renders topics hierarchically
 * with visual distinction between ISA-95 nodes, generic legacy topics, and
 * $SYS broker topics. Includes real-time search/filter input.
 */
import { useMemo, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Search,
  Building2,
  Factory,
  Boxes,
  Cpu,
  FolderTree,
} from 'lucide-react';
import type { UNSTreeNode } from '../types';
import { filterTreePaths } from '../engine/topicTree';
import { formatRelativeTime } from '../lib/format';

interface TopicTreeProps {
  tree: UNSTreeNode;
  selectedPath: string | null;
  onSelect: (path: string, node: UNSTreeNode) => void;
}

const NODE_STYLES = {
  isa95: {
    color: 'text-cyan-400',
    icon: <Building2 className="w-3.5 h-3.5 text-cyan-400" />,
  },
  legacy: {
    color: 'text-emerald-400',
    icon: <Boxes className="w-3.5 h-3.5 text-emerald-400" />,
  },
  sys: {
    color: 'text-amber-400',
    icon: <Cpu className="w-3.5 h-3.5 text-amber-400" />,
  },
} as const;

function renderNode(
  node: UNSTreeNode,
  depth: number,
  selectedPath: string | null,
  query: string,
  expanded: (path: string) => boolean,
  matchedPaths: Set<string>,
  expandedPaths: Set<string>,
  toggle: (path: string) => void,
  onSelect: (path: string, node: UNSTreeNode) => void
): React.ReactNode {
  const hasChildren = node.children.size > 0;
  const isExpanded = expanded(node.path);
  const style = NODE_STYLES[node.type];
  const isSelected = node.path === selectedPath;
  const hasPayload = node.payload !== undefined;
  const isMatch = query.trim() && matchedPaths.has(node.path);

  // If searching, filter out branches that don't contain matches
  if (query.trim() && !isMatch && !expandedPaths.has(node.path) && node.path) {
    const hasDescendantMatch = Array.from(matchedPaths).some((p) => p.startsWith(node.path + '/'));
    if (!hasDescendantMatch && !isMatch) return null;
  }

  return (
    <div key={node.id}>
      <div
        className={[
          'group flex items-center gap-1.5 px-2 py-[3px] rounded cursor-pointer select-none',
          'hover:bg-slate-800/60 transition-colors text-xs whitespace-nowrap',
          isSelected ? 'bg-cyan-500/10 text-cyan-300' : 'text-slate-300',
          isMatch ? 'bg-amber-500/5' : '',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelect(node.path, node)}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.path);
            }}
            className="text-slate-600 hover:text-slate-300 shrink-0"
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="shrink-0">{style.icon}</span>
        <span className="truncate font-mono">{node.name}</span>
        {hasPayload && (
          <span
            className={[
              'ml-auto shrink-0 text-[9px] px-1 py-px rounded',
              isSelected ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-500',
            ].join(' ')}
          >
            {formatRelativeTime(node.lastUpdated)}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div>
          {Array.from(node.children.values()).map((child) =>
            renderNode(child, depth + 1, selectedPath, query, expanded, matchedPaths, expandedPaths, toggle, onSelect)
          )}
        </div>
      )}
    </div>
  );
}

export function TopicTree({ tree, selectedPath, onSelect }: TopicTreeProps) {
  const [query, setQuery] = useState('');
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());

  const filterResult = useMemo(() => filterTreePaths(tree, query), [tree, query]);

  const isExpanded = (path: string): boolean => {
    if (query.trim()) return filterResult.expandedPaths.has(path) || manualExpanded.has(path);
    return manualExpanded.has(path);
  };

  const toggle = (path: string) => {
    setManualExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="panel-header">
        <span className="flex items-center gap-2">
          <FolderTree className="w-3.5 h-3.5 text-cyan-400" />
          Namespace Tree
        </span>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <Building2 className="w-3 h-3 text-cyan-400" /> ISA-95
          </span>
          <span className="flex items-center gap-1">
            <Boxes className="w-3 h-3 text-emerald-400" /> Legacy
          </span>
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3 text-amber-400" /> $SYS
          </span>
        </div>
      </div>

      {/* Live search/filter */}
      <div className="p-2 border-b border-slate-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
          <input
            className="input !pl-8 !py-1.5 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter topics… e.g. sensor, temp, Cell1"
          />
        </div>
      </div>

      {/* Tree body */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.children.size === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-600">
            <Factory className="w-6 h-6 mx-auto mb-2 text-slate-700" />
            No topics yet.
            <br />
            Connect a broker or launch the simulator.
          </div>
        ) : (
          Array.from(tree.children.values()).map((child) =>
            renderNode(
              child,
              0,
              selectedPath,
              query,
              isExpanded,
              filterResult.matchedPaths,
              filterResult.expandedPaths,
              toggle,
              onSelect
            )
          )
        )}
      </div>
    </div>
  );
}