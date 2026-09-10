import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import "./responsive-fixes.css";
import "./client-scroll-fix.css";
import "./light-theme-fixes.css";
import "./calendar-dark-contrast.css";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { PwaRegister } from "@/components/ui/PwaRegister";
import { DeviceRuntime } from "@/components/ui/DeviceRuntime";
import { PaymentModalBackdropCloser } from "@/components/ui/PaymentModalBackdropCloser";
import { AppTelemetry } from "@/components/cliente/AppTelemetry";
import { ClienteTour } from "@/components/cliente/ClienteTour";

const display = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const heading = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-heading" });
const script = Fraunces({ subsets: ["latin"], weight: ["500", "600"], style: ["italic"], variable: "--font-script" });

export const metadata: Metadata = {
  title: "Sra. Luck — Cirurgia Programada",
  description: "Agenda exclusiva de crédito programado.",
  manifest: "/simulador-iphone.webmanifest",
  icons: {
    icon: [
      { url: "/icons/sra-luck-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/sra-luck-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icons/sra-luck-192.png", sizes: "192x192", type: "image/png" },
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Sra. Luck" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#7A2632",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${sans.variable} ${script.variable} ${heading.variable}`}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <script dangerouslySetInnerHTML={{ __html: `(function(){
          try {
            var s=localStorage.getItem("sra-luck-theme");
            document.documentElement.classList.toggle("dark",s==="dark");
          } catch(e) {}
          window.__sraLuckBeforeInstallPrompt = window.__sraLuckBeforeInstallPrompt || null;
          window.addEventListener("beforeinstallprompt", function(event){
            event.preventDefault();
            window.__sraLuckBeforeInstallPrompt = event;
            window.dispatchEvent(new Event("sra-luck-pwa-ready"));
          });
          if (location.pathname.indexOf("/agenda") === 0 && "serviceWorker" in navigator) {
            navigator.serviceWorker.register("/simulador-iphone-sw.js", {scope:"/agenda", updateViaCache:"none"})
              .then(function(reg){ return reg.update().catch(function(){}); })
              .catch(function(){});
          }
        })()` }} />
      </head>
      <body className="bg-cream text-clay font-sans antialiased selection:bg-burgundy selection:text-pearl overflow-y-auto touch-pan-y">
        <ThemeProvider>
          <DeviceRuntime />
          <PaymentModalBackdropCloser />
          <PwaRegister />
          <AppTelemetry />
          {children}
          <ClienteTour />
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}