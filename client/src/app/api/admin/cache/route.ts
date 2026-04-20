import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { searchParams } = request.nextUrl;
  const type = searchParams.get("type") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("cache")
    .select("id, type, key, hits, expires_at, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (type) query = query.eq("type", type);

  const { data, error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: typeRows } = await admin.from("cache").select("type");
  const types = Array.from(new Set((typeRows ?? []).map((r) => r.type).filter(Boolean))).sort();

  return Response.json({ entries: data ?? [], total: count ?? 0, page, pageSize, types });
}

export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { searchParams } = request.nextUrl;
  const type = searchParams.get("type") || "";

  const admin = createSupabaseAdminClient();
  let query = admin.from("cache").delete();

  if (type) {
    query = query.eq("type", type);
  } else {
    // Postgres requires a WHERE clause — match all non-null ids
    query = query.not("id", "is", null);
  }

  const { error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
