"use client";

import { usePathname } from "next/navigation";
import { AdminZipShell } from "@/components/admin-zip/AdminZipShell";
import { CalendarioTesteTempo } from "@/components/admin/CalendarioTesteTempo";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const clientes = pathname === "/admin/clientes" || pathname.startsWith("/admin/clientes/");

  return (
    <AdminZipShell>
      {!clientes ? <CalendarioTesteTempo /> : null}
      {children}
    </AdminZipShell>
  );
}
