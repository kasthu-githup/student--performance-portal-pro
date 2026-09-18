import React, { useState } from 'react';
import { usePortal } from '../../context/PortalContext';
import {
  Database,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Server,
  Layers,
  ArrowUpDown,
  Cpu,
  ShieldCheck,
  Key,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';

interface DatabaseStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DatabaseStatusModal: React.FC<DatabaseStatusModalProps> = ({ isOpen, onClose }) => {
  const { dbStatus, refreshDbStatus, syncDataToDb, connectTiDb, isDbSyncing } = usePortal();
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showConfigForm, setShowConfigForm] = useState(!dbStatus?.connected);

  // Form states for custom TiDB connection
  const [host, setHost] = useState(dbStatus?.host || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com');
  const [port, setPort] = useState(String(dbStatus?.port || 4000));
  const [user, setUser] = useState(dbStatus?.user || '3sofZfmeAkgsoaf.root');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState(dbStatus?.database || 'test');
  const [isConnecting, setIsConnecting] = useState(false);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setSyncResult(null);
    await refreshDbStatus();
    setIsRefreshing(false);
  };

  const handleSync = async () => {
    setSyncResult(null);
    const res = await syncDataToDb();
    setSyncResult(res);
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnecting(true);
    setSyncResult(null);
    try {
      const res = await connectTiDb({
        host: host.trim(),
        port: Number(port) || 4000,
        user: user.trim(),
        password: password.trim(),
        database: database.trim(),
      });
      setSyncResult(res);
      if (res.success) {
        setShowConfigForm(false);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white">TiDB Cloud Database Manager</h3>
              <p className="text-xs text-slate-400">Institutional High-Availability Persistence Engine</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Status Banner */}
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-3 ${
              dbStatus?.connected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {dbStatus?.connected ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="text-xs flex-1">
              <div className="font-bold text-sm flex items-center justify-between">
                <span>{dbStatus?.connected ? 'TiDB Cloud Active & Connected' : 'Local Persistence (TiDB Pending)'}</span>
                {dbStatus?.connected && (
                  <span className="px-2 py-0.5 text-[10px] bg-emerald-200 text-emerald-800 rounded-full font-bold">
                    TLS Secured
                  </span>
                )}
              </div>
              <div className="mt-1 opacity-90">
                {dbStatus?.message || (dbStatus?.connected ? 'All user data is synchronized in real-time with TiDB Cloud.' : 'Data is cached locally. Enter your TiDB password below to activate cloud database sync.')}
              </div>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Storage Engine</span>
              <span className="font-bold text-slate-800 uppercase flex items-center gap-1.5 mt-0.5 truncate">
                <Server className="w-3.5 h-3.5 text-indigo-600" />
                {dbStatus?.type || 'TiDB Cloud (MySQL)'}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Host</span>
              <span className="font-bold text-slate-800 flex items-center gap-1.5 mt-0.5 truncate" title={dbStatus?.host || host}>
                <Cpu className="w-3.5 h-3.5 text-slate-600" />
                {dbStatus?.host || host}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Database / Port</span>
              <span className="font-bold text-slate-800 flex items-center gap-1.5 mt-0.5 truncate">
                <Layers className="w-3.5 h-3.5 text-slate-600" />
                {dbStatus?.database || 'test'} : {dbStatus?.port || 4000}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Cluster Authentication</span>
              <span className="font-bold text-emerald-700 flex items-center gap-1.5 mt-0.5 truncate">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                {dbStatus?.hasPassword ? 'TLS Password Auth' : 'Waiting for Credentials'}
              </span>
            </div>
          </div>

          {/* Table Counts if available */}
          {dbStatus?.tableCounts && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Persisted TiDB Records</span>
                <span className="text-indigo-600 font-semibold text-[10px]">Auto-Synced</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <div className="font-extrabold text-slate-900">{dbStatus.tableCounts.students ?? 10}</div>
                  <div className="text-[10px] text-slate-500">Students</div>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <div className="font-extrabold text-slate-900">{dbStatus.tableCounts.faculty ?? 4}</div>
                  <div className="text-[10px] text-slate-500">Faculty</div>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <div className="font-extrabold text-slate-900">{dbStatus.tableCounts.attendance ?? 240}</div>
                  <div className="text-[10px] text-slate-500">Attendance Logs</div>
                </div>
              </div>
            </div>
          )}

          {/* TiDB Connection Credentials Accordion */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
            <button
              type="button"
              onClick={() => setShowConfigForm(!showConfigForm)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-indigo-600" />
                <span>TiDB Cloud Connection Settings</span>
              </div>
              {showConfigForm ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>

            {showConfigForm && (
              <form onSubmit={handleConnect} className="p-4 bg-white border-t border-slate-200 space-y-3">
                <p className="text-[11px] text-slate-500">
                  Enter your TiDB Serverless/Dedicated connection details below to connect and sync data.
                </p>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">TiDB Host</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="gateway01.ap-southeast-1.prod.aws.tidbcloud.com"
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Port</label>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="4000"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Database</label>
                    <input
                      type="text"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      placeholder="test"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">User</label>
                  <input
                    type="text"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="3sofZfmeAkgsoaf.root"
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    TiDB Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter TiDB cluster password"
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono"
                    required
                  />
                </div>

                <div className="pt-1 flex items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={isConnecting || !password}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isConnecting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Connecting & Initializing...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Connect & Sync All Tables</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Sync Result notification */}
          {syncResult && (
            <div
              className={`p-3 rounded-lg text-xs font-semibold ${
                syncResult.success
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {syncResult.message}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-200 border border-slate-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Checking...' : 'Check Connection'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={isDbSyncing}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ArrowUpDown className={`w-3.5 h-3.5 ${isDbSyncing ? 'animate-spin' : ''}`} />
              <span>{isDbSyncing ? 'Syncing...' : 'Sync to TiDB'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
