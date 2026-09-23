import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";
import { clubeAdminApi, clubeClienteApi } from "./clube";

interface InstallmentSummaryRow {
  id: string;
  numero_parcela: number;
  total_parcelas?: number | null;
  valor?: number | string | null;
  status: string;
  data_vencimento?: string | null;
  data_pagamento?: string | null;
  valor_recebido?: number | string | null;
  comprovante_url?: string | null;
  boleto_url?: string | null;
  banco_emissor?: string | null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mesmaOrigem(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function exigirAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const token = getCookie(request, "admin_session");
  const session = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  return session?.adminId ?? null;
}

async function exigirCliente(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const token = getCookie(request, "cliente_session");
  const session = await verificarTokenSessao(token, env.CLIENTE_SESSION_SECRET);
  return session?.clienteId ?? null;
}

export async function creditOpsApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/api/admin/credit-ops/")) {
    const adminId = await exigirAdmin(request, env);
    if (!adminId) return json({ erro: "Sessão administrativa expirada." }, 401);
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method) && !mesmaOrigem(request)) {
      return json({ erro: "Requisição de origem não autorizada." }, 403);
    }
    const colaborador = await buscarColaboradorAdminAtivo(adminId, env).catch(() => null);
    if (!colaborador) return json({ erro: "Acesso administrativo não autorizado." }, 403);
    const pode = (permissao: string) => temPermissaoAdmin(colaborador, permissao);
    const db = createServiceSupabaseClient(env);

    // Clube de Vantagens: indicações, vouchers e pontuação (worker/clube.ts).
    if (path.startsWith("/api/admin/credit-ops/club/")) {
      if (!pode(PERMISSOES_ADMIN.CREDITO_GERENCIAR)) return json({ erro: "Seu papel não tem permissão para operar o Clube de Vantagens." }, 403);
      const resposta = await clubeAdminApi(path, request, db, `admin:${adminId}`);
      if (resposta) return resposta;
    }

    if (path === "/api/admin/credit-ops/contracts" && request.method === "GET") {
      const { data, error } = await db
        .from("contratos_credito")
        .select("*, clientes(id,nome_completo,cpf,telefone,email)")
        .order("created_at", { ascending: false });
      if (error) return json({ erro: publicError(error) }, 500);
      return json({ contratos: data ?? [] });
    }

    if (path === "/api/admin/credit-ops/contracts" && request.method === "POST") {
      if (!pode(PERMISSOES_ADMIN.CREDITO_GERENCIAR)) return json({ erro: "Seu papel não tem permissão para criar contratos de crédito." }, 403);
      const b = await body(request);
      const clienteId = String(b.clienteId ?? "");
      const codigo = String(b.codigo ?? "").trim();
      const valor = Number(b.valorContrato ?? 0);
      if (!clienteId || !codigo || !(valor > 0)) return json({ erro: "Cliente, código e valor do contrato são obrigatórios." }, 400);
      const { data, error } = await db.from("contratos_credito").insert({
        cliente_id: clienteId,
        codigo,
        rd_deal_id: b.rdDealId || null,
        campanha: b.campanha || null,
        origem: b.origem || null,
        modalidade: b.modalidade === "100_boleto" ? "100_boleto" : "flex",
        valor_contrato: valor,
        percentual_minimo: Number(b.percentualMinimo ?? 60),
        etapa: "aguardando_conferencia",
      }).select("*").single();
      if (error) return json({ erro: publicError(error) }, 400);
      return json({ contrato: data }, 201);
    }

    const contract = path.match(/^\/api\/admin\/credit-ops\/contracts\/([^/]+)$/);
    if (contract && request.method === "PATCH") {
      if (!pode(PERMISSOES_ADMIN.CREDITO_GERENCIAR)) return json({ erro: "Seu papel não tem permissão para alterar contratos de crédito." }, 403);
      const b = await body(request);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const map: Record<string, string> = {
        campanha: "campanha",
        origem: "origem",
        modalidade: "modalidade",
        etapa: "etapa",
        percentualMinimo: "percentual_minimo",
        saldoFinalApurado: "saldo_final_apurado",
        formaQuitacao: "forma_quitacao",
        pagarNoDiaTermos: "pagar_no_dia_termos",
        previsaoAtingirPercentual: "previsao_atingir_percentual",
        termosAssinadosEm: "termos_assinados_em",
        agendaCirurgicaLiberarEm: "agenda_cirurgica_liberar_em",
        cirurgiaEm: "cirurgia_em",
      };
      for (const [from, to] of Object.entries(map)) if (b[from] !== undefined) patch[to] = b[from];
      const { data, error } = await db.from("contratos_credito").update(patch).eq("id", decodeURIComponent(contract[1])).select("*").single();
      if (error) return json({ erro: publicError(error) }, 400);
      return json({ contrato: data });
    }

    if (path === "/api/admin/credit-ops/finance/daily" && request.method === "GET") {
      const day = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      const start = `${day}T00:00:00.000Z`;
      const end = `${day}T23:59:59.999Z`;
      const [paid, proofs, overdue, events] = await Promise.all([
        db.from("boletos").select("*, clientes(id,nome_completo)").gte("recebido_em", start).lte("recebido_em", end).order("recebido_em", { ascending: false }),
        db.from("comprovantes_pagamento").select("*, clientes(id,nome_completo), boletos(id,numero_parcela,total_parcelas,valor,banco_emissor)").in("status", ["aguardando_validacao", "em_analise"]).order("created_at", { ascending: false }).limit(200),
        db.from("boletos").select("*, clientes(id,nome_completo)").lt("data_vencimento", day).neq("status", "pago").order("data_vencimento", { ascending: true }).limit(200),
        db.from("conciliacao_financeira_eventos").select("*").gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false }).limit(300),
      ]);
      const errors = [paid.error, proofs.error, overdue.error, events.error]
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .map((value) => publicError(value));
      return json({
        data: day,
        liquidados: paid.data ?? [],
        aguardandoValidacao: proofs.data ?? [],
        vencidos: overdue.data ?? [],
        eventos: events.data ?? [],
        erros: errors,
      });
    }

    if (path === "/api/admin/credit-ops/rewards" && request.method === "GET") {
      const { data, error } = await db.from("clube_recompensas").select("*").is("excluido_em", null).order("ordem").order("pontos", { ascending: true });
      if (error) return json({ erro: publicError(error) }, 500);
      return json({ recompensas: data ?? [] });
    }

    if (path === "/api/admin/credit-ops/rewards" && request.method === "POST") {
      if (!pode(PERMISSOES_ADMIN.CREDITO_GERENCIAR)) return json({ erro: "Seu papel não tem permissão para alterar recompensas." }, 403);
      const b = await body(request);
      const titulo = String(b.titulo ?? "").trim().replace(/\s+/g, " ");
      const pontos = Number(b.pontos);
      const estoque = b.estoque === undefined || b.estoque === null || b.estoque === "" ? null : Number(b.estoque);
      const ordem = b.ordem === undefined || b.ordem === null || b.ordem === "" ? 0 : Number(b.ordem);
      const imagemBruta = String(b.imagemUrl ?? b.imagem_url ?? "").trim();
      let imagemUrl: string | null = null;
      if (imagemBruta) {
        try {
          const urlImagem = new URL(imagemBruta);
          if (!["http:", "https:"].includes(urlImagem.protocol)) throw new Error("protocolo");
          imagemUrl = urlImagem.toString();
        } catch {
          return json({ erro: "Informe uma URL de imagem válida (http ou https)." }, 400);
        }
      }
      if (titulo.length < 2 || titulo.length > 160) return json({ erro: "Informe um nome de benefício entre 2 e 160 caracteres." }, 400);
      if (!Number.isInteger(pontos) || pontos <= 0 || pontos > 10_000_000) return json({ erro: "Informe uma pontuação inteira maior que zero." }, 400);
      if (estoque !== null && (!Number.isInteger(estoque) || estoque < 0 || estoque > 1_000_000)) return json({ erro: "Informe um estoque válido ou deixe em branco para estoque livre." }, 400);
      if (!Number.isInteger(ordem) || ordem < -10_000 || ordem > 10_000) return json({ erro: "Informe uma ordem válida." }, 400);
      const payload = {
        titulo,
        descricao: String(b.descricao ?? "").trim().slice(0, 800) || null,
        categoria: String(b.categoria ?? "").trim().slice(0, 100) || null,
        pontos,
        estoque,
        ativo: b.ativo !== false,
        imagem_url: imagemUrl,
        ordem,
        instrucoes_pos_resgate: String(b.instrucoesPosResgate ?? b.instrucoes_pos_resgate ?? "").trim().slice(0, 1000) || null,
        excluido_em: null,
      };
      const { data, error } = await db.from("clube_recompensas").insert(payload).select("*").single();
      if (error) return json({ erro: publicError(error) }, 400);
      await db.from("logs_alteracoes").insert({ usuario: `admin:${adminId}`, acao: "criou_recompensa_clube", entidade: "clube_recompensas", entidade_id: data.id, detalhes: payload });
      return json({ recompensa: data }, 201);
    }

    const reward = path.match(/^\/api\/admin\/credit-ops\/rewards\/([^/]+)$/);
    if (reward && request.method === "PATCH") {
      if (!pode(PERMISSOES_ADMIN.CREDITO_GERENCIAR)) return json({ erro: "Seu papel não tem permissão para alterar recompensas." }, 403);
      const id = decodeURIComponent(reward[1]);
      const b = await body(request);
      const patch: Record<string, unknown> = {};

      if (b.titulo !== undefined) {
        const titulo = String(b.titulo ?? "").trim().replace(/\s+/g, " ");
        if (titulo.length < 2 || titulo.length > 160) return json({ erro: "Informe um nome de benefício entre 2 e 160 caracteres." }, 400);
        patch.titulo = titulo;
      }
      if (b.descricao !== undefined) patch.descricao = String(b.descricao ?? "").trim().slice(0, 800) || null;
      if (b.categoria !== undefined) patch.categoria = String(b.categoria ?? "").trim().slice(0, 100) || null;
      if (b.pontos !== undefined) {
        const pontos = Number(b.pontos);
        if (!Number.isInteger(pontos) || pontos <= 0 || pontos > 10_000_000) return json({ erro: "Informe uma pontuação inteira maior que zero." }, 400);
        patch.pontos = pontos;
      }
      if (b.estoque !== undefined) {
        const estoque = b.estoque === null || b.estoque === "" ? null : Number(b.estoque);
        if (estoque !== null && (!Number.isInteger(estoque) || estoque < 0 || estoque > 1_000_000)) return json({ erro: "Informe um estoque válido ou deixe em branco para estoque livre." }, 400);
        patch.estoque = estoque;
      }
      if (b.ativo !== undefined) patch.ativo = Boolean(b.ativo);
      if (b.ordem !== undefined) {
        const ordem = Number(b.ordem);
        if (!Number.isInteger(ordem) || ordem < -10_000 || ordem > 10_000) return json({ erro: "Informe uma ordem válida." }, 400);
        patch.ordem = ordem;
      }
      if (b.imagemUrl !== undefined || b.imagem_url !== undefined) {
        const imagemBruta = String(b.imagemUrl ?? b.imagem_url ?? "").trim();
        if (!imagemBruta) patch.imagem_url = null;
        else {
          try {
            const urlImagem = new URL(imagemBruta);
            if (!["http:", "https:"].includes(urlImagem.protocol)) throw new Error("protocolo");
            patch.imagem_url = urlImagem.toString();
          } catch {
            return json({ erro: "Informe uma URL de imagem válida (http ou https)." }, 400);
          }
        }
      }
      if (b.instrucoesPosResgate !== undefined || b.instrucoes_pos_resgate !== undefined) {
        patch.instrucoes_pos_resgate = String(b.instrucoesPosResgate ?? b.instrucoes_pos_resgate ?? "").trim().slice(0, 1000) || null;
      }
      if (!Object.keys(patch).length) return json({ erro: "Nenhuma alteração informada." }, 400);

      const { data, error } = await db.from("clube_recompensas").update(patch).eq("id", id).is("excluido_em", null).select("*").maybeSingle();
      if (error) return json({ erro: publicError(error) }, 400);
      if (!data) return json({ erro: "Benefício não encontrado." }, 404);
      await db.from("logs_alteracoes").insert({ usuario: `admin:${adminId}`, acao: "alterou_recompensa_clube", entidade: "clube_recompensas", entidade_id: id, detalhes: patch });
      return json({ recompensa: data });
    }

    if (reward && request.method === "DELETE") {
      if (!pode(PERMISSOES_ADMIN.CREDITO_GERENCIAR)) return json({ erro: "Seu papel não tem permissão para excluir recompensas." }, 403);
      const id = decodeURIComponent(reward[1]);
      const excluidoEm = new Date().toISOString();
      const { data, error } = await db.from("clube_recompensas")
        .update({ ativo: false, excluido_em: excluidoEm })
        .eq("id", id).is("excluido_em", null)
        .select("id,titulo").maybeSingle();
      if (error) return json({ erro: publicError(error) }, 400);
      if (!data) return json({ erro: "Benefício não encontrado." }, 404);
      await db.from("logs_alteracoes").insert({ usuario: `admin:${adminId}`, acao: "excluiu_recompensa_clube", entidade: "clube_recompensas", entidade_id: id, detalhes: { titulo: data.titulo, excluido_em: excluidoEm } });
      return json({ sucesso: true });
    }

    if (path === "/api/admin/credit-ops/team" && request.method === "GET") {
      const [staff, rules, commissions, training] = await Promise.all([
        db.from("colaboradores").select("*").order("nome"),
        db.from("comissao_regras").select("*").eq("ativo", true).order("perfil"),
        db.from("comissao_eventos").select("*, colaboradores(nome,perfil)").order("created_at", { ascending: false }).limit(300),
        db.from("treinamentos").select("*").eq("ativo", true).order("created_at", { ascending: false }),
      ]);
      return json({ colaboradores: staff.data ?? [], regras: rules.data ?? [], comissoes: commissions.data ?? [], treinamentos: training.data ?? [] });
    }

    if (path === "/api/admin/credit-ops/team/commission-rules" && request.method === "POST") {
      if (!pode(PERMISSOES_ADMIN.EQUIPE_GERENCIAR)) return json({ erro: "Seu papel não tem permissão para alterar regras de comissão." }, 403);
      const b = await body(request);
      const { data, error } = await db.from("comissao_regras").insert({
        perfil: b.perfil,
        nome: b.nome,
        tipo: b.tipo,
        valor: Number(b.valor),
        meta_base: b.metaBase === undefined ? null : Number(b.metaBase),
        configuracao: b.configuracao || {},
      }).select("*").single();
      if (error) return json({ erro: publicError(error) }, 400);
      return json({ regra: data }, 201);
    }

    if (path === "/api/admin/credit-ops/team/trainings" && request.method === "POST") {
      if (!pode(PERMISSOES_ADMIN.EQUIPE_GERENCIAR)) return json({ erro: "Seu papel não tem permissão para criar treinamentos." }, 403);
      const b = await body(request);
      const { data, error } = await db.from("treinamentos").insert({
        titulo: b.titulo,
        descricao: b.descricao || null,
        tipo: b.tipo || "texto",
        conteudo_url: b.conteudoUrl || null,
        conteudo_texto: b.conteudoTexto || null,
        perfis: Array.isArray(b.perfis) ? b.perfis : ["todos"],
        obrigatorio: Boolean(b.obrigatorio),
      }).select("*").single();
      if (error) return json({ erro: publicError(error) }, 400);
      return json({ treinamento: data }, 201);
    }

    return null;
  }

  if (path.startsWith("/api/cliente/credit-ops/")) {
    const clienteId = await exigirCliente(request, env);
    if (!clienteId) return json({ erro: "Sessão expirada." }, 401);
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method) && !mesmaOrigem(request)) {
      return json({ erro: "Requisição de origem não autorizada." }, 403);
    }
    const db = createServiceSupabaseClient(env);

    if (path === "/api/cliente/credit-ops/summary" && request.method === "GET") {
      const { data: contrato, error } = await db.from("contratos_credito").select("*").eq("cliente_id", clienteId).neq("etapa", "cancelado").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) { console.error("Falha ao carregar contrato da cliente:", error); return json({ erro: "Não foi possível carregar seu contrato agora." }, 500); }
      if (!contrato) return json({ contrato: null });

      const { data: parcelasData, error: parcelasError } = await db
        .from("boletos")
        .select("id,numero_parcela,total_parcelas,valor,status,data_vencimento,data_pagamento,valor_recebido,comprovante_url,boleto_url,banco_emissor")
        .eq("cliente_id", clienteId)
        .order("numero_parcela");
      if (parcelasError) { console.error("Falha ao carregar parcelas da cliente:", parcelasError); return json({ erro: "Não foi possível carregar suas parcelas agora." }, 500); }

      const parcelas = (parcelasData ?? []) as unknown as InstallmentSummaryRow[];
      const pagas = parcelas.filter((parcela) => parcela.status === "pago");
      const recebidos = pagas.reduce((soma, parcela) => soma + Number(parcela.valor_recebido ?? parcela.valor ?? 0), 0);
      const totalParcelas = parcelas.reduce(
        (maior, parcela) => Math.max(maior, Number(parcela.total_parcelas ?? 0)),
        parcelas.length,
      );
      const parcelasPagas = pagas.length;
      const percentual = totalParcelas > 0
        ? Math.round((parcelasPagas / totalParcelas) * 1000) / 10
        : 0;
      const percentualMinimo = Number(contrato.percentual_minimo ?? 60);
      const parcelasNecessarias = totalParcelas > 0
        ? Math.ceil((totalParcelas * percentualMinimo) / 100)
        : 0;

      return json({
        contrato,
        parcelas,
        recebido: recebidos,
        percentual,
        parcelasPagas,
        totalParcelas,
        parcelasNecessarias,
        parcelasRestantesParaMeta: Math.max(0, parcelasNecessarias - parcelasPagas),
      });
    }

    // Clube de Vantagens da cliente (leitura, indicação, voucher): worker/clube.ts.
    const clube = await clubeClienteApi(path, request, db, clienteId);
    if (clube) return clube;

    const usarBeneficio = path.match(/^\/api\/cliente\/credit-ops\/beneficios\/([^/]+)\/usar$/);
    if (usarBeneficio && request.method === "POST") {
      const beneficioId = decodeURIComponent(usarBeneficio[1]);
      const { data, error } = await db
        .from("clube_beneficios_cliente")
        .update({ status: "utilizado", updated_at: new Date().toISOString() })
        .eq("id", beneficioId)
        .eq("cliente_id", clienteId)
        .eq("status", "disponivel")
        .select("*")
        .maybeSingle();
      if (error) { console.error("Falha ao utilizar benefício da cliente:", error); return json({ erro: "Não foi possível utilizar o benefício agora." }, 500); }
      if (!data) return json({ erro: "Benefício não encontrado ou já utilizado." }, 404);
      return json({ beneficio: data });
    }

    if (path === "/api/cliente/credit-ops/redeem" && request.method === "POST") {
      const b = await body(request);
      const rewardId = String(b.recompensaId ?? "");
      const idempotencyKey = String(b.idempotencyKey ?? "");
      if (!rewardId) return json({ erro: "Recompensa não informada." }, 400);
      if (!idempotencyKey || idempotencyKey.length > 120) return json({ erro: "Chave de idempotência inválida." }, 400);
      const { data: resgate, error } = await db.rpc("clube_resgatar", {
        p_cliente_id: clienteId,
        p_recompensa_id: rewardId,
        p_idempotency_key: idempotencyKey,
      });
      if (error) {
        const mensagem = String(error.message ?? "");
        if (mensagem.includes("Saldo de pontos insuficiente")) return json({ erro: "Você não possui pontos suficientes para este resgate." }, 409);
        if (mensagem.includes("Recompensa indisponivel")) return json({ erro: "Esta recompensa não está mais disponível." }, 409);
        if (mensagem.includes("Recompensa sem estoque disponivel")) return json({ erro: "Esta recompensa está sem estoque no momento." }, 409);
        if (mensagem.includes("Chave de idempotencia invalida")) return json({ erro: "Não foi possível validar esta solicitação. Tente novamente." }, 400);
        if (mensagem.includes("Chave de idempotencia ja utilizada")) return json({ erro: "Esta solicitação já foi utilizada em outro resgate." }, 409);
        console.error("Falha ao resgatar recompensa da cliente:", error);
        return json({ erro: "Não foi possível concluir o resgate agora." }, 500);
      }
      const { data: pontos } = await db.from("cliente_pontos").select("saldo").eq("cliente_id", clienteId).maybeSingle();
      return json({ resgate, saldo: Number(pontos?.saldo ?? 0) }, 201);
    }

    return null;
  }

  return null;
}
