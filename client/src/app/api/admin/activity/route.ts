import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const admin = createSupabaseAdminClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 29);
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await admin
    .from("projects")
    .select("created_at")
    .gte("created_at", since.toISOString());

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const buckets = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of data ?? []) {
    const day = row.created_at.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }

  return Response.json({
    days: Array.from(buckets.entries()).map(([date, count]) => ({ date, count })),
  });
}
