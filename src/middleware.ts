import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });
  const { pathname } = request.nextUrl;

  // --- Área administrativa: exige sessão do Supabase Auth ---
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            response.cookies.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            response.cookies.set({ name, value: "", ...options });
          },
        },
      }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  // --- Área da cliente: exige cookie de sessão válido (CPF + nascimento) ---
  if (pathname.startsWith("/agenda")) {
    const token = request.cookies.get(CLIENTE_COOKIE_NAME)?.value;
    const payload = await verificarTokenSessao(token);
    if (!payload) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/agenda/:path*"],
};
