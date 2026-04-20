import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { searchParams } = request.nextUrl;
  const search = (searchParams.get("search") || "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("users")
    .select(
      "id, name, email, picture, plan, credits, is_admin, plan_expires_at, stripe_customer_id, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    const like = `%${search.replace(/[%_]/g, "")}%`;
    query = query.or(`name.ilike.${like},email.ilike.${like}`);
  }

  const { data, error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ users: data ?? [], total: count ?? 0, page, pageSize });
}
