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

    /* Previsões: filtros como toolbar compacta, sem bloco de formulário alto. */
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) {
      width: fit-content !important;
      max-width: 100% !important;
      padding: .42rem !important;
      margin-bottom: .6rem !important;
      border-radius: .8rem !important;
      background: rgba(255,255,255,.76) !important;
      box-shadow: 0 8px 24px -22px rgba(91,19,36,.38) !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) > div {
      display: flex !important;
      align-items: center !important;
      flex-wrap: wrap !important;
      gap: .35rem !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) label {
      display: block !important;
      min-width: 0 !important;
      width: auto !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) label > span {
      display: none !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) input[type="month"],
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) select {
      width: auto !important;
      min-width: 0 !important;
      height: 2rem !important;
      padding: 0 1.8rem 0 .7rem !important;
      border-radius: .65rem !important;
      border: 1px solid rgba(122,38,50,.12) !important;
      background-color: #fffdfc !important;
      color: #632033 !important;
      font-size: .63rem !important;
      font-weight: 600 !important;
      line-height: 1 !important;
      box-shadow: 0 4px 14px -12px rgba(91,19,36,.45) !important;
      cursor: pointer !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) input[type="month"] {
      min-width: 9.4rem !important;
      padding-right: .55rem !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) select:nth-of-type(1) { max-width: 10.5rem !important; }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) select:nth-of-type(2) { max-width: 10rem !important; }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) select:nth-of-type(3),
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) select:nth-of-type(4) { max-width: 7.5rem !important; }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) input[type="month"]:hover,
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) select:hover {
      border-color: rgba(122,38,50,.28) !important;
      background-color: #fff8f7 !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) input[type="month"]:focus,
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) select:focus {
      outline: none !important;
      border-color: rgba(122,38,50,.42) !important;
      box-shadow: 0 0 0 3px rgba(122,38,50,.06) !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) > div > div:last-child {
      display: flex !important;
      align-items: center !important;
      gap: .25rem !important;
      margin-left: .1rem !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) > div > div:last-child button:first-child {
      height: 2rem !important;
      padding: 0 .72rem !important;
      border-radius: .65rem !important;
      font-size: .6rem !important;
    }
    .admin-main > .pb-8 > section:has(input[type="month"]):has(select) > div > div:last-child button:last-child {
      height: 2rem !important;
      padding: 0 .5rem !important;
      font-size: .58rem !important;
    }
    @media (max-width: 760px) {
      .admin-main > .pb-8 > section:has(input[type="month"]):has(select) {
        width: 100% !important;
      }
      .admin-main > .pb-8 > section:has(input[type="month"]):has(select) > div {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        padding-bottom: .1rem !important;
        scrollbar-width: none !important;
      }
      .admin-main > .pb-8 > section:has(input[type="month"]):has(select) > div::-webkit-scrollbar { display: none !important; }
      .admin-main > .pb-8 > section:has(input[type="month"]):has(select) label,
      .admin-main > .pb-8 > section:has(input[type="month"]):has(select) > div > div:last-child {
        flex: 0 0 auto !important;
      }
    }
  `}</style>;
}
