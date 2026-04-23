import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const ALLOWED_PLANS = new Set(["free", "pack10", "pack20", "pro", "studio"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body.plan === "string") {
    if (!ALLOWED_PLANS.has(body.plan)) {
      return Response.json({ error: "Invalid plan" }, { status: 400 });
    }
    updates.plan = body.plan;
  }
  if (typeof body.credits === "number" && Number.isFinite(body.credits)) {
    updates.credits = Math.max(0, Math.floor(body.credits));
  }
  if (typeof body.is_admin === "boolean") {
    updates.is_admin = body.is_admin;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("users")
    .update(updates)
    .eq("id", id)
    .select("id, name, email, plan, credits, is_admin")
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ user: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  if (id === guard.userId) {
    return Response.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Project deletion cascades via FK (ON DELETE CASCADE expected on projects.user_id)
  const { error: dbErr } = await admin.from("users").delete().eq("id", id);
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 });

  // Also remove the auth user
  const { error: authErr } = await admin.auth.admin.deleteUser(id);
  if (authErr && !/not.?found/i.test(authErr.message)) {
    return Response.json({ error: authErr.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
