import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PROJECT_STATUSES = [
  "draft",
  "generating",
  "ready",
  "video_generating",
  "complete",
  "error",
] as const;

const STORAGE_BUCKETS = ["cache-files", "image-library", "project-assets", "tuto-videos"];

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return Response.json({ error: guard.error }, { status: guard.status });
  }

  const admin = createSupabaseAdminClient();

  const [usersCount, projectsByStatus, cacheCount, storageBytes] = await Promise.all([
    admin.from("users").select("id", { count: "exact", head: true }),
    countProjectsByStatus(admin),
    admin.from("cache").select("id", { count: "exact", head: true }),
    computeStorageBytes(admin),
  ]);

  return Response.json({
    users: usersCount.count ?? 0,
    projects: projectsByStatus,
    cacheEntries: cacheCount.count ?? 0,
    storageBytes,
  });
}

async function countProjectsByStatus(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const counts: Record<string, number> = { total: 0 };
  await Promise.all(
    PROJECT_STATUSES.map(async (status) => {
      const { count } = await admin
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      counts[status] = count ?? 0;
      counts.total += count ?? 0;
    }),
  );
  return counts;
}

async function computeStorageBytes(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const result: Record<string, number> = { total: 0 };

  await Promise.all(
    STORAGE_BUCKETS.map(async (bucket) => {
      let bytes = 0;
      let offset = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await admin.storage.from(bucket).list("", {
          limit: pageSize,
          offset,
        });
        if (error || !data) break;
        for (const obj of data) {
          const size = (obj.metadata as { size?: number } | null)?.size ?? 0;
          bytes += size;
        }
        if (data.length < pageSize) break;
        offset += pageSize;
      }

      result[bucket] = bytes;
      result.total += bytes;
    }),
  );

  return result;
}
