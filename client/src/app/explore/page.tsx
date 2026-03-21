"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

interface TutorialCard {
  slug: string; topic: string; title: string; category: string;
  tags: string[]; steps: number; views: number; likes: number;
  sessionId: string; thumbnail: string | null;
  author: { name: string; picture?: string };
  createdAt: string;
}

interface Category { id: string; label: string; icon: string }

const ICON_MAP: Record<string, string> = {
  code: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  palette: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10",
  megaphone: "M3 11l18-5v12L3 13v-2z",
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  database: "M12 2C6.48 2 2 4.24 2 7v10c0 2.76 4.48 5 10 5s10-2.24 10-5V7c0-2.76-4.48-5-10-5z",
  server: "M2 4h20v6H2zM2 14h20v6H2z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
};

function ago(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`; const days = Math.floor(h / 24);
  if (days < 30) return `${days}d`; return `${Math.floor(days / 30)}mo`;
}

export default function Explore() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><span className="text-slate-500">Loading...</span></div>}>
      <ExploreInner />
    </Suspense>
  );
}

function ExploreInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tutorials, setTutorials] = useState<TutorialCard[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeCategory = searchParams.get("category") || "all";
  const searchQuery = searchParams.get("search") || "";
  const sort = searchParams.get("sort") || "recent";

  const fetchTutorials = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (activeCategory !== "all") params.set("category", activeCategory);
      if (searchQuery) params.set("search", searchQuery);
      params.set("sort", sort);

      const res = await fetch(`${API}/api/explore?${params}`);
      if (!res.ok) throw new Error("Failed to load tutorials");
      const data = await res.json();
      setTutorials(data.items || []);
      setTotal(data.total || 0);
      if (data.categories) setCategories(data.categories);
    } catch (err: any) { setError(err.message || "Failed to load"); } finally { setLoading(false); }
  }, [activeCategory, searchQuery, sort]);

  useEffect(() => { fetchTutorials(); }, [fetchTutorials]);

  const updateParams = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all" && value !== "recent") params.set(key, value);
    else params.delete(key);
    router.push(`/explore?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <a href="/" className="text-xl font-bold">ShowMe<span className="text-indigo-400">AI</span></a>
          <div className="flex items-center gap-3">
            <a href="/pricing" className="text-sm text-slate-400 hover:text-white transition">Pricing</a>
            <a href="/login" className="px-3 py-1.5 text-sm bg-indigo-500 rounded-lg hover:bg-indigo-400 transition font-medium">Sign In</a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Explore Tutorials</h1>
          <p className="text-slate-500 text-sm">AI-generated video tutorials on any topic. Watch, learn, share.</p>
        </div>

        {/* Search */}
        <div className="max-w-xl mx-auto mb-8">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              defaultValue={searchQuery}
              onKeyDown={e => { if (e.key === "Enter") updateParams("search", (e.target as HTMLInputElement).value); }}
              placeholder="Search tutorials..."
              className="w-full pl-11 pr-4 py-3 bg-white/[0.03] border border-white/10 rounded-xl text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
          <button
            onClick={() => updateParams("category", "all")}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              activeCategory === "all" ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-400 hover:bg-white/10"
            }`}
          >All</button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => updateParams("category", cat.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition flex items-center gap-1.5 ${
                activeCategory === cat.id ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Sort + count */}
        <div className="flex items-center justify-between mb-5">
          <p className="text-slate-500 text-sm">{total} tutorial{total !== 1 ? "s" : ""}</p>
          <div className="flex gap-1">
            {[
              { id: "recent", label: "Recent" },
              { id: "popular", label: "Popular" },
              { id: "likes", label: "Most Liked" },
            ].map(s => (
              <button
                key={s.id}
                onClick={() => updateParams("sort", s.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                  sort === s.id ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-400"
                }`}
              >{s.label}</button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {error ? (
          <div className="text-center py-20">
            <p className="text-red-400 text-lg mb-2">Something went wrong</p>
            <p className="text-slate-600 text-sm mb-4">{error}</p>
            <button onClick={fetchTutorials} className="px-5 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-400 transition">Retry</button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white/[0.02] border border-white/5 rounded-2xl h-64 animate-pulse" />
            ))}
          </div>
        ) : tutorials.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-600 text-lg mb-2">No tutorials found</p>
            <p className="text-slate-700 text-sm">Be the first to publish one!</p>
            <a href="/dashboard" className="mt-4 inline-block px-5 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-400 transition">
              Create Tutorial
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {tutorials.map(t => (
              <a
                key={t.slug}
                href={`/tutorial/${t.slug}`}
                className="group bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden hover:border-white/15 transition"
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-slate-900 relative overflow-hidden">
                  {t.thumbnail && t.sessionId ? (
                    <img
                      src={`${API}${t.thumbnail}`}
                      alt={t.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-700">
                      <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 rounded text-[10px] text-white font-medium">
                    {t.steps} steps
                  </div>
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="text-sm font-bold text-white mb-1 line-clamp-2 group-hover:text-indigo-400 transition">{t.title}</h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-600 mb-2">
                    <span className="capitalize">{t.category}</span>
                    <span>&middot;</span>
                    <span>{ago(t.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {t.author.picture ? (
                        <img src={t.author.picture} alt="" className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-[8px] font-bold">
                          {t.author.name?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <span className="text-[11px] text-slate-600">{t.author.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-700">
                      <span className="flex items-center gap-0.5">
                        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        {t.views}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                        {t.likes}
                      </span>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
