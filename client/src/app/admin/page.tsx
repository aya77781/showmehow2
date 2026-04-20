"use client";

import { useEffect, useState } from "react";

interface Stats {
  users: number;
  projects: Record<string, number>;
  cacheEntries: number;
  storageBytes: Record<string, number>;
}

interface Activity {
  days: { date: string; count: number }[];
}

const PROJECT_STATUSES = [
  "draft",
  "generating",
  "ready",
  "video_generating",
  "complete",
  "error",
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  generating: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  ready: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  video_generating: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  complete: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  error: "bg-red-500/20 text-red-300 border-red-500/30",
};

function formatBytes(n: number) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/stats").then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load stats");
        return res.json() as Promise<Stats>;
      }),
      fetch("/api/admin/activity").then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load activity");
        return res.json() as Promise<Activity>;
      }),
    ])
      .then(([s, a]) => {
        setStats(s);
        setActivity(a);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Overview of ShowMeHow system</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-block border-2 border-indigo-400 border-t-transparent rounded-full animate-spin w-4 h-4" />
          Loading…
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4">
          {error}
        </div>
      ) : stats ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Users" value={stats.users.toString()} />
            <StatCard label="Projects total" value={(stats.projects.total ?? 0).toString()} />
            <StatCard label="Cache entries" value={stats.cacheEntries.toString()} />
            <StatCard label="Storage used" value={formatBytes(stats.storageBytes.total ?? 0)} />
          </div>

          <section className="bg-slate-900/60 border border-white/10 rounded-2xl p-6 backdrop-blur">
            <h2 className="text-lg font-semibold mb-4">Projects by status</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {PROJECT_STATUSES.map((status) => (
                <div
                  key={status}
                  className="flex items-center justify-between px-4 py-3 bg-white/5 border border-white/10 rounded-xl"
                >
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium ${STATUS_COLORS[status]}`}
                  >
                    {status}
                  </span>
                  <span className="tabular-nums font-semibold">
                    {stats.projects[status] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {activity && <ActivityChart days={activity.days} />}

          <section className="bg-slate-900/60 border border-white/10 rounded-2xl p-6 backdrop-blur">
            <h2 className="text-lg font-semibold mb-4">Storage by bucket</h2>
            <div className="space-y-2">
              {Object.entries(stats.storageBytes)
                .filter(([k]) => k !== "total")
                .map(([bucket, bytes]) => (
                  <div
                    key={bucket}
                    className="flex items-center justify-between px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl"
                  >
                    <span className="text-sm text-slate-300 font-mono">{bucket}</span>
                    <span className="tabular-nums text-sm">{formatBytes(bytes)}</span>
                  </div>
                ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ActivityChart({ days }: { days: { date: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((s, d) => s + d.count, 0);
  const width = 800;
  const height = 160;
  const padding = { top: 10, right: 10, bottom: 24, left: 30 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barW = innerW / days.length;

  return (
    <section className="bg-slate-900/60 border border-white/10 rounded-2xl p-6 backdrop-blur">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Projects created — last 30 days</h2>
        <span className="text-sm text-slate-400">{total} total</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <line
          x1={padding.left}
          y1={padding.top + innerH}
          x2={padding.left + innerW}
          y2={padding.top + innerH}
          stroke="rgb(148 163 184 / 0.2)"
        />
        <text
          x={padding.left - 6}
          y={padding.top + 10}
          textAnchor="end"
          className="fill-slate-500 text-[10px]"
        >
          {max}
        </text>
        <text
          x={padding.left - 6}
          y={padding.top + innerH}
          textAnchor="end"
          className="fill-slate-500 text-[10px]"
        >
          0
        </text>
        {days.map((d, i) => {
          const h = (d.count / max) * innerH;
          const x = padding.left + i * barW + 1;
          const y = padding.top + innerH - h;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={Math.max(1, barW - 2)}
                height={h}
                fill="rgb(99 102 241)"
                opacity={0.8}
              >
                <title>
                  {d.date}: {d.count}
                </title>
              </rect>
            </g>
          );
        })}
        <text
          x={padding.left}
          y={height - 6}
          className="fill-slate-500 text-[10px]"
        >
          {days[0]?.date}
        </text>
        <text
          x={padding.left + innerW}
          y={height - 6}
          textAnchor="end"
          className="fill-slate-500 text-[10px]"
        >
          {days[days.length - 1]?.date}
        </text>
      </svg>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4 backdrop-blur">
      <div className="text-slate-400 text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
