import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const ALLOWED_STATUSES = new Set([
  "draft",
  "generating",
  "ready",
  "video_generating",
  "complete",
  "error",
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const admin = createSupabaseAdminClient();

  const { data: project, error } = await admin
    .from("projects")
    .select("*, users(id, email, name)")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const { data: steps, error: stepsErr } = await admin
    .from("project_steps")
    .select("*")
    .eq("project_id", id)
    .order("step", { ascending: true });

  if (stepsErr) return Response.json({ error: stepsErr.message }, { status: 500 });

  return Response.json({ project, steps: steps ?? [] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body.status === "string") {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (typeof body.is_public === "boolean") updates.is_public = body.is_public;
  if (typeof body.is_featured === "boolean") updates.is_featured = body.is_featured;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ project: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("projects").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
