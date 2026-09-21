"use client";

import { Suspense } from "react";
import { CentralAcompanhamento } from "@/features/scheduling/CentralAcompanhamento";

export default function AgendaAdminPage() {
  return <Suspense fallback={null}><CentralAcompanhamento /></Suspense>;
}
