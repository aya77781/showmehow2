"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/app/admin/_components/Modal";

interface CacheEntry {
  id: string;
  type: string;
  key: string;
  hits: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function CachePage() {
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<CacheEntry | null>(null);
  const [viewValue, setViewValue] = useState<string>("");
  const [confirmFlush, setConfirmFlush] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(type ? { type } : {}),
      });
      const res = await fetch(`/api/admin/cache?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setEntries(json.entries);
      setTotal(json.total);
      setTypes(json.types);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, type]);

  useEffect(() => {
    load();
  }, [load]);

  async function openViewer(entry: CacheEntry) {
    setViewing(entry);
    setViewValue("Loading…");
    try {
      const res = await fetch(`/api/admin/cache/${entry.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setViewValue(JSON.stringify(json.entry.value, null, 2));
    } catch (e) {
      setViewValue(`Error: ${(e as Error).message}`);
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this cache entry?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/cache/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function flushAll() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/cache${type ? `?type=${encodeURIComponent(type)}` : ""}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setConfirmFlush(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Cache</h1>
          <p className="text-slate-400 text-sm mt-1">{total} entries</p>
        </div>
        <button
          onClick={() => setConfirmFlush(true)}
          className="px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 rounded-xl text-sm"
        >
          {type ? `Flush "${type}"` : "Flush all cache"}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value);
          }}
          className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 mb-4">
          {error}
        </div>
      )}

      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden backdrop-blur">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-slate-400 uppercase text-xs tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Key</th>
                <th className="text-right px-4 py-3 font-medium">Hits</th>
                <th className="text-left px-4 py-3 font-medium">Expires</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500 py-8">
                    Loading…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500 py-8">
                    No entries.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded text-xs">
                        {e.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs max-w-md truncate">{e.key}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{e.hits}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {formatDate(e.expires_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {formatDate(e.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => openViewer(e)}
                        className="text-indigo-400 hover:text-indigo-300 text-xs mr-3"
                      >
                        View
                      </button>
                      <button
                        onClick={() => deleteEntry(e.id)}
                        disabled={busy}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-slate-400">
        <div>
          Page {page} of {totalPages}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg disabled:opacity-40 hover:bg-white/10"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg disabled:opacity-40 hover:bg-white/10"
          >
            Next
          </button>
        </div>
      </div>

      {viewing && (
        <Modal
          title={`${viewing.type} / ${viewing.key}`}
          size="lg"
          onClose={() => {
            setViewing(null);
            setViewValue("");
          }}
        >
          <pre className="bg-black/50 border border-white/10 rounded-xl p-4 text-xs overflow-auto max-h-[60vh] whitespace-pre-wrap break-all">
            {viewValue}
          </pre>
        </Modal>
      )}

      {confirmFlush && (
        <Modal title="Flush cache" onClose={() => setConfirmFlush(false)}>
          <p className="text-sm text-slate-300">
            {type
              ? `This will delete all cache entries of type "${type}".`
              : "This will delete EVERY cache entry across all types."}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setConfirmFlush(false)}
              className="px-4 py-2 text-slate-300 hover:text-white text-sm"
            >
              Cancel
            </button>
            <button
              onClick={flushAll}
              disabled={busy}
              className="px-4 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-50 rounded-xl text-sm font-medium"
            >
              {busy ? "Flushing…" : "Flush"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
