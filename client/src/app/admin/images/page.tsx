"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/app/admin/_components/Modal";

interface AdminImage {
  id: string;
  hash: string;
  storage_path: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  site: string | null;
  page: string | null;
  element: string | null;
  tags: string[] | null;
  original_query: string | null;
  validated: boolean;
  uses: number;
  last_used: string | null;
  created_at: string;
  public_url: string | null;
}

export default function ImagesPage() {
  const [images, setImages] = useState<AdminImage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 40;
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<AdminImage | null>(null);
  const [annotation, setAnnotation] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/admin/images?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setImages(json.images);
      setTotal(json.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function openImage(img: AdminImage) {
    setViewing(img);
    setAnnotation("Loading…");
    try {
      const res = await fetch(`/api/admin/images/${img.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setAnnotation(JSON.stringify(json.image.annotation_data ?? null, null, 2));
    } catch (e) {
      setAnnotation(`Error: ${(e as Error).message}`);
    }
  }

  async function deleteImage(id: string) {
    if (!confirm("Delete this image from DB and storage?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/images/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setViewing(null);
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
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Image library</h1>
        <p className="text-slate-400 text-sm mt-1">{total} images</p>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder="Search by site, query, or tag…"
          className="w-full md:w-96 px-4 py-2 bg-white/5 border border-white/10 text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 py-8">Loading…</div>
      ) : images.length === 0 ? (
        <div className="text-slate-500 py-8">No images found.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {images.map((img) => (
            <button
              key={img.id}
              onClick={() => openImage(img)}
              className="group bg-slate-900/60 border border-white/10 rounded-xl overflow-hidden backdrop-blur hover:border-indigo-500/50 transition text-left"
            >
              <div className="aspect-square bg-black/40 relative">
                {img.public_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.public_url}
                    alt={img.element || img.original_query || ""}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                    no file
                  </div>
                )}
              </div>
              <div className="p-2 text-xs">
                <div className="truncate text-slate-300">{img.site || "—"}</div>
                <div className="flex items-center justify-between text-slate-500 mt-1">
                  <span className="tabular-nums">
                    {img.width ?? "?"}×{img.height ?? "?"}
                  </span>
                  <span>{img.uses} uses</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

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
          title={viewing.element || viewing.original_query || viewing.hash.slice(0, 12)}
          size="xl"
          onClose={() => {
            setViewing(null);
            setAnnotation("");
          }}
        >
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-black/50 rounded-xl overflow-hidden border border-white/10">
              {viewing.public_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={viewing.public_url}
                  alt=""
                  className="w-full h-auto max-h-[60vh] object-contain"
                />
              ) : (
                <div className="p-6 text-slate-500 text-sm">No file.</div>
              )}
            </div>
            <div className="space-y-3 text-sm">
              <Detail label="Hash" value={viewing.hash} mono />
              <Detail label="Mime" value={viewing.mime} />
              <Detail
                label="Dimensions"
                value={
                  viewing.width && viewing.height
                    ? `${viewing.width} × ${viewing.height}`
                    : null
                }
              />
              <Detail label="Site" value={viewing.site} />
              <Detail label="Page" value={viewing.page} />
              <Detail label="Element" value={viewing.element} />
              <Detail label="Original query" value={viewing.original_query} />
              <Detail
                label="Tags"
                value={viewing.tags && viewing.tags.length ? viewing.tags.join(", ") : null}
              />
              <Detail label="Uses" value={String(viewing.uses)} />
              <Detail label="Validated" value={viewing.validated ? "yes" : "no"} />
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Annotation data
                </div>
                <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
                  {annotation || "null"}
                </pre>
              </div>
              <div className="pt-2">
                <button
                  onClick={() => deleteImage(viewing.id)}
                  disabled={busy}
                  className="px-4 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-50 rounded-xl text-sm font-medium"
                >
                  {busy ? "Deleting…" : "Delete image"}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-slate-200 break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value || "—"}
      </div>
    </div>
  );
}
