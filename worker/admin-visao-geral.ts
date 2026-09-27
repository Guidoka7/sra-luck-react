import { publicError } from "./http-security";
import { opcoesAcessoApp } from "./regras-operacionais";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { hojeSaoPaulo } from "../src/lib/dataCivil";
import {
  montarVisaoGeral,
  type AgendamentoLinha,
  type BoletoLinha,
  type ClienteLinha,
  type RecebimentoLinha,
  type VendaAguardandoLinha,
} from "./visao-geral-agregacao";
import type { VisaoGeralAdmin } from "../src/lib/visaoGeralContrato";

/**
 * GET /api/admin/visao-geral — painel inicial do Admin (contrato v2 em
 * src/lib/visaoGeralContrato.ts). Autorização no roteador
 * (admin-route-permissions: visao_geral.ver ou relatorios.visualizar).
 *
 * Este arquivo só carrega dados (somente leitura) e delega toda a
 * agregação a `montarVisaoGeral`, que é pura e testada.
 */

const COLUNAS_CLIENTES = "id,nome_completo,cpf,data_nascimento,procedimento,acesso_app_liberado,status_contrato,valor_contrato,custo_total,taxa_administrativa_percentual,quantidade_parcelas,liberacao_financeira_solicitada_em,ativo,created_at";
const COLUNAS_BOLETOS = "id,cliente_id,numero_parcela,total_parcelas,valor,status,data_vencimento,data_pagamento,suspensa,updated_at";
const COLUNAS_RECEBIMENTOS = "boleto_id,status_validacao,data_pagamento,valor_recebido,created_at";
const COLUNAS_AGENDAMENTOS = "id,cliente_id,status,horario_termos,termos_assinados_em,comparecimento_status,comparecimento_em,quitacao_status,quitacao_em,agenda_cirurgica_liberada_em,agenda_cirurgica_prazo_ajuste_dias,data_cirurgia,horario_cirurgia,processo_concluido_em,created_at,datas(data)";
const DIA_MS = 24 * 60 * 60 * 1000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

async function todasAsLinhas<T>(
  carregar: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: any }>,
): Promise<{ data: T[]; error: any }> {
  const data: T[] = [];
  const tamanho = 1000;
  for (let pagina = 0; pagina < 100; pagina++) {
    const de = pagina * tamanho;
    const resultado = await carregar(de, de + tamanho - 1);
    if (resultado.error) return { data, error: resultado.error };
    const lote = (resultado.data ?? []) as T[];
    data.push(...lote);
    if (lote.length < tamanho) return { data, error: null };
  }
  return { data, error: { message: "Leitura excedeu o limite operacional de 100 mil registros." } };
}

function periodoSolicitado(url: URL, hoje: string) {
  const anoPadrao = Number(hoje.slice(0, 4));
  const mesPadrao = Number(hoje.slice(5, 7));
  const ano = Math.min(2200, Math.max(2000, Number(url.searchParams.get("ano")) || anoPadrao));
  const mes = Math.min(12, Math.max(1, Number(url.searchParams.get("mes")) || mesPadrao));
  return { ano, mes };
}

