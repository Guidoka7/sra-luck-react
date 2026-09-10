import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/webPush";

export async function GET() {
  try {
    return NextResponse.json({ publicKey: getVapidPublicKey() });
  } catch {
    return NextResponse.json({ erro: "Notificações do sistema ainda não estão configuradas." }, { status: 503 });
  }
}
