"use client";

import { AdminZipShell } from "@/components/admin-zip/AdminZipShell";
import { CalendarioTesteTempo } from "@/components/admin/CalendarioTesteTempo";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminZipShell>
      <CalendarioTesteTempo />
      {children}
    </AdminZipShell>
  );
}
