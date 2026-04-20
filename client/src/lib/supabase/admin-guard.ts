import { createSupabaseServerClient, createSupabaseAdminClient } from "./server";

export type AdminGuardResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAdmin(): Promise<AdminGuardResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, status: 401, error: "Not authenticated" };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("is_admin, email")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return { ok: false, status: 403, error: error.message };
  if (!data?.is_admin) return { ok: false, status: 403, error: "Admin access required" };

  return { ok: true, userId: user.id, email: data.email };
}