export async function adminVisaoGeral(request: Request, env: Env): Promise<Response> {
  try {
    const supabase = createServiceSupabaseClient(env);
    const agora = new Date();
    const hoje = hojeSaoPaulo(agora);
    const { ano, mes } = periodoSolicitado(new URL(request.url), hoje);
    const inicioDiaUtc = `${hoje}T03:00:00.000Z`;
    const fimDiaUtc = new Date(Date.parse(inicioDiaUtc) + DIA_MS).toISOString();

    const [
      clientesRes,
      boletosRes,
      agendamentosRes,
      recebimentosRes,
      vendasRes,
      devicesRes,
      pushHojeRes,
      credenciaisRes,
    ] = await Promise.all([
      todasAsLinhas<ClienteLinha>((de, ate) => supabase.from("clientes").select(COLUNAS_CLIENTES).order("created_at", { ascending: false }).range(de, ate)),
      todasAsLinhas<BoletoLinha>((de, ate) => supabase.from("boletos").select(COLUNAS_BOLETOS).order("id", { ascending: true }).range(de, ate)),
      todasAsLinhas<AgendamentoLinha>((de, ate) => supabase.from("agendamentos").select(COLUNAS_AGENDAMENTOS).in("status", ["confirmado", "realizado"]).order("id", { ascending: true }).range(de, ate)),
      todasAsLinhas<RecebimentoLinha>((de, ate) => supabase.from("financeiro_recebimentos").select(COLUNAS_RECEBIMENTOS).eq("status_validacao", "validado").order("created_at", { ascending: true }).range(de, ate)),
      supabase.from("novas_vendas").select("id,nome_completo,data_venda,created_at", { count: "exact" }).eq("status", "aguardando_cadastro").is("cliente_id", null).order("data_venda", { ascending: true }).limit(6),
      supabase.from("cliente_app_devices").select("is_pwa_installed,last_access_at"),
      supabase.from("notificacao_logs").select("id", { count: "exact", head: true }).gte("created_at", inicioDiaUtc).lt("created_at", fimDiaUtc).gt("push_enviadas", 0),
      supabase.from("integracoes_credenciais").select("chave").eq("provedor", "web_push").eq("ativo", true),
    ]);

    // Leituras essenciais: sem elas o painel mostraria números errados.
    for (const result of [clientesRes, boletosRes, agendamentosRes]) {
      if (result.error) return json({ erro: publicError(result.error) }, 500);
    }

    const avisos: string[] = [];
    if (recebimentosRes.error) avisos.push("Recebimentos validados indisponíveis: valores recebidos consideram apenas parcelas pagas.");
    if (vendasRes.error) avisos.push("Vendas do CRM aguardando cadastro indisponíveis.");

    let app: VisaoGeralAdmin["app"] = null;
    if (devicesRes.error || credenciaisRes.error) {
      avisos.push("Indicadores do app da cliente indisponíveis.");
    } else {
      const dispositivos = (devicesRes.data ?? []) as { is_pwa_installed: boolean | null; last_access_at: string | null }[];
      const limiteSemAcesso = agora.getTime() - 7 * DIA_MS;
      const pwaInstalados = dispositivos.filter((dv) => dv.is_pwa_installed === true).length;
      const chaves = new Set(((credenciaisRes.data ?? []) as { chave: string }[]).map((c) => c.chave));
      app = {
        dispositivos: dispositivos.length,
        pwaInstalados,
        pwaPercentual: dispositivos.length > 0 ? Math.round((pwaInstalados / dispositivos.length) * 100) : 0,
        semAcessoRecente: dispositivos.filter((dv) => !dv.last_access_at || new Date(dv.last_access_at).getTime() < limiteSemAcesso).length,
        webPushConfigurado: Boolean(
          (chaves.has("vapid_public_key") && chaves.has("vapid_private_key") && chaves.has("vapid_subject"))
          || (env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY && env.WEB_PUSH_VAPID_SUBJECT),
        ),
        pushHoje: pushHojeRes.error ? 0 : pushHojeRes.count ?? 0,
      };
    }

    return json(montarVisaoGeral({
      agora,
      hoje,
      ano,
      mes,
      clientes: clientesRes.data,
      boletos: boletosRes.data,
      recebimentos: recebimentosRes.error ? [] : recebimentosRes.data,
      agendamentos: agendamentosRes.data,
      vendasAguardando: vendasRes.error
        ? { itens: [], total: 0 }
        : { itens: (vendasRes.data ?? []) as VendaAguardandoLinha[], total: vendasRes.count ?? (vendasRes.data ?? []).length },
      app,
      avisos,
      opcoesAcessoApp: opcoesAcessoApp(),
    }));
  } catch (error) {
    console.error("Falha na visão geral administrativa:", error);
    return json({ erro: publicError(error, "Serviço temporariamente indisponível.") }, 503);
  }
}
