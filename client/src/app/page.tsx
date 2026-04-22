"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

// ── SVG Icon components ────────────────────────────────────
const icons = {
  pencil: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  search: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  fileText: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  image: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>,
  mic: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>,
  user: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  film: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>,
  eye: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  zap: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  messageCircle: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  globe: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  link: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  trendingUp: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  users: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  refreshCw: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  play: <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>,
};

// ── Scroll reveal hook ─────────────────────────────────────
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, cls: visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8" };
}

// ── Typing animation ───────────────────────────────────────
const EXAMPLES = [
  "How to deploy a Next.js app on Vercel",
  "How to create a GitHub repository",
  "How to set up Google Ads campaigns",
  "How to use Docker containers",
  "How to add OAuth login with Firebase",
];

function TypingHero() {
  const [text, setText] = useState("");
  const [idx, setIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const target = EXAMPLES[idx];
    const speed = deleting ? 30 : 60;
    const timer = setTimeout(() => {
      if (!deleting) {
        if (charIdx < target.length) { setText(target.slice(0, charIdx + 1)); setCharIdx(charIdx + 1); }
        else setTimeout(() => setDeleting(true), 2000);
      } else {
        if (charIdx > 0) { setText(target.slice(0, charIdx - 1)); setCharIdx(charIdx - 1); }
        else { setDeleting(false); setIdx((idx + 1) % EXAMPLES.length); }
      }
    }, speed);
    return () => clearTimeout(timer);
  }, [charIdx, deleting, idx]);

  return (
    <span className="text-white">
      {text}<span className="inline-block w-[2px] h-6 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
    </span>
  );
}

