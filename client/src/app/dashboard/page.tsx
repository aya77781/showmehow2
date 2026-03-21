"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import api from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

// ── Types ───────────────────────────────────────────────────
interface User { name: string; email: string; picture?: string | null }

interface Step {
  step: number; title: string; description: string;
  screenshot?: string; imageUrl?: string; video?: string; videoSize?: number;
}

interface Tutorial {
  title?: string; url?: string; source?: string; steps: Step[];
}

interface Project {
  _id: string; topic: string; status: string; sessionId?: string;
  tutorial?: Tutorial; stats?: { phase1Time?: number; phase2Time?: number; totalTime?: number };
  error?: string; createdAt: string;
}

type Phase = "idle" | "researching" | "ready" | "generating_videos" | "complete" | "error";

interface LogEntry { text: string; status: "done" | "active"; ts: string }

// ── Helpers ─────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  draft:            { label: "Draft",       dot: "bg-slate-400", text: "text-slate-400" },
  generating:       { label: "Researching", dot: "bg-amber-400", text: "text-amber-400" },
  ready:            { label: "Ready",       dot: "bg-cyan-400",  text: "text-cyan-400" },
  video_generating: { label: "Rendering",   dot: "bg-purple-400",text: "text-purple-400" },
  complete:         { label: "Complete",     dot: "bg-green-400", text: "text-green-400" },
  error:            { label: "Failed",       dot: "bg-red-400",   text: "text-red-400" },
};

function Badge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return <span className={`inline-flex items-center gap-1.5 text-xs ${c.text}`}><span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{c.label}</span>;
}

function Spin({ size = 16 }: { size?: number }) {
  return <span className="inline-block border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" style={{ width: size, height: size }} />;
}

function fmtMs(ms?: number) { return !ms ? "—" : ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`; }

function ago(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d`;
}

