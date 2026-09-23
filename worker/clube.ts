/**
 * Clube de Vantagens — rotas da cliente e da equipe (admin).
 *
 * Regras de crédito (parcela em dia, indicação, 1ª parcela) vivem no banco
 * (migrations 048 e 075) e são idempotentes. Aqui ficam: leitura consolidada
 * para o app, envio de indicação, voucher (solicitar/baixar) e a operação da
 * equipe (confirmar indicações, anexar vouchers, ajustar pontuação).
 */
import { publicError } from "./http-security";
import type { createServiceSupabaseClient } from "./supabase";
import { detectarTipoArquivo } from "./arquivos";

type Db = ReturnType<typeof createServiceSupabaseClient>;

const BUCKET_VOUCHERS = "clube-vouchers";
const PADRAO = { pontosPrimeiraParcela: 50, pontosParcelaEmDia: 10, pontosIndicacao: 200 };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function lerCorpo(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
}

export interface ConfigClube { pontosPrimeiraParcela: number; pontosParcelaEmDia: number; pontosIndicacao: number }

export function configDoBanco(linha: Record<string, unknown> | null | undefined): ConfigClube {
  const num = (valor: unknown, padrao: number) => (typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : padrao);
  return {
    pontosPrimeiraParcela: num(linha?.pontos_primeira_parcela, PADRAO.pontosPrimeiraParcela),
    pontosParcelaEmDia: num(linha?.pontos_parcela_em_dia, PADRAO.pontosParcelaEmDia),
    pontosIndicacao: num(linha?.pontos_indicacao_venda, PADRAO.pontosIndicacao),
  };
}

type EventoPontos = { pontos: number; metadata?: Record<string, unknown> | null };
type ParcelaResumo = { numero_parcela: number; status: string; data_vencimento: string | null };

/** Progresso das missões a partir do extrato real de pontos e das parcelas. */
export function montarMissoes(eventos: EventoPontos[], parcelas: ParcelaResumo[], config: ConfigClube) {
  const doMotivo = (motivo: string) => eventos.filter((e) => e.metadata?.motivo === motivo);
  const emDia = doMotivo("parcela_em_dia");
  const indicacoes = doMotivo("indicacao_venda");
  const soma = (lista: EventoPontos[]) => lista.reduce((total, e) => total + Math.max(0, Number(e.pontos) || 0), 0);
  const proxima = parcelas
    .filter((p) => p.status !== "pago" && p.data_vencimento)
    .sort((a, b) => String(a.data_vencimento).localeCompare(String(b.data_vencimento)) || a.numero_parcela - b.numero_parcela)[0];
  return {
    primeiraParcela: {
      concluida: doMotivo("primeira_parcela").length > 0 || parcelas.some((p) => p.numero_parcela === 1 && p.status === "pago"),
      pontos: config.pontosPrimeiraParcela,
    },
    parcelaEmDia: {
      vezes: emDia.length,
      pontosGanhos: soma(emDia),
      pontosPorParcela: config.pontosParcelaEmDia,
      proxima: proxima ? { numero: proxima.numero_parcela, vencimento: proxima.data_vencimento } : null,
    },
    indicacao: { creditadas: indicacoes.length, pontosGanhos: soma(indicacoes), pontosPorIndicacao: config.pontosIndicacao },
  };
}

// ───────────────────────────── Cliente ─────────────────────────────

