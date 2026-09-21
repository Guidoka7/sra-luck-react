"use client";

import { AdminZipShell } from "@/components/admin-zip/AdminZipShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminZipShell>
      {children}
    </AdminZipShell>
  );
}
