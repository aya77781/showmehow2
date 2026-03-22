"use client";

import { useState, useRef } from "react";
import Link from "next/link";

interface Step {
  step: number; title: string; description: string;
  screenshot?: string; video?: string;
}

interface Tutorial {
  slug: string; topic: string; title: string; url?: string;
  category: string; tags: string[]; steps: Step[];
  sessionId: string; views: number; likes: number;
  author: { name: string; picture?: string };
  createdAt: string;
}

const CAT_LABELS: Record<string, string> = {
  dev: "Development", devops: "DevOps", productivity: "Productivity",
  marketing: "Marketing", design: "Design", data: "Data & AI", other: "Other",
};

const CAT_COLORS: Record<string, string> = {
  dev: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  devops: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  productivity: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  marketing: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  design: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  data: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  other: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

export default function TutorialView({ tutorial, api }: { tutorial: Tutorial; api: string }) {
  const [activeStep, setActiveStep] = useState(0);
  const [likes, setLikes] = useState(tutorial.likes);
  const [liked, setLiked] = useState(false);
  const [viewMode, setViewMode] = useState<"video" | "steps">("video");
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleLike = async () => {
    if (liked) return;
    setLiked(true);
    setLikes(l => l + 1);
    fetch(`${api}/api/explore/${tutorial.slug}/like`, { method: "POST" }).catch(() => {});
  };

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const step = tutorial.steps[activeStep];
  const hasVideo = !!tutorial.sessionId;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ── Header ─────────────────────────────────────── */}
      <header className="border-b border-white/5 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/" className="text-xl font-bold">ShowMe<span className="text-indigo-400">How</span><span className="text-indigo-300 font-normal text-[0.7em]">.ai</span></Link>
            <span className="text-slate-800">|</span>
            <Link href="/explore" className="text-sm text-slate-500 hover:text-white transition flex items-center gap-1.5">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
              Explore
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login?tab=register" className="px-4 py-1.5 text-sm bg-indigo-500 rounded-lg hover:bg-indigo-400 transition font-medium">
              Create your own
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* ── Breadcrumb ─────────────────────────────────── */}
        <nav className="flex items-center gap-2 text-xs text-slate-600 mb-5">
          <Link href="/explore" className="hover:text-slate-400 transition">Explore</Link>
          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
          <Link href={`/explore?category=${tutorial.category}`} className="hover:text-slate-400 transition">
            {CAT_LABELS[tutorial.category] || tutorial.category}
          </Link>
          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
          <span className="text-slate-400 truncate max-w-xs">{tutorial.title}</span>
        </nav>

        {/* ── Title + Meta ───────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold leading-tight">{tutorial.title}</h1>
              <div className="flex items-center gap-4 mt-3 flex-wrap">
                {/* Author */}
                <div className="flex items-center gap-2">
                  {tutorial.author.picture ? (
                    <img src={tutorial.author.picture} alt="" className="w-6 h-6 rounded-full ring-1 ring-white/10" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-[10px] font-bold ring-1 ring-white/10">
                      {tutorial.author.name?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm text-slate-400">{tutorial.author.name}</span>
                </div>
                {/* Category */}
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${CAT_COLORS[tutorial.category] || CAT_COLORS.other}`}>
                  {CAT_LABELS[tutorial.category] || tutorial.category}
                </span>
                {/* Stats */}
                <span className="text-xs text-slate-600 flex items-center gap-1">
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  {tutorial.views} views
                </span>
                <span className="text-xs text-slate-600">{tutorial.steps.length} steps</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleLike}
                className={`px-3 py-2 text-sm font-medium rounded-lg border transition flex items-center gap-1.5 ${
                  liked
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "border-white/10 text-slate-400 hover:bg-white/5 hover:text-red-400"
                }`}
              >
                <svg width="14" height="14" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                {likes}
              </button>
              <button
                onClick={handleShare}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white transition flex items-center gap-1.5"
              >
                {copied ? (
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-green-400"><path d="M5 13l4 4L19 7"/></svg>
                ) : (
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                )}
                {copied ? "Copied!" : "Share"}
              </button>
            </div>
          </div>

          {/* Tags */}
          {tutorial.tags.length > 0 && (
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {tutorial.tags.map(tag => (
                <Link key={tag} href={`/explore?search=${tag}`}
                  className="px-2.5 py-1 text-[10px] bg-white/[0.03] border border-white/5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition">
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── View Mode Tabs ─────────────────────────────── */}
        <div className="flex items-center gap-1 mb-5 border-b border-white/5 pb-px">
          <button
            onClick={() => setViewMode("video")}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition flex items-center gap-2 ${
              viewMode === "video"
                ? "text-white bg-white/[0.05] border border-white/10 border-b-transparent -mb-px"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Full Video
          </button>
          <button
            onClick={() => setViewMode("steps")}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition flex items-center gap-2 ${
              viewMode === "steps"
                ? "text-white bg-white/[0.05] border border-white/10 border-b-transparent -mb-px"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            Step by Step
            <span className="text-[10px] text-slate-600 ml-0.5">{tutorial.steps.length}</span>
          </button>
        </div>

        {/* ── Full Video Tab ─────────────────────────────── */}
        {viewMode === "video" && (
          <div className="max-w-4xl">
            {hasVideo ? (
              <>
                <div className="rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl shadow-black/50">
                  <video
                    ref={videoRef}
                    key={`${tutorial.sessionId}-final`}
                    src={`${api}/output/sessions/${tutorial.sessionId}/final-video.mp4`}
                    controls
                    autoPlay
                    poster={tutorial.steps[0]?.screenshot ? `${api}/output/sessions/${tutorial.sessionId}/images/${tutorial.steps[0].screenshot}` : undefined}
                    className="w-full aspect-video"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between px-1">
                  <p className="text-slate-600 text-xs">Full tutorial — all {tutorial.steps.length} steps combined</p>
                  <div className="flex gap-3">
                    <a
                      href={`${api}/output/sessions/${tutorial.sessionId}/final-video.mp4`}
                      download={`${tutorial.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-")}.mp4`}
                      className="text-[11px] text-slate-500 hover:text-indigo-400 transition flex items-center gap-1"
                    >
                      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Download .mp4
                    </a>
                  </div>
                </div>

                {/* Steps overview grid below video */}
                <div className="mt-8">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">What you&apos;ll learn</h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    {tutorial.steps.map((s, i) => (
                      <button
                        key={s.step}
                        onClick={() => { setActiveStep(i); setViewMode("steps"); }}
                        className="flex gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-xl text-left hover:bg-white/[0.04] hover:border-white/10 transition group"
                      >
                        {/* Thumbnail */}
                        {s.screenshot && tutorial.sessionId ? (
                          <img
                            src={`${api}/output/sessions/${tutorial.sessionId}/images/${s.screenshot}`}
                            alt="" className="w-20 h-14 object-cover rounded-lg border border-white/5 shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-20 h-14 bg-white/5 rounded-lg flex items-center justify-center shrink-0">
                            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-slate-700"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-indigo-400 font-medium">Step {s.step}</p>
                          <p className="text-sm font-medium text-white group-hover:text-indigo-300 transition truncate">{s.title}</p>
                          <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-1">{s.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] aspect-video flex items-center justify-center">
                <p className="text-slate-600 text-sm">Video not available — browse the steps below</p>
              </div>
            )}
          </div>
        )}

        {/* ── Step by Step Tab ────────────────────────────── */}
        {viewMode === "steps" && (
          <div className="flex gap-6">
            {/* Main player */}
            <div className="flex-1 min-w-0">
              {step?.video && tutorial.sessionId ? (
                <div className="rounded-2xl overflow-hidden border border-white/10 bg-black shadow-xl">
                  <video
                    key={`${tutorial.sessionId}-${step.video}`}
                    src={`${api}/output/sessions/${tutorial.sessionId}/videos/${step.video}`}
                    controls autoPlay
                    className="w-full aspect-video"
                  />
                </div>
              ) : step?.screenshot && tutorial.sessionId ? (
                <div className="rounded-2xl overflow-hidden border border-white/10 shadow-xl">
                  <img
                    src={`${api}/output/sessions/${tutorial.sessionId}/images/${step.screenshot}`}
                    alt={step.title}
                    className="w-full"
                    onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] aspect-video flex items-center justify-center">
                  <p className="text-slate-600 text-sm">No media for this step</p>
                </div>
              )}

              {/* Step info */}
              <div className="mt-4 bg-white/[0.02] border border-white/5 rounded-xl p-5">
                <h2 className="text-lg font-bold">
                  <span className="text-indigo-400 mr-2">Step {step?.step}.</span>
                  {step?.title}
                </h2>
                <p className="text-slate-400 text-sm mt-2 leading-relaxed">{step?.description}</p>
              </div>

              {/* Prev / Next */}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                  disabled={activeStep === 0}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 transition disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
                  Previous
                </button>
                <button
                  onClick={() => setActiveStep(Math.min(tutorial.steps.length - 1, activeStep + 1))}
                  disabled={activeStep === tutorial.steps.length - 1}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Next
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </div>
            </div>

            {/* Steps sidebar */}
            <div className="w-72 shrink-0 hidden md:block">
              <div className="flex items-center justify-between mb-3 px-1">
                <p className="text-[10px] text-slate-600 font-medium uppercase tracking-widest">Steps</p>
                <span className="text-[10px] text-slate-700">{activeStep + 1} / {tutorial.steps.length}</span>
              </div>

              {/* Progress bar */}
              <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-3 mx-1">
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${((activeStep + 1) / tutorial.steps.length) * 100}%` }} />
              </div>

              <div className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
                {tutorial.steps.map((s, i) => {
                  const isActive = i === activeStep;
                  const isPast = i < activeStep;
                  return (
                    <button
                      key={s.step}
                      onClick={() => setActiveStep(i)}
                      className={`w-full text-left rounded-xl transition group p-2.5 ${
                        isActive
                          ? "bg-white/[0.06] border border-indigo-500/30 shadow-sm shadow-indigo-500/5"
                          : "bg-transparent border border-transparent hover:bg-white/[0.03] hover:border-white/5"
                      }`}
                    >
                      <div className="flex gap-2.5">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold transition ${
                          isActive ? "bg-indigo-500 text-white" :
                          isPast ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                          "bg-white/5 text-slate-600"
                        }`}>
                          {isPast && !isActive ? (
                            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
                          ) : s.step}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[13px] font-medium leading-tight truncate ${
                            isActive ? "text-white" : isPast ? "text-slate-400" : "text-slate-500"
                          }`}>{s.title}</p>
                          <p className={`text-[11px] mt-0.5 line-clamp-2 leading-snug ${
                            isActive ? "text-slate-400" : "text-slate-700"
                          }`}>{s.description}</p>
                        </div>
                        {tutorial.sessionId && s.screenshot && (
                          <img
                            src={`${api}/output/sessions/${tutorial.sessionId}/images/${s.screenshot}`}
                            alt=""
                            className={`w-14 h-10 object-cover rounded-md shrink-0 border transition ${
                              isActive ? "border-indigo-500/30" : "border-white/5 opacity-60 group-hover:opacity-80"
                            }`}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── CTA ─────────────────────────────────────────── */}
        <div className="mt-12 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 border border-indigo-500/20 rounded-2xl p-8 text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 mb-4">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-indigo-400"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <h3 className="text-xl font-bold mb-2">Want to create your own tutorials?</h3>
          <p className="text-slate-400 text-sm mb-5 max-w-md mx-auto">
            Type any topic and get a personalized AI video tutorial in under 2 minutes. Free to start.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/login?tab=register" className="px-6 py-2.5 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-400 transition shadow-lg shadow-indigo-500/20">
              Get Started Free
            </Link>
            <Link href="/explore" className="px-6 py-2.5 bg-white/5 border border-white/10 text-slate-300 font-medium rounded-xl hover:bg-white/10 transition">
              Browse more
            </Link>
          </div>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-white/5 mt-16 py-8 px-6">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between text-xs text-slate-700">
          <span>ShowMe<span className="text-indigo-400">How</span><span className="text-indigo-300 font-normal text-[0.7em]">.ai</span> — AMS GenAI &amp; Video Hackathon 2026</span>
          <div className="flex gap-4">
            <Link href="/explore" className="hover:text-slate-400 transition">Explore</Link>
            <Link href="/pricing" className="hover:text-slate-400 transition">Pricing</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
