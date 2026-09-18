"use client";

import { usePathname } from "next/navigation";
import { AdminZipShell } from "@/components/admin-zip/AdminZipShell";
import { CalendarioTesteTempo } from "@/components/admin/CalendarioTesteTempo";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const clientes = pathname === "/admin/clientes" || pathname.startsWith("/admin/clientes/");
  const financeiro = pathname === "/admin/financeiro" || pathname.startsWith("/admin/financeiro/");
  const agenda = pathname === "/admin/agenda" || pathname.startsWith("/admin/agenda/");
  const referenceExact = clientes || financeiro || agenda;

  return (
    <AdminZipShell>
      {!referenceExact ? <CalendarioTesteTempo /> : null}
      {children}
    </AdminZipShell>
  );
}
