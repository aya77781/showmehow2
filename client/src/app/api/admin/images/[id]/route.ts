import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("image_library").select("*").eq("id", id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ image: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const admin = createSupabaseAdminClient();

  const { data: row, error: fetchErr } = await admin
    .from("image_library")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 });

  if (row?.storage_path) {
    const { error: storageErr } = await admin.storage
      .from("image-library")
      .remove([row.storage_path]);
    if (storageErr && !/not.?found/i.test(storageErr.message)) {
      return Response.json({ error: storageErr.message }, { status: 500 });
    }
  }

  const { error: dbErr } = await admin.from("image_library").delete().eq("id", id);
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 });

  return Response.json({ ok: true });
}
