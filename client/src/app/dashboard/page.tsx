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
  candidates?: string[]; validCandidates?: string[]; picked?: number;
}

interface Tutorial {
  title?: string; url?: string; source?: string; steps: Step[];
}

interface Project {
  _id: string; topic: string; status: string; sessionId?: string;
  tutorial?: Tutorial; stats?: { phase1Time?: number; phase2Time?: number; totalTime?: number };
  error?: string; createdAt: string;
}

type Phase = "idle" | "researching" | "generating_videos" | "complete" | "error";

interface LogEntry { text: string; status: "done" | "active"; ts: string }
interface ChatMsg { role: "user" | "assistant"; content: string }

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
  const [viewTab, setViewTab] = useState<"video" | "steps">("video");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

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
      addLog(`Searching images for ${total} steps...`, "active");
    });

    // Per-step screenshot events (Serper + Claude Vision)
    socket.on("screenshot:search", ({ step, query }) => {
      setScreenshotProgress(p => ({ ...p, [step]: "searching..." }));
    });
    socket.on("screenshot:done", ({ step, picked, total, valid, candidates }) => {
      setScreenshotProgress(p => ({ ...p, [step]: `✓ ${valid}/${total} valid` }));
      setEditSteps(prev => prev.map(s => s.step === step ? { ...s, candidates, picked: picked - 1 } : s));
      setSteps(prev => prev.map(s => s.step === step ? { ...s, candidates, picked: picked - 1 } : s));
    });
    socket.on("screenshot:error", ({ step }) => {
      setScreenshotProgress(p => ({ ...p, [step]: "error" }));
    });

    socket.on("research:screenshots:done", ({ count, time }) => {
      finishLastLog();
      addLog(`${count} screenshots captured (${fmtMs(time)})`);
    });
    socket.on("annotation:start", ({ total }) => {
      addLog(`Highlighting key UI elements on ${total} screenshots...`, "active");
    });
    socket.on("screenshot:annotated", ({ step, label }) => {
      setScreenshotProgress(p => ({ ...p, [step]: `highlighted: ${label}` }));
    });
    socket.on("annotation:done", () => {
      finishLastLog();
      addLog("Screenshots annotated with highlights");
    });
    socket.on("research:done", ({ sessionId: sid, stats: s }) => {
      setSessionId(sid); setStats(s);
      addLog(`Research complete — ${fmtMs(s?.phase1Time)}`);
    });

    // tutorial:ready — research done, auto-generating videos now
    socket.on("tutorial:ready", ({ sessionId: sid, tutorial, stats: s }) => {
      if (sid) setSessionId(sid);
      setSteps(tutorial.steps || []);
      setEditSteps(JSON.parse(JSON.stringify(tutorial.steps || [])));
      setPhase("generating_videos");
      setStats(s);
      addLog("Research complete — generating videos automatically...");
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

    socket.on("tutorial:complete", ({ sessionId: sid, tutorial, stats: s, finalVideo: fv }) => {
      if (sid) setSessionId(sid);
      if (fv) setFinalVideo(fv);
      setSteps(tutorial.steps || []);
      setStats(s);
      setViewTab("video");
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
        setFinalVideo(data.status === "complete" ? "final-video.mp4" : null);
        setViewTab("video");
        setPhase("complete");
        setActiveStep(0);
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

  const handleChat = async () => {
    if (!chatInput.trim() || !current || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setChatLoading(true);
    setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }), 50);
    try {
      const { data } = await api.post(`/api/tutorials/${current._id}/chat`, {
        message: msg,
        history: chatMessages,
      });
      setChatMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't get a response. Try again." }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }), 50);
    }
  };

  const handleNew = () => {
    reset(); setPhase("idle"); setCurrent(null); setTopic("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const reset = () => {
    setSteps([]); setEditSteps([]); setLog([]); setScreenshotProgress({});
    setVideoProgress({}); setError(""); setStats(null); setActiveStep(0); setFinalVideo(null); setViewTab("video");
    setChatMessages([]); setChatInput(""); setChatLoading(false); setChatOpen(false);
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
                    { icon: "📸", title: "Screenshots", desc: "AI finds and validates real screenshots for each step" },
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
                    ? "Claude is writing a script, then searching and validating screenshots..."
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

          {/* "ready" phase removed — videos auto-generate after research */}

          {/* ── COMPLETE: View Tutorial ───────────────────── */}
          {phase === "complete" && steps.length > 0 && (
            <div>
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
                <div className="flex gap-2 shrink-0">
                  {finalVideo && sessionId && (
                    <a
                      href={`${API}/output/sessions/${sessionId}/${finalVideo}`}
                      download={`${(current?.tutorial?.title || topic).replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-")}.mp4`}
                      className="px-3 py-2 text-sm font-medium rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white transition flex items-center gap-1.5"
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Download
                    </a>
                  )}
                  {finalVideo && sessionId && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${API}/output/sessions/${sessionId}/${finalVideo}`);
                        addLog("Video link copied to clipboard");
                      }}
                      className="px-3 py-2 text-sm font-medium rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white transition flex items-center gap-1.5"
                      title="Copy video link"
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      Share
                    </button>
                  )}
                  <button onClick={handleNew} className="px-3 py-2 bg-indigo-500 text-white text-sm font-medium rounded-lg hover:bg-indigo-400 transition flex items-center gap-1.5">
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"/></svg>
                    New
                  </button>
                </div>
              </div>

              {/* Tabs + Ask AI toggle */}
              <div className="flex items-center justify-between mb-5 border-b border-white/5 pb-px">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setViewTab("video")}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition flex items-center gap-2 ${
                      viewTab === "video"
                        ? "text-white bg-white/[0.05] border border-white/10 border-b-transparent -mb-px"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Full Video
                  </button>
                  <button
                    onClick={() => setViewTab("steps")}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition flex items-center gap-2 ${
                      viewTab === "steps"
                        ? "text-white bg-white/[0.05] border border-white/10 border-b-transparent -mb-px"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    Step by Step
                    <span className="text-[10px] text-slate-600 ml-0.5">{steps.length}</span>
                  </button>
                </div>
                <button
                  onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setTimeout(() => chatInputRef.current?.focus(), 100); }}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition flex items-center gap-2 ${
                    chatOpen
                      ? "bg-indigo-500/10 border border-indigo-500/30 text-indigo-400"
                      : "border border-white/10 text-slate-500 hover:text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  Ask AI
                  {chatMessages.length > 0 && <span className="text-[10px] text-indigo-400 ml-0.5 bg-indigo-500/10 px-1.5 py-0.5 rounded-full">{chatMessages.length}</span>}
                </button>
              </div>

              {/* Content + Chat side panel layout */}
              <div className="flex gap-5">
                {/* Main content area */}
                <div className={`min-w-0 transition-all duration-300 ${chatOpen ? "flex-1" : "w-full"}`}>

                  {/* ── TAB: Full Video ──────────────────────────── */}
                  {viewTab === "video" && (
                    <>
                      {finalVideo && sessionId ? (
                        <div>
                          <div className="rounded-2xl overflow-hidden border border-white/10 bg-black">
                            <video
                              key={`final-${sessionId}`}
                              src={`${API}/output/sessions/${sessionId}/${finalVideo}`}
                              controls autoPlay
                              className="w-full aspect-video"
                            />
                          </div>
                          <div className="mt-3 flex items-center justify-between px-1">
                            <p className="text-slate-600 text-xs">Full tutorial — all {steps.length} steps combined</p>
                            <div className="flex gap-3">
                              <a
                                href={`${API}/output/sessions/${sessionId}/${finalVideo}`}
                                download={`${(current?.tutorial?.title || topic).replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-")}.mp4`}
                                className="text-[11px] text-slate-500 hover:text-indigo-400 transition flex items-center gap-1"
                              >
                                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                Download .mp4
                              </a>
                              <button
                                onClick={() => { navigator.clipboard.writeText(`${API}/output/sessions/${sessionId}/${finalVideo}`); }}
                                className="text-[11px] text-slate-500 hover:text-indigo-400 transition flex items-center gap-1"
                              >
                                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                Copy link
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] aspect-video flex items-center justify-center">
                          <p className="text-slate-600 text-sm">No video available — check step-by-step view</p>
                        </div>
                      )}
                    </>
                  )}

                  {/* ── TAB: Step by Step ────────────────────────── */}
                  {viewTab === "steps" && (
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
                      <div className={`shrink-0 hidden md:block ${chatOpen ? "w-52" : "w-72"}`}>
                        <div className="flex items-center justify-between mb-3 px-1">
                          <p className="text-[10px] text-slate-600 font-medium uppercase tracking-widest">Steps</p>
                          <span className="text-[10px] text-slate-700">{activeStep + 1} / {steps.length}</span>
                        </div>

                        <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-3 mx-1">
                          <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${((activeStep + 1) / steps.length) * 100}%` }} />
                        </div>

                        <div className="space-y-1 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
                          {steps.map((s, i) => {
                            const isActive = i === activeStep;
                            const isPast = i < activeStep;
                            return (
                              <button key={s.step} onClick={() => setActiveStep(i)}
                                className={`w-full text-left rounded-xl transition group ${
                                  isActive
                                    ? "bg-white/[0.06] border border-indigo-500/30 shadow-sm shadow-indigo-500/5"
                                    : "bg-transparent border border-transparent hover:bg-white/[0.03] hover:border-white/5"
                                } p-2.5`}>
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

                                    <div className="flex items-center gap-1.5 mt-1.5">
                                      {s.video && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 text-[9px] font-medium">
                                          <svg width="8" height="8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                          video
                                        </span>
                                      )}
                                      {s.screenshot && !chatOpen && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[9px] font-medium">
                                          <svg width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                                          img
                                        </span>
                                      )}
                                      {s.videoSize && !chatOpen && (
                                        <span className="text-[9px] text-slate-700">{(s.videoSize / 1024 / 1024).toFixed(1)}MB</span>
                                      )}
                                    </div>
                                  </div>

                                  {sessionId && s.screenshot && !chatOpen && (
                                    <img
                                      src={`${API}/output/sessions/${sessionId}/images/${s.screenshot}`}
                                      alt=""
                                      className={`w-14 h-10 object-cover rounded-md shrink-0 border transition ${
                                        isActive ? "border-indigo-500/30" : "border-white/5 opacity-60 group-hover:opacity-80"
                                      }`}
                                    />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex gap-2 mt-3 px-1">
                          <button
                            onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                            disabled={activeStep === 0}
                            className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 transition disabled:opacity-20 disabled:cursor-not-allowed"
                          >Prev</button>
                          <button
                            onClick={() => setActiveStep(Math.min(steps.length - 1, activeStep + 1))}
                            disabled={activeStep === steps.length - 1}
                            className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition disabled:opacity-20 disabled:cursor-not-allowed"
                          >Next</button>
                        </div>
                      </div>
                    </div>
                  )}

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

                {/* ── Chat Side Panel (Coursera-style) ─────────── */}
                {chatOpen && (
                  <div className="w-80 shrink-0 flex flex-col border-l border-white/5 pl-5" style={{ height: "calc(100vh - 220px)" }}>
                    {/* Chat header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-indigo-400"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">AI Tutor</p>
                          <p className="text-[10px] text-slate-600">Focused on this tutorial</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setChatOpen(false)}
                        className="w-7 h-7 rounded-lg border border-white/5 flex items-center justify-center text-slate-600 hover:text-slate-400 hover:bg-white/5 transition"
                        title="Close chat"
                      >
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      </button>
                    </div>

                    {/* Messages */}
                    <div ref={chatRef} className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1">
                      {chatMessages.length === 0 && (
                        <div className="text-center py-8">
                          <p className="text-slate-500 text-xs mb-3">Ask anything about &ldquo;{(current?.tutorial?.title || topic).slice(0, 50)}&rdquo;</p>
                          <div className="space-y-1.5">
                            {[
                              `Explain step ${(activeStep || 0) + 1} in more detail`,
                              `What are common mistakes?`,
                              `What should I do next?`,
                            ].map(q => (
                              <button key={q} onClick={() => { setChatInput(q); chatInputRef.current?.focus(); }}
                                className="w-full px-3 py-2 text-xs text-left text-slate-500 bg-white/[0.02] border border-white/5 rounded-lg hover:bg-white/[0.05] hover:text-slate-300 transition">{q}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      {chatMessages.map((m, i) => (
                        <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                            m.role === "user"
                              ? "bg-indigo-500 text-white rounded-br-md"
                              : "bg-white/[0.05] text-slate-300 border border-white/5 rounded-bl-md"
                          }`}>
                            {m.role === "assistant" ? (
                              <div className="whitespace-pre-wrap">{m.content}</div>
                            ) : m.content}
                          </div>
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="flex justify-start">
                          <div className="bg-white/[0.05] border border-white/5 rounded-2xl rounded-bl-md px-4 py-3">
                            <div className="flex gap-1">
                              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Input */}
                    <div className="relative shrink-0">
                      <input
                        ref={chatInputRef}
                        type="text"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleChat()}
                        placeholder="Ask a question..."
                        disabled={chatLoading}
                        className="w-full px-3 py-2.5 pr-12 bg-white/[0.03] border border-white/10 text-white text-sm placeholder-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition disabled:opacity-50"
                      />
                      <button
                        onClick={handleChat}
                        disabled={!chatInput.trim() || chatLoading}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center bg-indigo-500 text-white rounded-lg hover:bg-indigo-400 transition disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        {chatLoading ? <Spin size={12} /> : (
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
