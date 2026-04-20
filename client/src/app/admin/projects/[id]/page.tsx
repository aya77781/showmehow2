"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Step {
  id: string;
  step: number;
  title: string | null;
  description: string | null;
  screenshot: string | null;
  image_url: string | null;
  video: string | null;
  highlight_label: string | null;
  annotated: boolean;
}

interface Project {
  id: string;
  user_id: string;
  topic: string | null;
  source: string | null;
  status: string;
  tutorial_title: string | null;
  tutorial_url: string | null;
  tutorial_source: string | null;
  tutorial_wiki_url: string | null;
  session_id: string | null;
  error: string | null;
  is_public: boolean;
  slug: string | null;
  category: string | null;
  tags: string[] | null;
  views: number;
  likes: number;
  stats: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  users: { id: string; email: string; name: string | null } | null;
}

const STATUSES = ["draft", "generating", "ready", "video_generating", "complete", "error"];

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/projects/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setProject(json.project);
      setSteps(json.steps);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setProject(json.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runDelete() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/projects/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      router.replace("/admin/projects");
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="max-w-5xl mx-auto px-6 py-10 text-slate-400">Loading…</div>;
  }
  if (error || !project) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-10">
        <Link href="/admin/projects" className="text-indigo-400 text-sm hover:underline">
          ← Back
        </Link>
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 mt-4">
          {error || "Project not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link href="/admin/projects" className="text-indigo-400 text-sm hover:underline">
        ← Back to projects
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{project.topic || "(untitled)"}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {project.users?.email ?? "—"} · {new Date(project.created_at).toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          className="px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 rounded-xl text-sm"
        >
          Delete project
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mt-6">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 backdrop-blur">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Status</div>
          <select
            value={project.status}
            onChange={(e) => patch({ status: e.target.value })}
            disabled={saving}
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 backdrop-blur">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Visibility</div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={project.is_public}
              disabled={saving}
              onChange={(e) => patch({ is_public: e.target.checked })}
              className="w-4 h-4"
            />
            Public
          </label>
        </div>
      </div>

      <section className="bg-slate-900/60 border border-white/10 rounded-2xl p-6 backdrop-blur mt-4">
        <h2 className="text-lg font-semibold mb-3">Metadata</h2>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <MetaRow label="Source" value={project.source} />
          <MetaRow label="Tutorial URL" value={project.tutorial_url} />
          <MetaRow label="Tutorial source" value={project.tutorial_source} />
          <MetaRow label="Category" value={project.category} />
          <MetaRow label="Slug" value={project.slug} />
          <MetaRow label="Views" value={String(project.views)} />
          <MetaRow label="Likes" value={String(project.likes)} />
          <MetaRow
            label="Tags"
            value={project.tags && project.tags.length ? project.tags.join(", ") : null}
          />
        </dl>
        {project.error && (
          <div className="mt-4 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">
            <div className="font-semibold mb-1">Error</div>
            <code className="text-xs whitespace-pre-wrap break-words">{project.error}</code>
          </div>
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-semibold mb-3">Steps ({steps.length})</h2>
        {steps.length === 0 ? (
          <div className="text-slate-500 text-sm">No steps yet.</div>
        ) : (
          <div className="space-y-3">
            {steps.map((s) => (
              <div
                key={s.id}
                className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 backdrop-blur"
              >
                <div className="flex items-start gap-4">
                  <div className="text-xs font-mono text-slate-500 w-8 pt-1">#{s.step}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{s.title || "(no title)"}</div>
                    {s.description && (
                      <p className="text-sm text-slate-400 mt-1 whitespace-pre-wrap">
                        {s.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      {s.highlight_label && (
                        <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded">
                          {s.highlight_label}
                        </span>
                      )}
                      {s.annotated && (
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded">
                          annotated
                        </span>
                      )}
                    </div>
                  </div>
                  {s.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.image_url}
                      alt=""
                      className="w-32 h-20 object-cover rounded-lg border border-white/10"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-md w-full">
            <h2 className="text-lg font-semibold">Delete this project?</h2>
            <p className="text-sm text-slate-400 mt-2">
              This deletes the project and all its steps. The action is irreversible.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-slate-300 hover:text-white text-sm"
              >
                Cancel
              </button>
              <button
                onClick={runDelete}
                disabled={saving}
                className="px-4 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-50 rounded-xl text-sm font-medium"
              >
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200 break-all">{value || "—"}</dd>
    </>
  );
}
