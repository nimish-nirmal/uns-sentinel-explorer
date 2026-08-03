/**
 * Saved Brokers List Window — card list of stored setups with one-click
 * "Launch Session", edit, delete, plus workspace import/export.
 */
import { useRef, useState } from 'react';
import { X, Rocket, Pencil, Trash2, Download, Upload, Wifi, WifiOff } from 'lucide-react';
import type { BrokerConfig, SavedBroker } from '../../types';
import { exportWorkspace, importWorkspace } from '../../lib/storage';

interface SavedBrokersListProps {
  open: boolean;
  brokers: SavedBroker[];
  onClose: () => void;
  onLaunch: (config: BrokerConfig) => void;
  onEdit: (broker: SavedBroker) => void;
  onDelete: (id: string) => void;
  onImported: () => void;
}

export function SavedBrokersList({
  open,
  brokers,
  onClose,
  onLaunch,
  onEdit,
  onDelete,
  onImported,
}: SavedBrokersListProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  if (!open) return null;

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await importWorkspace(file);
      setImportError(null);
      onImported();
    } catch (err: any) {
      setImportError(err?.message ?? 'Import failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel w-[640px] max-h-[85vh] overflow-y-auto animate-fade-in">
        <div className="panel-header">
          <span className="flex items-center gap-2">
            <Rocket className="w-3.5 h-3.5 text-cyan-400" />
            Saved Broker Profiles
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {/* Import / Export actions */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-ghost"
              title="Import workspace JSON"
            >
              <Upload className="w-3.5 h-3.5" />
              Import
            </button>
            <button onClick={exportWorkspace} className="btn-ghost" title="Export workspace JSON">
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => handleImportFile(e.target.files?.[0])}
            />
            {importError && <span className="text-red-400 text-xs ml-2">{importError}</span>}
          </div>

          {brokers.length === 0 ? (
            <div className="py-12 text-center">
              <WifiOff className="w-8 h-8 mx-auto text-slate-700 mb-2" />
              <p className="text-sm text-slate-500">No saved broker profiles yet.</p>
              <p className="text-xs text-slate-600 mt-1">
                Create a connection and tick "Save to local storage" to keep it here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {brokers.map((broker) => (
                <div
                  key={broker.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-base-950 border border-slate-800 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-slate-800/80 shrink-0">
                    <Wifi className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-200 truncate">{broker.name}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-mono uppercase">
                        {broker.protocol}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {broker.host}:{broker.port} · {broker.subscriptions.length} subscription
                      {broker.subscriptions.length !== 1 ? 's' : ''} · saved{' '}
                      {new Date(broker.savedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onLaunch(broker)}
                      className="btn-emerald !px-2.5"
                      title="Launch session"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      Launch
                    </button>
                    <button onClick={() => onEdit(broker)} className="btn-ghost !p-1.5" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        // Prevent deletion of default brokers
                        if (!broker.id.startsWith('default-')) {
                          onDelete(broker.id);
                        }
                      }}
                      className={`btn-ghost !p-1.5 ${broker.id.startsWith('default-') ? 'opacity-30 cursor-not-allowed' : 'hover:text-red-400'}`}
                      title={broker.id.startsWith('default-') ? 'Default brokers cannot be deleted' : 'Delete'}
                      disabled={broker.id.startsWith('default-')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}