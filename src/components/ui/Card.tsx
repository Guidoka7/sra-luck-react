import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("surface-glass luxury-ring rounded-3xl", className)} {...props} />;
}

export function AdminCompactStyles() {
  return <style>{`
    /* High-density admin mode: reduce whitespace without hiding functionality. */
    .admin-compact [class~="p-4"] { padding: .75rem !important; }
    .admin-compact [class~="p-5"] { padding: .75rem !important; }
    .admin-compact [class~="p-6"] { padding: .75rem !important; }
    .admin-compact [class~="p-8"] { padding: 1rem !important; }
    .admin-compact [class~="px-6"] { padding-left: .75rem !important; padding-right: .75rem !important; }
    .admin-compact [class~="py-6"] { padding-top: .75rem !important; padding-bottom: .75rem !important; }
    .admin-compact [class~="px-5"] { padding-left: .625rem !important; padding-right: .625rem !important; }
    .admin-compact [class~="py-5"] { padding-top: .625rem !important; padding-bottom: .625rem !important; }
    .admin-compact [class~="px-4"] { padding-left: .75rem !important; padding-right: .75rem !important; }
    .admin-compact [class~="py-4"] { padding-top: .625rem !important; padding-bottom: .625rem !important; }
    .admin-compact [class~="gap-8"] { gap: 1rem !important; }
    .admin-compact [class~="gap-6"] { gap: .75rem !important; }
    .admin-compact [class~="gap-5"] { gap: .625rem !important; }
    .admin-compact [class~="gap-4"] { gap: .625rem !important; }
    .admin-compact [class~="space-y-8"] > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem !important; }
    .admin-compact [class~="space-y-6"] > :not([hidden]) ~ :not([hidden]) { margin-top: .75rem !important; }
    .admin-compact [class~="space-y-5"] > :not([hidden]) ~ :not([hidden]) { margin-top: .625rem !important; }
    .admin-compact [class~="space-y-4"] > :not([hidden]) ~ :not([hidden]) { margin-top: .625rem !important; }
    .admin-compact [class~="mb-8"] { margin-bottom: .75rem !important; }
    .admin-compact [class~="mt-8"] { margin-top: .75rem !important; }
    .admin-compact [class~="mb-6"] { margin-bottom: .75rem !important; }
    .admin-compact [class~="mt-6"] { margin-top: .75rem !important; }
    .admin-compact [class~="mb-5"] { margin-bottom: .625rem !important; }
    .admin-compact [class~="mt-5"] { margin-top: .625rem !important; }
    .admin-compact [class~="mb-4"] { margin-bottom: .5rem !important; }
    .admin-compact [class~="mt-4"] { margin-top: .5rem !important; }
    .admin-compact [class~="rounded-[28px]"] { border-radius: .875rem !important; }
    .admin-compact [class*="rounded-[24px]"] { border-radius: .75rem !important; }
    .admin-compact [class*="rounded-[22px]"] { border-radius: .625rem !important; }
    .admin-compact [class~="rounded-3xl"] { border-radius: .875rem !important; }
    .admin-compact [class~="rounded-2xl"] { border-radius: .75rem !important; }
    .admin-compact [class~="rounded-xl"] { border-radius: .625rem !important; }
    .admin-compact [class~="h-44"] { height: 7rem !important; }
    .admin-compact [class~="min-h-[240px]"] { min-height: 8rem !important; }
    .admin-compact [class~="min-h-[220px]"] { min-height: 7.5rem !important; }
    .admin-compact [class~="min-h-[200px]"] { min-height: 7rem !important; }
    .admin-compact [class~="text-4xl"] { font-size: 1.75rem !important; line-height: 2rem !important; }
    .admin-compact [class~="text-3xl"] { font-size: 1.5rem !important; line-height: 1.875rem !important; }
    .admin-compact [class~="text-2xl"] { font-size: 1.25rem !important; line-height: 1.625rem !important; }
    .admin-compact [class~="text-xl"] { font-size: 1.125rem !important; line-height: 1.5rem !important; }
  `}</style>;
}
