import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = createServerSupabaseClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  // A base é a tabela de clientes para que também apareçam as clientes que
  // ainda nunca acessaram o PWA. Os dispositivos entram como complemento.
  // A tabela de monitoramento possui RLS sem políticas públicas; por isso a
  // leitura administrativa precisa usar service_role após validar a sessão.
  const supabase = createServiceSupabaseClient();
  const [{ data: clientes, error: erroClientes }, { data: dispositivosBrutos, error: erroDispositivos }] = await Promise.all([
    supabase.from("clientes").select("id, nome_completo, cpf, ativo").eq("ativo", true).order("nome_completo", { ascending: true }),
    supabase.from("cliente_app_devices").select(`
      cliente_id, device_key, device_type, display_mode, is_pwa_installed,
      notification_permission, push_active, user_agent, first_access_at,
      last_access_at, pwa_installed_at, notifications_activated_at
    `).order("last_access_at", { ascending: false }),
  ]);

  if (erroClientes) return NextResponse.json({ erro: erroClientes.message }, { status: 500 });
  if (erroDispositivos) return NextResponse.json({ erro: erroDispositivos.message }, { status: 500 });

  type Device = NonNullable<typeof dispositivosBrutos>[number];
  type Cliente = NonNullable<typeof clientes>[number];
  const dispositivos = dispositivosBrutos ?? [];
  const clientesAtivos: Cliente[] = clientes ?? [];
  const clienteMapa = new Map<string, Cliente>(clientesAtivos.map((cliente: Cliente) => [cliente.id, cliente]));
  const grupos = new Map<string, Device[]>();

  for (const item of dispositivos) {
    if (!clienteMapa.has(item.cliente_id)) continue;
    const lista = grupos.get(item.cliente_id) ?? [];
    lista.push(item);
    grupos.set(item.cliente_id, lista);
  }

  type Resumo = {
    cliente_id: string;
    cliente: { id: string; nome_completo: string; cpf: string; ativo: boolean };
    device_key: string | null;
    device_type: string | null;
    display_mode: string | null;
    is_pwa_installed: boolean;
    notification_permission: string;
    push_active: boolean;
    first_access_at: string | null;
    last_access_at: string | null;
    pwa_installed_at: string | null;
    notifications_activated_at: string | null;
    dispositivos_count: number;
  };

  const resumo: Resumo[] = clientesAtivos.map((cliente: Cliente) => {
    const lista = grupos.get(cliente.id) ?? [];
    const ultimo = lista[0] ?? null;
    const primeiroAcesso = lista.reduce<string | null>((menor, item) => {
      if (!item.first_access_at) return menor;
      if (!menor || new Date(item.first_access_at).getTime() < new Date(menor).getTime()) return item.first_access_at;
      return menor;
    }, null);
    const ultimoAcesso = lista.reduce<string | null>((maior, item) => {
      if (!item.last_access_at) return maior;
      if (!maior || new Date(item.last_access_at).getTime() > new Date(maior).getTime()) return item.last_access_at;
      return maior;
    }, null);
    const pwaInstalado = lista.some((item) => item.is_pwa_installed);
    const notificacoesAtivas = lista.some((item) => item.notification_permission === "granted" && item.push_active);
    const notificacoesBloqueadas = !notificacoesAtivas && lista.some((item) => item.notification_permission === "denied");
    const pwaInstaladoAt = lista.filter((item) => item.pwa_installed_at).sort((a, b) => new Date(a.pwa_installed_at!).getTime() - new Date(b.pwa_installed_at!).getTime())[0]?.pwa_installed_at ?? null;
    const notificacoesAtivadasAt = lista.filter((item) => item.notifications_activated_at).sort((a, b) => new Date(a.notifications_activated_at!).getTime() - new Date(b.notifications_activated_at!).getTime())[0]?.notifications_activated_at ?? null;

    return {
      cliente_id: cliente.id,
      cliente,
      device_key: ultimo?.device_key ?? null,
      device_type: ultimo?.device_type ?? null,
      display_mode: ultimo?.display_mode ?? null,
      is_pwa_installed: pwaInstalado,
      notification_permission: notificacoesBloqueadas ? "denied" : notificacoesAtivas ? "granted" : "default",
      push_active: notificacoesAtivas,
      first_access_at: primeiroAcesso,
      last_access_at: ultimoAcesso,
      pwa_installed_at: pwaInstaladoAt,
      notifications_activated_at: notificacoesAtivadasAt,
      dispositivos_count: lista.length,
    };
  });

  const monitoradas = resumo.length;
  const pwaInstalado = resumo.filter((x) => x.is_pwa_installed).length;
  const notificacoesAtivas = resumo.filter((x) => x.notification_permission === "granted" && x.push_active).length;
  const notificacoesBloqueadas = resumo.filter((x) => x.notification_permission === "denied").length;
  const acessoWeb = resumo.filter((x) => x.display_mode === "browser").length;

  return NextResponse.json({
    dispositivos,
    resumo,
    metricas: {
      clientesMonitoradas: monitoradas,
      pwaInstalado,
      pwaNaoInstalado: Math.max(0, monitoradas - pwaInstalado),
      notificacoesAtivas,
      notificacoesNaoAtivadas: Math.max(0, monitoradas - notificacoesAtivas),
      notificacoesBloqueadas,
      acessoWeb,
    },
  });
}
