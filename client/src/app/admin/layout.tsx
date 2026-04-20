"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/projects", label: "Projects" },
  { href: "/admin/cache", label: "Cache" },
  { href: "/admin/images", label: "Images" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-white flex">
      <aside className="w-60 shrink-0 border-r border-white/10 bg-slate-950/80 backdrop-blur p-5 flex flex-col">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-wider text-slate-500">ShowMeHow</div>
          <div className="text-lg font-bold">Admin</div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-2 rounded-lg text-sm transition ${
                  active
                    ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/30"
                    : "text-slate-300 hover:bg-white/5 border border-transparent"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={handleSignOut}
          className="mt-4 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition text-left"
        >
          Sign out
        </button>
      </aside>

      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
