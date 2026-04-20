import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { searchParams } = request.nextUrl;
  const search = (searchParams.get("search") || "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "40", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("image_library")
    .select(
      "id, hash, storage_path, mime, width, height, site, page, element, tags, original_query, validated, uses, last_used, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    const like = `%${search.replace(/[%_]/g, "")}%`;
    query = query.or(`site.ilike.${like},original_query.ilike.${like},tags.cs.{${search}}`);
  }

  const { data, error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const images = (data ?? []).map((row) => ({
    ...row,
    public_url: row.storage_path
      ? `${base}/storage/v1/object/public/image-library/${row.storage_path}`
      : null,
  }));

  return Response.json({ images, total: count ?? 0, page, pageSize });
}
