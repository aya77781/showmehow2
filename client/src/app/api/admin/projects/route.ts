import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || "";
  const source = searchParams.get("source") || "";
  const userId = searchParams.get("userId") || "";
  const sort = searchParams.get("sort") || "created_at";
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const SORTABLE = new Set(["created_at", "views", "likes"]);
  const sortCol = SORTABLE.has(sort) ? sort : "created_at";

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("projects")
    .select(
      "id, topic, source, status, is_public, is_featured, views, likes, created_at, user_id, users(email)",
      { count: "exact" },
    )
    .order(sortCol, { ascending: dir === "asc" })
    .range(from, to);

  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (userId) query = query.eq("user_id", userId);

  const { data, error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ projects: data ?? [], total: count ?? 0, page, pageSize });
}
