"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface AdminProject {
  id: string;
  topic: string | null;
  source: string | null;
  status: string;
  is_public: boolean;
  is_featured: boolean;
  views: number;
  likes: number;
  created_at: string;
  user_id: string;
  users: { email: string } | { email: string }[] | null;
}

const STATUSES = ["draft", "generating", "ready", "video_generating", "complete", "error"];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  generating: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  ready: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  video_generating: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  complete: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  error: "bg-red-500/20 text-red-300 border-red-500/30",
};

function userEmail(u: AdminProject["users"]) {
  if (!u) return "—";
  return Array.isArray(u) ? u[0]?.email || "—" : u.email;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
        dir,
        ...(status ? { status } : {}),
        ...(source ? { source } : {}),
      });
      const res = await fetch(`/api/admin/projects?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setProjects(json.projects);
      setTotal(json.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, status, source, sort, dir]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSort(col: string) {
    if (sort === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(col);
      setDir("desc");
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Projects</h1>
        <p className="text-slate-400 text-sm mt-1">{total} total</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Source filter…"
          value={source}
          onChange={(e) => {
            setPage(1);
            setSource(e.target.value);
          }}
          className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
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
                <th className="text-left px-4 py-3 font-medium">Topic</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Source</th>
                <SortTh label="Views" col="views" sort={sort} dir={dir} onClick={toggleSort} />
                <SortTh label="Likes" col="likes" sort={sort} dir={dir} onClick={toggleSort} />
                <th className="text-center px-4 py-3 font-medium">Featured</th>
                <SortTh
                  label="Created"
                  col="created_at"
                  sort={sort}
                  dir={dir}
                  onClick={toggleSort}
                />
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center text-slate-500 py-8">
                    Loading…
                  </td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-slate-500 py-8">
                    No projects found.
                  </td>
                </tr>
              ) : (
                projects.map((p) => (
                  <tr key={p.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium max-w-xs truncate">
                      {p.topic || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{userEmail(p.users)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium ${STATUS_COLORS[p.status] ?? STATUS_COLORS.draft}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{p.source || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.views}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.likes}</td>
                    <td className="px-4 py-3 text-center">
                      <FeatureToggle project={p} onChange={load} />
                    </td>
                    <td className="px-4 py-3 text-slate-400">{formatDate(p.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/projects/${p.id}`}
                        className="text-indigo-400 hover:text-indigo-300 text-xs"
                      >
                        Details →
                      </Link>
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
    </div>
  );
}

function FeatureToggle({
  project,
  onChange,
}: {
  project: AdminProject;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const featured = project.is_featured;
  const canFeature = project.status === "complete";

  async function toggle() {
    if (!canFeature || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_featured: !featured }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      onChange();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!canFeature) {
    return <span className="text-slate-600 text-xs">—</span>;
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium transition disabled:opacity-50 ${
        featured
          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30"
          : "bg-white/5 text-slate-400 border-white/10 hover:bg-white/10"
      }`}
    >
      {busy ? "…" : featured ? "Published" : "Publish"}
    </button>
  );
}

function SortTh({
  label,
  col,
  sort,
  dir,
  onClick,
}: {
  label: string;
  col: string;
  sort: string;
  dir: "asc" | "desc";
  onClick: (col: string) => void;
}) {
  const active = sort === col;
  return (
    <th className="text-right px-4 py-3 font-medium">
      <button
        onClick={() => onClick(col)}
        className={`uppercase text-xs tracking-wider ${active ? "text-indigo-300" : "text-slate-400"} hover:text-white`}
      >
        {label} {active ? (dir === "asc" ? "↑" : "↓") : ""}
      </button>
    </th>
  );
}
