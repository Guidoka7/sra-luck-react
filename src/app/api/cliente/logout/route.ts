import { NextResponse } from "next/server";
import { CLIENTE_COOKIE_NAME } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CLIENTE_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
