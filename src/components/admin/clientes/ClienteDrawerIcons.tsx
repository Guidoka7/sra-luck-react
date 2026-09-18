import type { SVGProps } from "react";

type IconName =
  | "user" | "finance" | "usercard" | "procedure" | "tag" | "document" | "clock" | "edit"
  | "whatsapp" | "bank" | "wallet" | "info" | "card" | "dots" | "upload" | "check"
  | "alert" | "history" | "close" | "heart" | "save";

export function DrawerIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = { viewBox: "0 0 24 24", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props };
  switch (name) {
    case "user": return <svg {...common} fill="none" strokeWidth="1.7"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>;
    case "finance": return <svg {...common} fill="none" strokeWidth="1.6"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>;
    case "usercard": return <svg {...common} fill="none" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2.2"/><path d="M5.8 17c.7-2.2 2-3.3 3.8-3.3 1.7 0 3 1.1 3.7 3.3M15.5 8h2.7M15.5 12h2.7"/></svg>;
    case "procedure": return <svg {...common} fill="none" strokeWidth="1.7"><path d="M8 3v4a4 4 0 0 1-4 4H2M16 3v4a4 4 0 0 0 4 4h2M5 11c0 5 2.5 8 7 10 4.5-2 7-5 7-10"/></svg>;
    case "tag": return <svg {...common} fill="none" strokeWidth="1.7"><path d="M20.6 13.1 11 22l-9-9V2h11l7.6 7.6a2.5 2.5 0 0 1 0 3.5Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>;
    case "document": return <svg {...common} fill="none" strokeWidth="1.7"><path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h6"/></svg>;
    case "clock":
    case "history": return <svg {...common} fill="none" strokeWidth="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "edit": return <svg {...common} fill="none" strokeWidth="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>;
    case "whatsapp": return <svg {...common} fill="none" strokeWidth="1.7"><path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.5-4.9a8.4 8.4 0 1 1 16-4Z"/><path d="M8.2 8.2c.4 3.8 3 6.4 6.8 6.8l1.1-1.7-2.2-1.1-.9 1c-1.3-.5-2.4-1.6-2.9-2.9l1-.9L10 7.2Z"/></svg>;
    case "bank": return <svg {...common} fill="none" strokeWidth="1.7"><path d="m3 9 9-5 9 5H3ZM5 10v7M9.7 10v7M14.3 10v7M19 10v7M3 20h18M2 17h20"/></svg>;
    case "wallet": return <svg {...common} fill="none" strokeWidth="1.6"><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12"/><path d="M16 11h6v4h-6a2 2 0 0 1 0-4Z"/></svg>;
    case "info": return <svg {...common} fill="none" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>;
    case "card": return <svg {...common} fill="none" strokeWidth="1.6"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9h19M6 15h4"/></svg>;
    case "dots": return <svg {...common} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>;
    case "upload": return <svg {...common} fill="none" strokeWidth="1.6"><path d="M12 16V4M8 8l4-4 4 4M5 14v6h14v-6"/></svg>;
    case "check": return <svg {...common} fill="none" strokeWidth="1.8"><path d="m5 12 4 4L19 6"/></svg>;
    case "alert": return <svg {...common} fill="none" strokeWidth="1.6"><path d="M10.3 3.5 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.5a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>;
    case "close": return <svg {...common} fill="none" strokeWidth="1.7"><path d="m6 6 12 12M18 6 6 18"/></svg>;
    case "heart": return <svg {...common} fill="none" strokeWidth="1.7"><path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/></svg>;
    case "save": return <svg {...common} fill="none" strokeWidth="1.7"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>;
  }
}