// ── Component ───────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");

  // Data
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Flow state
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState<Project | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [editSteps, setEditSteps] = useState<Step[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [screenshotProgress, setScreenshotProgress] = useState<Record<number, string>>({});
  const [videoProgress, setVideoProgress] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [stats, setStats] = useState<any>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [finalVideo, setFinalVideo] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // ── Auth ──────────────────────────────────────────────────
  useEffect(() => {
    const s = localStorage.getItem("user"), t = localStorage.getItem("token");
    if (!s || !t) { router.push("/login"); return; }
    setUser(JSON.parse(s)); setToken(t);
  }, [router]);

  // ── Fetch projects ────────────────────────────────────────
  const fetchProjects = useCallback(async () => {
    if (!token) return;
    try { const { data } = await api.get("/api/tutorials"); setProjects(data); }
    catch {} finally { setLoadingProjects(false); }
  }, [token]);
  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // ── Log helpers ───────────────────────────────────────────
  const addLog = (text: string, status: "done" | "active" = "done") => {
    setLog(prev => [...prev, { text, status, ts: new Date().toLocaleTimeString() }]);
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 50);
  };
  const finishLastLog = () => setLog(prev => { const c = [...prev]; if (c.length) c[c.length - 1].status = "done"; return c; });

  // ── Socket.IO — all real backend events ───────────────────
  useEffect(() => {
    if (!token) return;
    const socket = io(API, { auth: { token } });
    socketRef.current = socket;

    // ── PHASE 1: Research events ──
    socket.on("research:start", ({ sessionId: sid, topic: t }) => {
      setSessionId(sid);
      addLog(`Research started — "${t}"`, "active");
    });
    socket.on("research:claude:start", () => {
      finishLastLog();
      addLog("Claude generating tutorial script with web search...", "active");
    });
    socket.on("research:claude:done", ({ steps: s, time }) => {
      finishLastLog();
      addLog(`Script ready — ${s.length} steps (${fmtMs(time)})`);
      setSteps(s);
    });
    socket.on("research:screenshots:start", ({ total }) => {
      addLog(`Capturing ${total} screenshots with Playwright...`, "active");
    });

    // Per-step screenshot events
    socket.on("screenshot:step", ({ step, title }) => {
      setScreenshotProgress(p => ({ ...p, [step]: "capturing" }));
    });
    socket.on("screenshot:html", ({ step }) => {
      setScreenshotProgress(p => ({ ...p, [step]: "analyzing" }));
    });
    socket.on("screenshot:actions", ({ step, count }) => {
      setScreenshotProgress(p => ({ ...p, [step]: `executing ${count} actions` }));
    });
    socket.on("screenshot:done", ({ step }) => {
      setScreenshotProgress(p => ({ ...p, [step]: "done" }));
    });
    socket.on("screenshot:fallback-search", ({ step }) => {
      setScreenshotProgress(p => ({ ...p, [step]: "searching image..." }));
    });
    socket.on("screenshot:login-detected", ({ step }) => {
      setScreenshotProgress(p => ({ ...p, [step]: "login wall — using fallback" }));
    });
    socket.on("screenshot:error", ({ step }) => {
      setScreenshotProgress(p => ({ ...p, [step]: "error" }));
    });
    socket.on("step:action", ({ step, action, selector }) => {
      setScreenshotProgress(p => ({ ...p, [step]: `${action}: ${selector?.slice(0, 30)}` }));
    });

    socket.on("research:screenshots:done", ({ count, time }) => {
      finishLastLog();
      addLog(`${count} screenshots captured (${fmtMs(time)})`);
    });
    socket.on("research:done", ({ sessionId: sid, stats: s }) => {
      setSessionId(sid); setStats(s);
      addLog(`Research complete — ${fmtMs(s?.phase1Time)}`);
    });

    // tutorial:ready comes from the socket handler after saving
    socket.on("tutorial:ready", ({ tutorial, stats: s }) => {
      setSteps(tutorial.steps || []);
      setEditSteps(JSON.parse(JSON.stringify(tutorial.steps || [])));
      setPhase("ready");
      setStats(s);
      addLog("Draft ready — review & edit steps below");
    });

    // ── PHASE 2: Video generation events ──
    socket.on("avatar:start", () => addLog("Generating AI avatar...", "active"));
    socket.on("avatar:done", ({ reused }) => {
      finishLastLog();
      addLog(reused ? "Avatar loaded from cache" : "Avatar generated");
    });

    socket.on("tts:start", ({ total }) => addLog(`Generating ${total} audio narrations...`, "active"));
    socket.on("tts:done", ({ id }) => setVideoProgress(p => ({ ...p, [`tts:${id}`]: "done" })));
    socket.on("tts:error", ({ id }) => setVideoProgress(p => ({ ...p, [`tts:${id}`]: "error" })));
    socket.on("tts:complete", ({ success, time }) => {
      finishLastLog();
      addLog(`${success} audio clips generated (${fmtMs(time)})`);
    });

    socket.on("video:start", ({ total }) => {
      setPhase("generating_videos");
      addLog(`Rendering ${total} talking-head clips...`, "active");
    });
    socket.on("video:clip:progress", ({ label, status }) => {
      setVideoProgress(p => ({ ...p, [label]: status }));
    });
    socket.on("video:clip:done", ({ label }) => {
      setVideoProgress(p => ({ ...p, [label]: "done" }));
    });
    socket.on("video:clip:error", ({ label }) => {
      setVideoProgress(p => ({ ...p, [label]: "error" }));
    });
    socket.on("video:clips:done", ({ success, total, time }) => {
      finishLastLog();
      addLog(`${success}/${total} avatar clips rendered (${fmtMs(time)})`);
    });

    socket.on("video:compositing", ({ total }) => addLog(`Compositing ${total} clips (screenshot + avatar)...`, "active"));
    socket.on("video:composite:done", ({ label }) => setVideoProgress(p => ({ ...p, [`comp:${label}`]: "done" })));

    socket.on("video:concatenating", ({ clips }) => {
      finishLastLog();
      addLog(`Concatenating ${clips} clips into final video...`, "active");
    });
    socket.on("video:final", ({ file, size }) => {
      finishLastLog();
      addLog(`Final video ready — ${(size / 1024 / 1024).toFixed(1)}MB`);
      setFinalVideo(file);
    });
    socket.on("video:error", ({ error: e }) => addLog(`Video error: ${e}`));

    socket.on("video:done", ({ steps: s, finalVideo: fv, time }) => {
      if (s) setSteps(s);
      if (fv) setFinalVideo(fv);
      addLog(`All videos complete (${fmtMs(time)})`);
    });

    socket.on("tutorial:complete", ({ tutorial, stats: s }) => {
      setSteps(tutorial.steps || []);
      setStats(s);
      setPhase("complete");
      setActiveStep(0);
      addLog(`Tutorial finished! Total: ${fmtMs(s?.totalTime)}`);
      fetchProjects();
    });

    socket.on("error", ({ message }) => {
      setError(message);
      setPhase("error");
      addLog(`Error: ${message}`);
    });

    return () => { socket.disconnect(); };
  }, [token, fetchProjects]);

  // ── Actions ───────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!topic.trim() || !token) return;
    reset(); setPhase("researching");
    try {
      const { data: project } = await api.post("/api/tutorials", { topic });
      setCurrent(project);
      addLog("Project created");
      socketRef.current?.emit("tutorial:research", { projectId: project._id });
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
      setPhase("error");
    }
  };

  const handleGenerateVideos = () => {
    if (!current) return;
    setPhase("generating_videos");
    setVideoProgress({}); setFinalVideo(null);
    // Save edited steps first
    api.put(`/api/tutorials/${current._id}/steps`, { steps: editSteps }).catch(() => {});
    socketRef.current?.emit("tutorial:generate-videos", { projectId: current._id, steps: editSteps });
  };

  const handleStepEdit = (i: number, field: "title" | "description", val: string) =>
    setEditSteps(prev => { const c = [...prev]; c[i] = { ...c[i], [field]: val }; return c; });

  const handleViewProject = async (project: Project) => {
    reset();
    setCurrent(project); setTopic(project.topic);
    if (project.status === "complete" || project.status === "ready") {
      try {
        const { data } = await api.get(`/api/tutorials/${project._id}`);
        setSteps(data.tutorial?.steps || []);
        setEditSteps(JSON.parse(JSON.stringify(data.tutorial?.steps || [])));
        setSessionId(data.sessionId || "");
        setStats(data.stats || null);
        setPhase(data.status === "complete" ? "complete" : "ready");
        if (data.status === "complete") setActiveStep(0);
      } catch { setError("Failed to load project"); }
    } else if (project.status === "error") {
      setError(project.error || "Generation failed");
      setPhase("error");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/api/tutorials/${id}`);
      setProjects(p => p.filter(x => x._id !== id));
      if (current?._id === id) handleNew();
    } catch {}
  };

  const handleNew = () => {
    reset(); setPhase("idle"); setCurrent(null); setTopic("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const reset = () => {
    setSteps([]); setEditSteps([]); setLog([]); setScreenshotProgress({});
    setVideoProgress({}); setError(""); setStats(null); setActiveStep(0); setFinalVideo(null);
  };

  const handleLogout = () => { localStorage.clear(); router.push("/"); };

  if (!user) return null;

  const isWorking = phase === "researching" || phase === "generating_videos";
  const doneScreenshots = Object.values(screenshotProgress).filter(v => v === "done").length;
  const totalScreenshots = Object.keys(screenshotProgress).length;
  const doneClips = Object.entries(videoProgress).filter(([k, v]) => !k.startsWith("tts:") && !k.startsWith("comp:") && v === "done").length;

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ── Header ────────────────────────────────────────── */}
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <span className="text-xl font-bold">ShowMe<span className="text-indigo-400">AI</span></span>
            <button onClick={handleNew} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 text-white text-sm font-medium rounded-lg hover:bg-indigo-400 transition">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"/></svg>
              New
            </button>
          </div>
          <div className="flex items-center gap-3">
            {user.picture ? (
              <img src={user.picture} alt="" className="w-7 h-7 rounded-full ring-1 ring-white/10" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs ring-1 ring-white/10">{user.name?.[0]?.toUpperCase()}</div>
            )}
            <span className="text-slate-400 text-sm hidden sm:block">{user.name}</span>
            <button onClick={handleLogout} className="ml-1 text-xs text-slate-600 hover:text-slate-400 transition">Log out</button>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto flex min-h-[calc(100vh-49px)]">
        {/* ── Sidebar ─────────────────────────────────────── */}
        <aside className="w-64 shrink-0 border-r border-white/5 hidden lg:flex flex-col">
          <div className="p-3">
            <h2 className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest px-2 mb-2">History</h2>
            <div className="space-y-0.5 overflow-y-auto max-h-[calc(100vh-120px)]">
              {loadingProjects && <div className="py-8 text-center"><Spin /></div>}
              {!loadingProjects && projects.length === 0 && <p className="text-slate-700 text-xs text-center py-8">No tutorials yet</p>}
              {projects.map(p => (
                <div
                  key={p._id}
                  onClick={() => handleViewProject(p)}
                  className={`group relative px-3 py-2 rounded-lg cursor-pointer transition ${
                    current?._id === p._id ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
                  }`}
                >
                  <p className="text-[13px] text-slate-300 truncate pr-4">{p.topic}</p>
                  <div className="flex items-center justify-between mt-1">
                    <Badge status={p.status} />
                    <span className="text-[10px] text-slate-700">{ago(p.createdAt)}</span>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(p._id); }}
                    className="absolute right-2 top-2 text-slate-700 hover:text-red-400 text-[10px] opacity-0 group-hover:opacity-100 transition"
                    title="Delete"
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Main ────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 p-6 md:p-8">

          {/* ── IDLE ──────────────────────────────────────── */}
          {(phase === "idle" || phase === "error") && (
            <div className="max-w-2xl mx-auto pt-6 md:pt-16">
              <div className="text-center mb-8">
                <h1 className="text-3xl md:text-4xl font-bold mb-2">What do you want to learn?</h1>
                <p className="text-slate-500 text-sm">Type any topic — we&apos;ll research it, capture real screenshots, and generate a narrated video tutorial.</p>
              </div>

              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleGenerate()}
                  placeholder="e.g. How to deploy a Next.js app on Vercel"
                  className="w-full px-5 py-4 pr-32 bg-white/[0.03] border border-white/10 text-white text-lg placeholder-slate-600 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition"
                />
                <button
                  onClick={handleGenerate}
                  disabled={!topic.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2.5 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-400 transition disabled:opacity-20 disabled:cursor-not-allowed text-sm"
                >
                  Generate
                </button>
              </div>

              {error && <div className="mt-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2"><span>✕</span>{error}</div>}

              <div className="mt-5 flex flex-wrap gap-2 justify-center">
                {["How to create a GitHub repository", "How to use Docker containers", "How to set up a React project"].map(s => (
                  <button key={s} onClick={() => { setTopic(s); inputRef.current?.focus(); }}
                    className="px-3 py-1.5 text-xs text-slate-600 bg-white/[0.02] border border-white/5 rounded-lg hover:bg-white/[0.05] hover:text-slate-400 transition">{s}</button>
                ))}
              </div>

              {projects.length === 0 && !topic && (
                <div className="mt-12 grid grid-cols-3 gap-4">
                  {[
                    { icon: "🔍", title: "AI Research", desc: "Claude searches the web and writes a structured script" },
                    { icon: "📸", title: "Screenshots", desc: "Playwright opens real UIs and captures each step" },
                    { icon: "🎬", title: "Video", desc: "Your AI avatar narrates the tutorial on video" },
                  ].map((s, i) => (
                    <div key={i} className="bg-white/[0.02] border border-white/5 rounded-xl p-5 text-center">
                      <p className="text-2xl mb-2">{s.icon}</p>
                      <p className="text-white text-sm font-medium mb-1">{s.title}</p>
                      <p className="text-slate-600 text-xs">{s.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── WORKING: Research / Video Gen ─────────────── */}
          {isWorking && (
            <div className="max-w-2xl mx-auto pt-4">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-3"><Spin size={24} /></div>
                <h2 className="text-xl font-bold">
                  {phase === "researching" ? "Researching your topic" : "Generating video tutorial"}
                </h2>
                <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
                  {phase === "researching"
                    ? "Claude is writing a script, then Playwright will capture real screenshots..."
                    : "Creating avatar clips, compositing, and building your final video..."}
                </p>
                <p className="text-indigo-400 text-sm font-medium mt-2 truncate max-w-lg mx-auto">&ldquo;{topic}&rdquo;</p>
              </div>

              {/* Screenshot progress grid */}
              {phase === "researching" && totalScreenshots > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-slate-500 mb-2">
                    <span>Screenshots</span>
                    <span>{doneScreenshots}/{totalScreenshots}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                    <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${totalScreenshots ? (doneScreenshots / totalScreenshots) * 100 : 0}%` }} />
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {Object.entries(screenshotProgress).map(([step, status]) => (
                      <div key={step} className={`rounded-lg p-2 text-center text-[10px] border transition ${
                        status === "done" ? "bg-green-500/5 border-green-500/20 text-green-400"
                        : status === "error" ? "bg-red-500/5 border-red-500/20 text-red-400"
                        : "bg-indigo-500/5 border-indigo-500/20 text-indigo-300"
                      }`}>
                        <span className="font-medium">Step {step}</span>
                        <p className="truncate mt-0.5 opacity-70">{status === "done" ? "✓" : status === "error" ? "✕" : status}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Video progress */}
              {phase === "generating_videos" && doneClips > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-slate-500 mb-2">
                    <span>Video clips</span>
                    <span>{doneClips} done</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full transition-all duration-500 animate-pulse" style={{ width: "60%" }} />
                  </div>
                </div>
              )}

              {/* Log */}
              <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Live Pipeline</span>
                </div>
                <div ref={logRef} className="p-3 space-y-1.5 max-h-48 overflow-y-auto font-mono">
                  {log.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 shrink-0">{e.status === "active" ? <Spin size={10} /> : <span className="text-green-500">✓</span>}</span>
                      <span className="text-slate-400 flex-1">{e.text}</span>
                      <span className="text-slate-700 shrink-0 text-[10px]">{e.ts}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── READY: Edit steps ─────────────────────────── */}
          {phase === "ready" && (
            <div className="max-w-3xl mx-auto">
              <div className="flex items-start justify-between mb-5 gap-4">
                <div>
                  <p className="text-indigo-400 text-xs font-medium mb-1 uppercase tracking-wider">Step 2 of 3 — Review</p>
                  <h2 className="text-xl font-bold">Edit your tutorial steps</h2>
                  <p className="text-slate-500 text-sm mt-1">Tweak titles and narration before generating the final video.</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={handleNew} className="px-3 py-2 text-sm border border-white/10 rounded-lg hover:bg-white/5 transition text-slate-500">Discard</button>
                  <button onClick={handleGenerateVideos} className="px-4 py-2 bg-indigo-500 text-white font-semibold text-sm rounded-lg hover:bg-indigo-400 transition flex items-center gap-1.5">
                    Generate Videos
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
                  </button>
                </div>
              </div>

              {/* Topic bar */}
              <div className="px-4 py-2.5 bg-white/[0.02] border border-white/5 rounded-lg mb-4 flex items-center gap-3 text-sm">
                <span className="text-slate-600">Topic:</span>
                <span className="text-white font-medium truncate">{topic}</span>
                <span className="ml-auto text-slate-600 text-xs shrink-0">{editSteps.length} steps</span>
              </div>

              {/* Steps */}
              <div className="space-y-1.5">
                {editSteps.map((s, i) => (
                  <div key={s.step} className="bg-white/[0.02] border border-white/5 rounded-xl p-4 hover:border-white/10 transition group">
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center pt-0.5">
                        <div className="w-6 h-6 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold text-[10px]">{s.step}</div>
                        {i < editSteps.length - 1 && <div className="w-px flex-1 bg-white/5 mt-1" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <input value={s.title} onChange={e => handleStepEdit(i, "title", e.target.value)}
                          className="w-full bg-transparent text-white font-medium text-sm focus:outline-none border-b border-transparent focus:border-indigo-500/30 pb-1" />
                        <textarea value={s.description} onChange={e => handleStepEdit(i, "description", e.target.value)} rows={2}
                          className="w-full bg-transparent text-slate-400 text-sm mt-1.5 focus:outline-none focus:text-slate-300 resize-none leading-relaxed" />
                      </div>
                      {(s.imageUrl || (sessionId && s.screenshot)) && (
                        <img src={s.imageUrl || `${API}/output/sessions/${sessionId}/images/${s.screenshot}`} alt=""
                          className="w-24 h-16 object-cover rounded-lg shrink-0 border border-white/5" />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex justify-between items-center">
                <p className="text-slate-600 text-xs">You can edit text — screenshots will be used as-is in the video</p>
                <button onClick={handleGenerateVideos}
                  className="px-5 py-2.5 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-400 transition flex items-center gap-2 text-sm">
                  Generate {editSteps.length} Videos
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
                </button>
              </div>
            </div>
          )}

          {/* ── COMPLETE: View Tutorial ───────────────────── */}
          {phase === "complete" && steps.length > 0 && (
            <div className="max-w-4xl mx-auto">
              {/* Header */}
              <div className="flex items-start justify-between mb-5 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 bg-green-400 rounded-full" /><span className="text-green-400 text-xs font-medium">Complete</span></div>
                  <h2 className="text-2xl font-bold">{current?.tutorial?.title || topic}</h2>
                  <p className="text-slate-500 text-sm mt-1">
                    {steps.length} steps{stats?.totalTime ? ` — ${fmtMs(stats.totalTime)}` : ""}
                    {current?.tutorial?.source ? ` — ${current.tutorial.source}` : ""}
                  </p>
                </div>
                <button onClick={handleNew} className="px-3 py-2 bg-indigo-500 text-white text-sm font-medium rounded-lg hover:bg-indigo-400 transition flex items-center gap-1.5 shrink-0">
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"/></svg>
                  New
                </button>
              </div>

              {/* Final concatenated video */}
              {finalVideo && sessionId && (
                <div className="mb-6">
                  <div className="rounded-2xl overflow-hidden border border-white/10 bg-black">
                    <video
                      key={`final-${sessionId}`}
                      src={`${API}/output/sessions/${sessionId}/videos/${finalVideo}`}
                      controls autoPlay
                      className="w-full aspect-video"
                    />
                  </div>
                  <p className="text-slate-600 text-xs mt-2 text-center">Full tutorial video — all steps combined</p>
                </div>
              )}

              {/* Step-by-step view */}
              <div className="flex gap-5">
                {/* Player */}
                <div className="flex-1 min-w-0">
                  {steps[activeStep]?.video && sessionId ? (
                    <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
                      <video
                        key={`${sessionId}-${steps[activeStep].video}`}
                        src={`${API}/output/sessions/${sessionId}/videos/${steps[activeStep].video}`}
                        controls autoPlay
                        className="w-full aspect-video"
                      />
                    </div>
                  ) : steps[activeStep]?.screenshot && sessionId ? (
                    <div className="rounded-xl overflow-hidden border border-white/10">
                      <img
                        src={`${API}/output/sessions/${sessionId}/images/${steps[activeStep].screenshot}`}
                        alt="" className="w-full"
                      />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] aspect-video flex items-center justify-center">
                      <p className="text-slate-600 text-sm">No media for this step</p>
                    </div>
                  )}
                  <div className="mt-3">
                    <h3 className="text-base font-bold"><span className="text-indigo-400 mr-1.5">Step {steps[activeStep]?.step}.</span>{steps[activeStep]?.title}</h3>
                    <p className="text-slate-400 text-sm mt-1 leading-relaxed">{steps[activeStep]?.description}</p>
                  </div>
                </div>

                {/* Steps nav */}
                <div className="w-56 shrink-0 hidden md:block">
                  <p className="text-[10px] text-slate-600 font-medium uppercase tracking-widest mb-2 px-1">Steps</p>
                  <div className="space-y-0.5">
                    {steps.map((s, i) => (
                      <button key={s.step} onClick={() => setActiveStep(i)}
                        className={`w-full text-left px-3 py-2 rounded-lg transition flex items-start gap-2.5 ${
                          i === activeStep ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
                        }`}>
                        <span className={`text-[10px] font-bold mt-0.5 ${i === activeStep ? "text-indigo-400" : "text-slate-600"}`}>{s.step}</span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs truncate ${i === activeStep ? "text-white" : "text-slate-500"}`}>{s.title}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            {s.video && <span className="text-[9px] text-green-500/60">video</span>}
                            {s.screenshot && <span className="text-[9px] text-cyan-500/60">screenshot</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Log */}
              {log.length > 0 && (
                <details className="mt-8">
                  <summary className="text-slate-700 text-xs cursor-pointer hover:text-slate-500 transition">Pipeline log ({log.length} events)</summary>
                  <div className="mt-2 bg-white/[0.02] border border-white/5 rounded-lg p-3 space-y-1 font-mono">
                    {log.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        <span className="text-green-500/50">✓</span>
                        <span className="text-slate-600 flex-1">{e.text}</span>
                        <span className="text-slate-800">{e.ts}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