export async function clubeClienteApi(path: string, request: Request, db: Db, clienteId: string): Promise<Response | null> {
  if (path === "/api/cliente/credit-ops/club" && request.method === "GET") {
    const [saldoR, premiosR, extratoR, beneficiosR, indicacoesR, configR, parcelasR, resgatesR] = await Promise.all([
      db.from("cliente_pontos").select("saldo").eq("cliente_id", clienteId).maybeSingle(),
      db.from("clube_recompensas").select("*").eq("ativo", true).order("ordem").order("pontos"),
      db.from("cliente_pontos_eventos").select("*").eq("cliente_id", clienteId).order("created_at", { ascending: false }).limit(200),
      db.from("clube_beneficios_cliente").select("*").eq("cliente_id", clienteId),
      db.from("indicacoes_clientes").select("*").eq("indicador_cliente_id", clienteId).order("created_at", { ascending: false }),
      db.from("clube_config").select("*").eq("id", 1).maybeSingle(),
      db.from("boletos").select("numero_parcela,status,data_vencimento").eq("cliente_id", clienteId),
      db.from("clube_resgates").select("id,pontos,status,created_at,clube_recompensas(titulo)").eq("cliente_id", clienteId).order("created_at", { ascending: false }).limit(30),
    ]);
    const erro = saldoR.error ?? premiosR.error ?? extratoR.error ?? beneficiosR.error ?? indicacoesR.error ?? parcelasR.error;
    if (erro) {
      console.error("Falha ao carregar Clube de Vantagens da cliente:", erro);
      return json({ erro: "Não foi possível carregar o Clube de Vantagens agora." }, 500);
    }
    const config = configDoBanco(configR.data as Record<string, unknown> | null);
    const extrato = (extratoR.data ?? []) as Array<Record<string, unknown>>;
    const indicacoes = (indicacoesR.data ?? []) as Array<Record<string, unknown>>;
    return json({
      saldo: Number(saldoR.data?.saldo ?? 0),
      config,
      recompensas: premiosR.data ?? [],
      historico: extrato.slice(0, 50),
      missoes: montarMissoes(extrato as EventoPontos[], (parcelasR.data ?? []) as ParcelaResumo[], config),
      // O caminho do arquivo nunca vai para o navegador: só se há voucher anexado.
      beneficios: ((beneficiosR.data ?? []) as Array<Record<string, unknown>>).map(({ arquivo_path, arquivo_mime, arquivo_anexado_por, ...resto }) => ({
        ...resto,
        arquivo_disponivel: Boolean(arquivo_path),
      })),
      indicacoes: {
        confirmadas: indicacoes.filter((i) => i.status === "venda").length,
        emAnalise: indicacoes.filter((i) => i.status === "enviada" || i.status === "qualificada").length,
        itens: indicacoes.map((i) => ({
          id: i.id, nome_indicado: i.nome_indicado, status: i.status,
          pontos_creditados: i.pontos_creditados, created_at: i.created_at,
          status_atualizado_em: i.status_atualizado_em ?? null, pontos_creditados_em: i.pontos_creditados_em ?? null,
        })),
      },
      resgates: ((resgatesR.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id, pontos: r.pontos, status: r.status, created_at: r.created_at,
        titulo: (r.clube_recompensas as { titulo?: string } | null)?.titulo ?? "Prêmio",
      })),
    });
  }

  if (path === "/api/cliente/credit-ops/referrals" && request.method === "POST") {
    const b = await lerCorpo(request);
    const nome = String(b.nome ?? "").trim().replace(/\s+/g, " ");
    const telefone = String(b.telefone ?? "").trim();
    const digitos = telefone.replace(/\D/g, "");
    if (nome.length < 2 || nome.length > 160) return json({ erro: "Informe o nome da sua amiga." }, 400);
    if (digitos.length < 10 || digitos.length > 13) return json({ erro: "Informe o WhatsApp com DDD, por exemplo (61) 99999-0000." }, 400);

    const { data: anteriores, error: erroAnteriores } = await db
      .from("indicacoes_clientes").select("telefone_indicado,status,created_at").eq("indicador_cliente_id", clienteId);
    if (erroAnteriores) return json({ erro: "Não foi possível enviar sua indicação agora." }, 500);
    const lista = (anteriores ?? []) as Array<{ telefone_indicado: string | null; status: string; created_at: string }>;
    if (lista.some((i) => i.status !== "invalidada" && (i.telefone_indicado ?? "").replace(/\D/g, "").slice(-10) === digitos.slice(-10))) {
      return json({ erro: "Você já indicou este número. Acompanhe o andamento na sua lista de indicações." }, 409);
    }
    const ultimas24h = lista.filter((i) => Date.now() - new Date(i.created_at).getTime() < 86_400_000).length;
    if (ultimas24h >= 10) return json({ erro: "Você atingiu o limite de indicações por hoje. Tente novamente amanhã." }, 429);

    const { data, error } = await db.from("indicacoes_clientes")
      .insert({ indicador_cliente_id: clienteId, nome_indicado: nome, telefone_indicado: digitos })
      .select("id,nome_indicado,status,pontos_creditados,created_at").single();
    if (error) {
      console.error("Falha ao registrar indicação da cliente:", error);
      return json({ erro: "Não foi possível enviar sua indicação agora." }, 500);
    }
    return json({ indicacao: data }, 201);
  }

  const solicitar = path.match(/^\/api\/cliente\/credit-ops\/beneficios\/([^/]+)\/solicitar$/);
  if (solicitar && request.method === "POST") {
    const { data, error } = await db.from("clube_beneficios_cliente")
      .update({ solicitado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", decodeURIComponent(solicitar[1])).eq("cliente_id", clienteId).eq("status", "disponivel").is("solicitado_em", null)
      .select("id,beneficio_key,status,solicitado_em").maybeSingle();
    if (error) { console.error("Falha ao solicitar voucher:", error); return json({ erro: "Não foi possível solicitar agora." }, 500); }
    if (!data) return json({ erro: "Este voucher já foi solicitado ou não está disponível." }, 409);
    await db.from("logs_alteracoes").insert({ usuario: `cliente:${clienteId}`, acao: "solicitou_voucher_clube", entidade: "clube_beneficios_cliente", entidade_id: data.id, detalhes: { beneficio_key: data.beneficio_key } });
    return json({ beneficio: data });
  }

  const arquivo = path.match(/^\/api\/cliente\/credit-ops\/beneficios\/([^/]+)\/arquivo$/);
  if (arquivo && request.method === "GET") {
    const { data } = await db.from("clube_beneficios_cliente").select("arquivo_path")
      .eq("id", decodeURIComponent(arquivo[1])).eq("cliente_id", clienteId).neq("status", "cancelado").maybeSingle();
    if (!data?.arquivo_path) return json({ erro: "Seu voucher ainda está sendo preparado pela equipe." }, 404);
    const { data: assinado, error } = await db.storage.from(BUCKET_VOUCHERS).createSignedUrl(data.arquivo_path, 300);
    if (error || !assinado?.signedUrl) return json({ erro: "Não foi possível abrir o voucher agora." }, 500);
    return json({ url: assinado.signedUrl });
  }

  return null;
}

// ───────────────────────────── Equipe (admin) ─────────────────────────────

const ERROS_INDICACAO: Array<[RegExp, string, number]> = [
  [/Status de indicacao invalido/, "Status inválido.", 400],
  [/Indicacao nao encontrada/, "Indicação não encontrada.", 404],
  [/Indicacao ja creditada/, "Esta indicação já gerou pontos e não pode mudar de status.", 409],
  [/Vincule a cliente/, "Vincule a cliente indicada para marcar como fechada.", 400],
  [/si mesma/, "A cliente não pode indicar a si mesma.", 400],
  [/Cliente indicada nao encontrada/, "Cliente indicada não encontrada.", 404],
  [/uq_indicacoes_indicado_venda/, "Esta cliente já está vinculada a outra indicação fechada.", 409],
];

export async function clubeAdminApi(path: string, request: Request, db: Db, usuario: string): Promise<Response | null> {
  if (path === "/api/admin/credit-ops/club/overview" && request.method === "GET") {
    const [indicacoesR, vouchersR, configR] = await Promise.all([
      db.from("indicacoes_clientes").select("*").order("created_at", { ascending: false }).limit(300),
      db.from("clube_beneficios_cliente").select("*").order("created_at", { ascending: false }).limit(300),
      db.from("clube_config").select("*").eq("id", 1).maybeSingle(),
    ]);
    const erro = indicacoesR.error ?? vouchersR.error;
    if (erro) return json({ erro: publicError(erro) }, 500);
    const indicacoes = (indicacoesR.data ?? []) as Array<Record<string, unknown>>;
    const vouchers = (vouchersR.data ?? []) as Array<Record<string, unknown>>;
    const ids = [...new Set([
      ...indicacoes.flatMap((i) => [i.indicador_cliente_id, i.indicado_cliente_id]),
      ...vouchers.map((v) => v.cliente_id),
    ].filter(Boolean) as string[])];
    const { data: clientes } = ids.length
      ? await db.from("clientes").select("id,nome_completo,telefone,cpf").in("id", ids)
      : { data: [] as Array<{ id: string; nome_completo: string; telefone: string | null; cpf: string | null }> };
    const porId = new Map((clientes ?? []).map((c) => [c.id, c]));
    return json({
      config: configDoBanco(configR.data as Record<string, unknown> | null),
      indicacoes: indicacoes.map((i) => ({
        ...i,
        indicador: porId.get(String(i.indicador_cliente_id)) ?? null,
        indicado: i.indicado_cliente_id ? porId.get(String(i.indicado_cliente_id)) ?? null : null,
      })),
      vouchers: vouchers.map(({ arquivo_path, ...v }) => ({ ...v, arquivo_disponivel: Boolean(arquivo_path), cliente: porId.get(String(v.cliente_id)) ?? null })),
    });
  }

  if (path === "/api/admin/credit-ops/club/clientes" && request.method === "GET") {
    const termo = new URL(request.url).searchParams.get("busca")?.trim() ?? "";
    if (termo.length < 2) return json({ clientes: [] });
    const digitos = termo.replace(/\D/g, "");
    const seguro = termo.replace(/[%,()]/g, " ");
    const filtro = digitos.length >= 3 ? `nome_completo.ilike.%${seguro}%,cpf.ilike.%${digitos}%,telefone.ilike.%${digitos}%` : `nome_completo.ilike.%${seguro}%`;
    const { data, error } = await db.from("clientes").select("id,nome_completo,cpf,telefone").or(filtro).order("nome_completo").limit(10);
    if (error) return json({ erro: publicError(error) }, 500);
    return json({ clientes: data ?? [] });
  }

  const indicacao = path.match(/^\/api\/admin\/credit-ops\/club\/referrals\/([^/]+)$/);
  if (indicacao && request.method === "POST") {
    const b = await lerCorpo(request);
    const { data, error } = await db.rpc("clube_atualizar_indicacao", {
      p_indicacao_id: decodeURIComponent(indicacao[1]),
      p_status: String(b.status ?? ""),
      p_indicado_cliente_id: b.indicadoClienteId ? String(b.indicadoClienteId) : null,
      p_observacao: typeof b.observacao === "string" ? b.observacao.slice(0, 500) : null,
      p_usuario: usuario,
    });
    if (error) {
      const mensagem = String(error.message ?? "");
      const conhecido = ERROS_INDICACAO.find(([re]) => re.test(mensagem));
      if (conhecido) return json({ erro: conhecido[1] }, conhecido[2]);
      return json({ erro: publicError(error) }, 500);
    }
    return json({ indicacao: data });
  }

  const voucherArquivo = path.match(/^\/api\/admin\/credit-ops\/club\/vouchers\/([^/]+)\/arquivo$/);
  if (voucherArquivo && request.method === "POST") {
    const id = decodeURIComponent(voucherArquivo[1]);
    const form = await request.formData();
    const arquivoEnviado = form.get("arquivo");
    if (!(arquivoEnviado instanceof File)) return json({ erro: "Selecione o arquivo do voucher." }, 400);
    if (arquivoEnviado.size > 10 * 1024 * 1024) return json({ erro: "O voucher deve ter no máximo 10 MB." }, 400);
    const bytes = new Uint8Array(await arquivoEnviado.arrayBuffer());
    const tipo = detectarTipoArquivo(bytes);
    if (!tipo) return json({ erro: "Envie um PDF, JPG, PNG ou WebP válido." }, 400);
    const { data: beneficio } = await db.from("clube_beneficios_cliente").select("id,cliente_id,status,arquivo_path").eq("id", id).maybeSingle();
    if (!beneficio) return json({ erro: "Voucher não encontrado." }, 404);
    if (beneficio.status === "cancelado") return json({ erro: "Este voucher foi cancelado." }, 409);
    const caminho = `${beneficio.cliente_id}/${id}/${crypto.randomUUID()}.${tipo.extensao}`;
    const { error: erroUpload } = await db.storage.from(BUCKET_VOUCHERS).upload(caminho, bytes, { contentType: tipo.mime, upsert: false });
    if (erroUpload) return json({ erro: publicError(erroUpload) }, 500);
    const { error: erroUpdate } = await db.from("clube_beneficios_cliente").update({
      arquivo_path: caminho, arquivo_mime: tipo.mime, arquivo_anexado_em: new Date().toISOString(), arquivo_anexado_por: usuario, updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (erroUpdate) {
      await db.storage.from(BUCKET_VOUCHERS).remove([caminho]);
      return json({ erro: publicError(erroUpdate) }, 500);
    }
    if (beneficio.arquivo_path && beneficio.arquivo_path !== caminho) await db.storage.from(BUCKET_VOUCHERS).remove([beneficio.arquivo_path]);
    await db.from("logs_alteracoes").insert({ usuario, acao: "anexou_voucher_clube", entidade: "clube_beneficios_cliente", entidade_id: id, detalhes: { cliente_id: beneficio.cliente_id, tipo: tipo.mime, tamanho: arquivoEnviado.size } });
    await db.from("notificacoes_cliente").insert({
      cliente_id: beneficio.cliente_id, tipo: "clube", titulo: "Seu voucher está disponível",
      mensagem: "A equipe liberou o seu voucher de consulta. Abra o Clube de Vantagens para visualizar.", emoji: "🎟️", destino: "clube", referencia_id: id,
    });
    return json({ sucesso: true });
  }
  if (voucherArquivo && request.method === "GET") {
    const { data } = await db.from("clube_beneficios_cliente").select("arquivo_path").eq("id", decodeURIComponent(voucherArquivo[1])).maybeSingle();
    if (!data?.arquivo_path) return json({ erro: "Nenhum arquivo anexado." }, 404);
    const { data: assinado, error } = await db.storage.from(BUCKET_VOUCHERS).createSignedUrl(data.arquivo_path, 300);
    if (error || !assinado?.signedUrl) return json({ erro: "Não foi possível abrir o arquivo agora." }, 500);
    return json({ url: assinado.signedUrl });
  }

  if (path === "/api/admin/credit-ops/club/config" && request.method === "POST") {
    const b = await lerCorpo(request);
    const valor = (campo: unknown) => {
      const n = Number(campo);
      return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : null;
    };
    const patch = {
      pontos_primeira_parcela: valor(b.pontosPrimeiraParcela),
      pontos_parcela_em_dia: valor(b.pontosParcelaEmDia),
      pontos_indicacao_venda: valor(b.pontosIndicacao),
    };
    if (Object.values(patch).some((v) => v === null)) return json({ erro: "Informe pontuações inteiras entre 0 e 100.000." }, 400);
    const { data, error } = await db.from("clube_config").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1).select("*").single();
    if (error) return json({ erro: publicError(error) }, 500);
    await db.from("logs_alteracoes").insert({ usuario, acao: "alterou_pontuacao_clube", entidade: "clube_config", entidade_id: null, detalhes: patch });
    return json({ config: configDoBanco(data as Record<string, unknown>) });
  }

  return null;
}
