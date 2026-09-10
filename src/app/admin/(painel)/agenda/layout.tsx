"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function AgendaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("aba") === "liberacao") {
      router.replace(pathname);
    }
  }, [pathname, router]);

  return (
    <>
      <style jsx global>{`
        /* A agenda agora tem um único fluxo: termos cirúrgicos. */
        div.mx-auto.flex.w-full.max-w-md.gap-1.rounded-full.bg-blush\\/70.p-1\\.5 > button:nth-child(2) {
          display: none !important;
        }

        div.mx-auto.flex.w-full.max-w-md.gap-1.rounded-full.bg-blush\\/70.p-1\\.5 > button:first-child {
          flex: 0 0 auto !important;
          min-width: 180px;
        }
      `}</style>
      {children}
    </>
  );
}