// ── Category styles ────────────────────────────────────────
const CATEGORIES: Record<string, string> = {
  dev: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  devops: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  productivity: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  marketing: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  design: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  data: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  other: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const CAT_LABELS: Record<string, string> = {
  dev: "Development", devops: "DevOps", productivity: "Productivity",
  marketing: "Marketing", design: "Design", data: "Data & AI", other: "Other",
};

// ── Types ──────────────────────────────────────────────────
interface PublicTutorial {
  slug: string;
  topic: string;
  title: string;
  category: string;
  tags: string[];
  views: number;
  likes: number;
  steps: number;
  sessionId?: string;
  thumbnail?: string | null;
  author?: { name: string; picture?: string };
  createdAt: string;
}

// ── Main Landing ───────────────────────────────────────────
export default function Landing() {
  const pipeline = useReveal();
  const features = useReveal();
  const gallery = useReveal();
  const vision = useReveal();
  const pricing = useReveal();
  const plg = useReveal();
  const cta = useReveal();

  const [tutorials, setTutorials] = useState<PublicTutorial[]>([]);

  useEffect(() => {
    fetch(`${API}/api/explore?limit=6&sort=recent`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.items)) setTutorials(data.items); })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-x-hidden">

      {/* ── Navbar ──────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-6 md:px-8 py-4 max-w-7xl mx-auto">
          <span className="text-xl font-bold tracking-tight">
            ShowMe<span className="text-indigo-400">How</span><span className="text-indigo-300 font-normal text-[0.7em]">.ai</span>
          </span>
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-400">
            <a href="#how" className="hover:text-white transition">How it works</a>
            <a href="#features" className="hover:text-white transition">Features</a>
            <a href="#gallery" className="hover:text-white transition">Gallery</a>
            <a href="#pricing" className="hover:text-white transition">Pricing</a>
          </div>
          <div className="flex gap-3 items-center">
            <Link href="/login" className="text-sm text-slate-400 hover:text-white transition hidden sm:block">Sign In</Link>
            <Link href="/login?tab=register" className="px-4 py-2 bg-indigo-500 text-white text-sm font-semibold rounded-lg hover:bg-indigo-400 transition">
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="relative pt-20 md:pt-28 pb-24 px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px]" />
        </div>

        <div className="relative max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-300 text-sm mb-8">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            AMS GenAI &amp; Video Hackathon 2026
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.1] tracking-tight">
            Learn anything with{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent bg-[length:200%] animate-[gradient_3s_ease_infinite]">
              AI video tutorials
            </span>
          </h1>

          <p className="mt-6 text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Type a topic. Get a personalized video tutorial with real screenshots,
            AI voice narration — in under 2 minutes.
          </p>

          {/* Fake input with typing animation */}
          <div className="mt-10 max-w-2xl mx-auto">
            <div className="relative bg-white/[0.03] border border-white/10 rounded-2xl px-4 md:px-5 py-3 md:py-4 flex items-center gap-3 hover:border-indigo-500/30 transition group">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-slate-600 shrink-0 hidden sm:block"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <div className="flex-1 text-left text-base md:text-lg min-w-0 truncate">
                <TypingHero />
              </div>
              <Link href="/login?tab=register" className="px-4 md:px-5 py-2 md:py-2.5 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-400 transition text-sm shrink-0">
                Generate
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {EXAMPLES.slice(0, 3).map(s => (
                <Link key={s} href="/login?tab=register"
                  className="px-3 py-1.5 text-xs text-slate-600 bg-white/[0.02] border border-white/5 rounded-lg hover:bg-white/[0.05] hover:text-slate-400 transition truncate max-w-[200px] md:max-w-none">
                  {s}
                </Link>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {[
              { value: "<2min", label: "Average generation" },
              { value: "7", label: "AI pipeline steps" },
              { value: "∞", label: "Topics supported" },
              { value: "Free", label: "First tutorial" },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <p className="text-2xl md:text-3xl font-bold bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">{s.value}</p>
                <p className="text-xs text-slate-600 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Demo mockup */}
          <div className="mt-16 max-w-3xl mx-auto rounded-2xl overflow-hidden border border-white/10 bg-slate-900/60 backdrop-blur shadow-2xl shadow-indigo-500/5">
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/80 border-b border-white/5">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              </div>
              <div className="flex-1 mx-8">
                <div className="bg-white/5 rounded-md px-3 py-1 text-[11px] text-slate-600 text-center">app.showmehow.ai/dashboard</div>
              </div>
            </div>
            <div className="relative aspect-video bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 flex items-center justify-center">
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, #6366f1 0%, transparent 50%), radial-gradient(circle at 80% 70%, #22d3ee 0%, transparent 50%)" }} />
              <div className="relative w-20 h-20 rounded-full bg-indigo-500/20 border-2 border-indigo-400/40 flex items-center justify-center backdrop-blur-sm hover:scale-110 transition cursor-pointer group">
                <svg width="32" height="32" fill="currentColor" viewBox="0 0 24 24" className="text-indigo-400 ml-1 group-hover:text-white transition"><path d="M8 5v14l11-7z"/></svg>
              </div>
              {/* Avatar PiP */}
              <div className="absolute bottom-4 right-4 w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center backdrop-blur-sm">
                <div className="w-12 h-12 rounded-full bg-indigo-500/30 flex items-center justify-center text-indigo-300">
                  <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
              </div>
              <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-lg text-xs text-slate-300 border border-white/10">
                Step 3 of 8 — <span className="text-indigo-400">Configuring deployment</span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/5">
                <div className="h-full bg-indigo-500 rounded-r-full" style={{ width: "38%" }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pipeline ───────────────────────────────────────── */}
      <section id="how" className="py-24 px-6 border-t border-white/5">
        <div ref={pipeline.ref} className={`max-w-4xl mx-auto transition-all duration-700 ${pipeline.cls}`}>
          <div className="text-center mb-16">
            <p className="text-indigo-400 text-sm font-medium uppercase tracking-widest mb-3">The pipeline</p>
            <h2 className="text-3xl md:text-5xl font-bold">From question to video in 7 steps</h2>
            <p className="text-slate-400 mt-4 max-w-xl mx-auto">Everything is fully automatic. You just type a topic and wait ~90 seconds.</p>
          </div>

          <div className="relative">
            <div className="absolute left-6 md:left-8 top-0 bottom-0 w-px bg-gradient-to-b from-indigo-500 via-emerald-500 to-yellow-500 opacity-20" />

            <div className="space-y-6">
              {[
                { icon: icons.pencil, label: "You type a topic", color: "from-indigo-500 to-indigo-600", time: "0s" },
                { icon: icons.search, label: "AI researches with web search", color: "from-blue-500 to-cyan-500", time: "~15s" },
                { icon: icons.fileText, label: "AI writes step-by-step script", color: "from-cyan-500 to-teal-500", time: "~20s" },
                { icon: icons.image, label: "Serper finds real screenshots", color: "from-teal-500 to-emerald-500", time: "~25s" },
                { icon: icons.mic, label: "Generating narration", color: "from-emerald-500 to-green-500", time: "~40s" },
                { icon: icons.mic, label: "AI voice records narration", color: "from-green-500 to-lime-500", time: "~60s" },
                { icon: icons.film, label: "FFmpeg composites final video", color: "from-lime-500 to-yellow-500", time: "~90s" },
              ].map((p, i) => (
                <div key={i} className="relative flex items-center gap-5 md:gap-6 group">
                  <div className={`relative z-10 w-12 h-12 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br ${p.color} flex items-center justify-center text-white shrink-0 shadow-lg group-hover:scale-110 transition-transform`}>
                    {p.icon}
                  </div>
                  <div className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl px-5 py-4 group-hover:bg-white/[0.04] group-hover:border-white/10 transition">
                    <div className="flex items-center justify-between">
                      <p className="text-white font-medium">{p.label}</p>
                      <span className="text-xs text-slate-600 font-mono">{p.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 ml-[4.25rem] md:ml-[5.5rem] bg-gradient-to-r from-indigo-500/10 to-cyan-500/10 border border-indigo-500/20 rounded-xl px-5 py-4">
              <div className="flex items-center gap-3">
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="text-green-400"><path d="M5 13l4 4L19 7"/></svg>
                <div>
                  <p className="text-white font-semibold">Your video tutorial is ready</p>
                  <p className="text-slate-500 text-sm">Download MP4, share link, or ask AI questions about the topic</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────── */}
      <section id="features" className="py-24 px-6 border-t border-white/5 bg-gradient-to-b from-slate-950 to-indigo-950/20">
        <div ref={features.ref} className={`max-w-6xl mx-auto transition-all duration-700 ${features.cls}`}>
          <div className="text-center mb-16">
            <p className="text-indigo-400 text-sm font-medium uppercase tracking-widest mb-3">Features</p>
            <h2 className="text-3xl md:text-5xl font-bold">Everything you need to learn faster</h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: icons.eye, iconColor: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20", title: "Real screenshots, not mockups", desc: "AI searches the web for actual UI screenshots and validates them with vision AI. What you see is the real product.", tag: "AI Vision", tagColor: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20" },
              { icon: icons.mic, iconColor: "text-purple-400 bg-purple-500/10 border-purple-500/20", title: "Natural AI voice", desc: "A clear, natural-sounding AI voice narrates every step. It feels like a private tutor walking you through the process.", tag: "Personalized", tagColor: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
              { icon: icons.zap, iconColor: "text-amber-400 bg-amber-500/10 border-amber-500/20", title: "Ready in under 2 min", desc: "The entire pipeline runs in ~90 seconds. Research, screenshots, audio, and video compositing — all automatic.", tag: "Fast", tagColor: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
              { icon: icons.messageCircle, iconColor: "text-green-400 bg-green-500/10 border-green-500/20", title: "AI tutor chat", desc: "After watching, ask follow-up questions. The AI has full context about the tutorial and can search the web for answers.", tag: "Interactive", tagColor: "text-green-400 bg-green-500/10 border-green-500/20" },
              { icon: icons.globe, iconColor: "text-pink-400 bg-pink-500/10 border-pink-500/20", title: "Share & explore", desc: "Publish your tutorials to the Explore feed. Discover what others are learning. Build a public knowledge base.", tag: "Community", tagColor: "text-pink-400 bg-pink-500/10 border-pink-500/20" },
            ].map((f, i) => (
              <div key={i} className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:bg-white/[0.04] hover:border-white/10 transition group">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${f.iconColor}`}>
                    {f.icon}
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-1 rounded-full border ${f.tagColor}`}>{f.tag}</span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2 group-hover:text-indigo-300 transition">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Video Gallery (Real from DB) ───────────────────── */}
      <section id="gallery" className="py-24 px-6 border-t border-white/5">
        <div ref={gallery.ref} className={`max-w-6xl mx-auto transition-all duration-700 ${gallery.cls}`}>
          <div className="text-center mb-16">
            <p className="text-indigo-400 text-sm font-medium uppercase tracking-widest mb-3">Gallery</p>
            <h2 className="text-3xl md:text-5xl font-bold">Real tutorials, generated by AI</h2>
            <p className="text-slate-400 mt-4">These are actual tutorials created with ShowMeHow.ai — click to watch</p>
          </div>

          {tutorials.length === 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse">
                  <div className="aspect-video bg-white/5 rounded-t-2xl" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-white/5 rounded w-3/4" />
                    <div className="h-3 bg-white/5 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {tutorials.map((t) => (
                <Link key={t.slug} href={`/tutorial/${t.slug}`}
                  className="group rounded-2xl overflow-hidden border border-white/5 hover:border-white/10 bg-white/[0.02] transition cursor-pointer block">
                  {/* Thumbnail — real screenshot from session */}
                  <div className="relative aspect-video bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center overflow-hidden">
                    {t.thumbnail && t.sessionId ? (
                      <img
                        src={`${API}${t.thumbnail}`}
                        alt={t.title || t.topic}
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : null}
                    {/* Play overlay */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-black/40 border border-white/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all group-hover:scale-100 scale-75 backdrop-blur-sm">
                        <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24" className="text-white ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                    </div>
                    {/* Steps count */}
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 rounded text-[10px] text-white font-mono backdrop-blur-sm">
                      {t.steps} steps
                    </span>
                    {/* Avatar PiP */}
                    {t.author?.picture ? (
                      <img src={t.author.picture} alt="" referrerPolicy="no-referrer"
                        className="absolute bottom-2 left-2 w-8 h-8 rounded-lg border border-white/10 object-cover" />
                    ) : (
                      <div className="absolute bottom-2 left-2 w-8 h-8 rounded-lg bg-slate-800/80 border border-white/10 flex items-center justify-center text-indigo-400 text-[10px] font-bold">
                        {t.author?.name?.[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-4">
                    <p className="text-sm font-semibold text-white group-hover:text-indigo-300 transition truncate">
                      {t.title || t.topic}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${CATEGORIES[t.category] || CATEGORIES.other}`}>
                        {CAT_LABELS[t.category] || t.category}
                      </span>
                      {t.views > 0 && (
                        <span className="text-[10px] text-slate-600 flex items-center gap-1">
                          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          {t.views}
                        </span>
                      )}
                      {t.tags?.length > 0 && (
                        <span className="text-[10px] text-slate-700 truncate">{t.tags.slice(0, 2).join(", ")}</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {tutorials.length > 0 && (
            <div className="text-center mt-10">
              <Link href="/explore" className="inline-flex items-center gap-2 px-6 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm font-medium text-slate-400 hover:bg-white/10 hover:text-white transition">
                View all tutorials
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ── AI Vision Section ──────────────────────────────── */}
      <section className="py-24 px-6 border-t border-white/5 bg-gradient-to-b from-slate-950 to-cyan-950/10">
        <div ref={vision.ref} className={`max-w-5xl mx-auto transition-all duration-700 ${vision.cls}`}>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-cyan-400 text-sm font-medium uppercase tracking-widest mb-3">AI Vision</p>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Not just any screenshot — the <span className="text-cyan-400">best</span> one</h2>
              <p className="text-slate-400 leading-relaxed mb-6">
                For each step, our pipeline searches multiple image candidates, then uses AI vision to validate and pick the most relevant screenshot.
                No stock photos. No mockups. Real UI from real products.
              </p>
              <div className="space-y-3">
                {[
                  "Serper Image Search finds candidates",
                  "AI vision validates each image",
                  "Best match is auto-selected",
                  "You can manually pick alternatives",
                ].map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" className="text-cyan-400"><path d="M5 13l4 4L19 7"/></svg>
                    </div>
                    <span className="text-sm text-slate-300">{t}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Candidate 1", valid: true, best: false },
                { label: "Candidate 2", valid: false, best: false },
                { label: "Candidate 3", valid: true, best: true },
                { label: "Candidate 4", valid: true, best: false },
              ].map((c, i) => (
                <div key={i} className={`relative aspect-[4/3] rounded-xl border-2 transition ${
                  c.best ? "border-cyan-400 bg-cyan-500/5 shadow-lg shadow-cyan-500/10" :
                  c.valid ? "border-white/10 bg-white/[0.02]" :
                  "border-red-500/20 bg-red-500/5 opacity-50"
                } flex flex-col items-center justify-center gap-2`}>
                  <div className={`w-10 h-8 rounded ${c.valid ? "bg-white/10" : "bg-red-500/10"}`} />
                  <div className={`w-16 h-1 rounded-full ${c.valid ? "bg-white/10" : "bg-red-500/10"}`} />
                  <div className={`w-12 h-1 rounded-full ${c.valid ? "bg-white/5" : "bg-red-500/5"}`} />
                  {c.best && (
                    <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-cyan-500 text-white text-[10px] font-bold rounded-full shadow-lg">
                      BEST
                    </div>
                  )}
                  {!c.valid && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="text-red-400 opacity-40"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </div>
                  )}
                  <span className={`text-[10px] ${c.best ? "text-cyan-400" : c.valid ? "text-slate-600" : "text-red-400/60"}`}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6 border-t border-white/5">
        <div ref={pricing.ref} className={`max-w-4xl mx-auto transition-all duration-700 ${pricing.cls}`}>
          <div className="text-center mb-14">
            <p className="text-indigo-400 text-sm font-medium uppercase tracking-widest mb-3">Pricing</p>
            <h2 className="text-3xl md:text-5xl font-bold">Simple, transparent pricing</h2>
            <p className="text-slate-400 mt-4">Pay per video or go unlimited. No hidden fees.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              { name: "Free", price: "0", period: "", features: ["1 video tutorial", "AI script generation", "Real screenshots", "Download MP4"], cta: "Get Started", highlight: false },
              { name: "Pack 10", price: "5", period: "one-time", features: ["10 video tutorials", "AI voice narration", "Real screenshots", "Download MP4", "AI chat tutor", "Make videos private"], cta: "Buy Pack 10", highlight: false },
              { name: "Pack 20", price: "10", period: "one-time", features: ["20 video tutorials", "AI voice narration", "Real screenshots", "Download MP4", "AI chat tutor", "Make videos private", "Priority rendering"], cta: "Buy Pack 20", highlight: true },
            ].map((plan, i) => (
              <div key={i} className={`relative rounded-2xl p-6 transition ${
                plan.highlight
                  ? "bg-gradient-to-b from-indigo-500 to-indigo-600 ring-2 ring-indigo-400/50 shadow-xl shadow-indigo-500/20 scale-[1.02]"
                  : "bg-white/[0.02] border border-white/10 hover:border-white/15"
              }`}>
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-indigo-400 text-white text-[10px] font-bold uppercase tracking-wider rounded-full">
                    Most popular
                  </div>
                )}
                <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                <p className="mb-5">
                  <span className="text-4xl font-extrabold">&euro;{plan.price}</span>
                  <span className="text-sm opacity-60 ml-1">{plan.period}</span>
                </p>
                <ul className="space-y-2.5 mb-6">
                  {plan.features.map((f, j) => (
                    <li key={j} className="text-sm flex items-center gap-2.5">
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className={plan.highlight ? "text-indigo-200" : "text-indigo-400"}><path d="M5 13l4 4L19 7"/></svg>
                      <span className={plan.highlight ? "text-indigo-100" : "text-slate-300"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/login?tab=register" className={`block text-center py-3 rounded-xl font-semibold transition ${
                  plan.highlight
                    ? "bg-white text-indigo-600 hover:bg-indigo-50 shadow-lg"
                    : "bg-white/5 border border-white/10 hover:bg-white/10"
                }`}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-slate-600 text-xs mt-6">
            Cached tutorials cost less to regenerate. All prices in EUR.
          </p>
        </div>
      </section>

      {/* ── PLG / SEO ──────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-white/5 bg-gradient-to-b from-slate-950 to-indigo-950/10">
        <div ref={plg.ref} className={`max-w-5xl mx-auto transition-all duration-700 ${plg.cls}`}>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-green-400 text-sm font-medium uppercase tracking-widest mb-3">Public tutorials</p>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Every tutorial is a <span className="text-green-400">landing page</span></h2>
              <p className="text-slate-400 leading-relaxed mb-6">
                Publish your tutorials with a public URL. They get indexed by Google, bring organic traffic,
                and convert viewers into users. Product-led growth, built in.
              </p>
              <div className="space-y-4">
                {[
                  { icon: icons.link, title: "SEO-friendly URLs", desc: "showmehow.ai/tutorial/deploy-nextjs-vercel" },
                  { icon: icons.trendingUp, title: "Organic discovery", desc: "Google indexes every public tutorial" },
                  { icon: icons.users, title: "Explore feed", desc: "Users browse and discover community tutorials" },
                  { icon: icons.refreshCw, title: "Viral loop", desc: "Viewers sign up to create their own tutorials" },
                ].map((r, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 shrink-0">
                      {r.icon}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{r.title}</p>
                      <p className="text-xs text-slate-500">{r.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* URL mockup — real slugs from DB */}
            <div className="space-y-3">
              {(tutorials.length > 0
                ? tutorials.slice(0, 3).map(t => ({
                    url: `/tutorial/${t.slug}`,
                    title: t.title || t.topic,
                    views: `${t.views || 0} views`,
                  }))
                : [
                    { url: "/tutorial/deploy-nextjs-vercel", title: "Deploy Next.js on Vercel", views: "0 views" },
                    { url: "/tutorial/github-repository-setup", title: "Create a GitHub Repository", views: "0 views" },
                    { url: "/tutorial/docker-containers", title: "How to use Docker Containers", views: "0 views" },
                  ]
              ).map((p, i) => (
                <div key={i} className="bg-white/[0.02] border border-white/5 rounded-xl p-4 hover:bg-white/[0.04] transition">
                  <p className="text-[11px] text-green-400/60 font-mono mb-1 truncate">showmehow.ai{p.url}</p>
                  <p className="text-sm font-medium text-white">{p.title}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-slate-600 flex items-center gap-1">
                      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      {p.views}
                    </span>
                    <span className="text-[10px] text-indigo-400">Watch free</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-white/5">
        <div ref={cta.ref} className={`max-w-2xl mx-auto text-center transition-all duration-700 ${cta.cls}`}>
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-6">
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="text-indigo-400"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Stop searching. Start learning.
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Generate your first AI video tutorial in under 2 minutes. Free.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login?tab=register"
              className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-indigo-500 text-white font-bold rounded-xl text-lg hover:bg-indigo-400 transition shadow-lg shadow-indigo-500/25"
            >
              Create free account
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/5 border border-white/10 text-white font-semibold rounded-xl text-lg hover:bg-white/10 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Sign in with Google
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">ShowMe<span className="text-indigo-400">How</span><span className="text-indigo-300 font-normal text-[0.7em]">.ai</span></span>
            <span className="text-slate-700 text-sm">|</span>
            <span className="text-slate-600 text-sm">AMS GenAI &amp; Video Hackathon 2026</span>
          </div>
          <div className="flex gap-6 text-sm text-slate-600">
            <Link href="/explore" className="hover:text-slate-400 transition">Explore</Link>
            <Link href="/pricing" className="hover:text-slate-400 transition">Pricing</Link>
            <Link href="/login" className="hover:text-slate-400 transition">Sign In</Link>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>
    </div>
  );
}
