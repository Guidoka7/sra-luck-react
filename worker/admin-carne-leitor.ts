import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import { codigoBarrasValido, decodificarBoleto, linhaDigitavelValida } from "../src/lib/leitor-carne/febraban";
import { cpfValido, normalizarCpf, somenteDigitos } from "../src/lib/leitor-carne/normalizadores";

/**
 * Leitor de carnês — lado servidor.
 *
 * A LEITURA acontece no navegador (texto nativo + OCR local + parser): este
 * Worker roda como Edge Function, com limite de corpo e de CPU. Aqui ficam
 * apenas as etapas que exigem autoridade:
 *
 *   GET  /api/admin/clientes/:id/leitor-carne?sha=…  parcelas existentes e
 *        se o arquivo já foi importado (duplicidade antes da revisão);
 *   POST /api/admin/clientes/:id/leitor-carne/folhas  envio das folhas
 *        aprovadas, em lotes pequenos, para o bucket PRIVADO;
 *   POST /api/admin/clientes/:id/leitor-carne/importar  revalida tudo e chama
 *        a RPC transacional e idempotente carne_importar_parcelas (migration 078).
 *
 * Nada é gravado sem "Confirmar importação". Logs sem CPF, nome, texto de OCR
 * ou linha digitável.
 */

const BUCKET = "boletos-clientes";
export const LOTE_FOLHAS_MAXIMO = 4 * 1024 * 1024;
const FOLHA_MAXIMA = 3_500_000;
const EXTENSOES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

function tipoPorConteudo(b: Uint8Array): string | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;

const MENSAGENS_RPC: [RegExp, string, number][] = [
  [/DOCUMENTO_JA_IMPORTADO/, "Este arquivo já foi importado para esta cliente.", 409],
  [/PARCELA_JA_EXISTE:(\d+)/, "A parcela $1 já existe no cadastro. Escolha anexar à parcela existente ou ignorar.", 409],
  [/PARCELA_JA_TEM_BOLETO:(\d+)/, "A parcela $1 já tem boleto anexado. Escolha substituir ou ignorar.", 409],
  [/PARCELA_PAGA_OU_EM_CONFERENCIA:(\d+)/, "A parcela $1 está paga ou em conferência; o boleto não pode ser substituído.", 409],
  [/PARCELA_SEM_BOLETO:(\d+)/, "A parcela $1 não tinha boleto; use anexar.", 409],
  [/TOTAL_CONFLITANTE/, "O total de parcelas informado é diferente do total já cadastrado para a cliente.", 409],
  [/VENCIMENTO_OBRIGATORIO/, "Informe o vencimento de todas as parcelas que serão criadas.", 400],
  [/VALOR_OBRIGATORIO/, "Informe o valor de todas as parcelas que serão criadas.", 400],
  [/PARCELA_INVALIDA|PARCELA_NAO_ENCONTRADA/, "Há uma parcela inválida na importação. Revise os itens.", 400],
  [/IDENTIFICADOR_INVALIDO/, "Há uma linha digitável inválida na importação.", 400],
  [/ARQUIVO_INVALIDO/, "Arquivo de boleto inválido na importação.", 400],
  [/CLIENTE_NAO_ENCONTRADA/, "Cliente não encontrada.", 404],
  [/CHAVE_IDEMPOTENCIA/, "Importação inválida. Leia o documento novamente.", 400],
];

function erroRpc(mensagem: string) {
  for (const [re, texto, status] of MENSAGENS_RPC) {
    const m = mensagem.match(re);
    if (m) return json({ erro: texto.replace("$1", m[1] ?? "") }, status);
  }
  return null;
}

export interface ItemImportacao {
  item: string;
  acao: "criar" | "anexar" | "substituir" | "ignorar";
  boletoId?: string | null;
  numero?: number | null;
  total?: number | null;
  vencimento?: string | null;
  valorCentavos?: number | null;
  arquivoPath?: string | null;
  identificador?: string | null;
  corrigidos?: string[];
}

/**
 * Validação autoritativa dos itens (pura, testável). Devolve a mensagem de
 * erro para a equipe ou null. A RPC repete as validações de integridade.
 */
export function validarItens(itens: ItemImportacao[], prefixo: string, arquivosExistentes: Set<string>): string | null {
  if (!Array.isArray(itens) || !itens.length) return "Nenhuma parcela selecionada para importar.";
  if (itens.length > 400) return "Itens demais em uma importação.";
  const vistos = new Set<string>();
  const numerosCriados = new Set<number>();
  const boletosUsados = new Set<string>();
  for (const it of itens) {
    if (!it || typeof it.item !== "string" || !/^p\d{1,3}-s\d{1,2}$/.test(it.item)) return "Item de importação inválido.";
    if (vistos.has(it.item)) return "Item repetido na importação.";
    vistos.add(it.item);
    if (!["criar", "anexar", "substituir", "ignorar"].includes(it.acao)) return "Ação inválida na importação.";
    if (it.acao === "ignorar") continue;
    if (!it.arquivoPath || !it.arquivoPath.startsWith(prefixo) || it.arquivoPath.includes("..") || !arquivosExistentes.has(it.arquivoPath.slice(prefixo.length))) {
      return "O arquivo de uma das parcelas não foi enviado. Tente confirmar novamente.";
    }
    const ident = it.identificador ? somenteDigitos(it.identificador) : "";
    if (ident && !(linhaDigitavelValida(ident) || codigoBarrasValido(ident))) {
      return `A linha digitável do item ${it.item} não passa na conferência dos dígitos. Corrija ou apague antes de importar.`;
    }
    if (it.acao === "criar") {
      if (!Number.isInteger(it.numero) || !Number.isInteger(it.total) || it.numero! < 1 || it.numero! > it.total!) return "Número/total de parcela inválido em um item.";
      if (numerosCriados.has(it.numero!)) return `A parcela ${it.numero} foi marcada para criação mais de uma vez.`;
      numerosCriados.add(it.numero!);
      if (!it.vencimento || !/^\d{4}-\d{2}-\d{2}$/.test(it.vencimento) || Number.isNaN(Date.parse(`${it.vencimento}T00:00:00Z`))) return `Informe o vencimento da parcela ${it.numero}.`;
      if (!Number.isInteger(it.valorCentavos) || it.valorCentavos! <= 0) return `Informe o valor da parcela ${it.numero}.`;
      // Valor e vencimento lidos devem bater com o código de barras, salvo correção humana explícita.
      const dec = ident ? decodificarBoleto(ident, it.vencimento) : null;
      const corrigidos = new Set(it.corrigidos ?? []);
      if (dec && dec.valorCentavos && dec.valorCentavos !== it.valorCentavos && !corrigidos.has("valorCentavos")) {
        return `O valor da parcela ${it.numero} não confere com o código de barras.`;
      }
    } else {
      if (!it.boletoId || !UUID.test(it.boletoId)) return "Selecione a parcela existente para anexar o boleto.";
      if (boletosUsados.has(it.boletoId)) return "Dois boletos foram direcionados para a mesma parcela.";
      boletosUsados.add(it.boletoId);
    }
  }
  return null;
}

export async function adminCarneLeitor(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/api\/admin\/clientes\/([^/]+)\/leitor-carne(?:\/(folhas|importar))?$/);
  if (!m) return null;
  const clienteId = decodeURIComponent(m[1]);
  const acao = m[2] ?? null;
  if (!UUID.test(clienteId)) return json({ erro: "Cliente inválida." }, 400);

  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!session) return json({ erro: "Sessão administrativa expirada." }, 401);
  const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env).catch(() => null);
  if (!colaborador) return json({ erro: "Acesso administrativo não autorizado." }, 403);
  const db = createServiceSupabaseClient(env);

  if (!acao && request.method === "GET") {
    const sha = (url.searchParams.get("sha") ?? "").toLowerCase();
    const [{ data: cliente, error: erroCliente }, { data: boletos, error: erroBoletos }, importacao] = await Promise.all([
      db.from("clientes").select("id,nome_completo,cpf").eq("id", clienteId).is("arquivado_em", null).maybeSingle(),
      db.from("boletos").select("id,numero_parcela,total_parcelas,valor,data_vencimento,status,boleto_url,identificador_externo").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true }),
      SHA.test(sha)
        ? db.from("carne_importacoes").select("id,created_at,criado_por").eq("cliente_id", clienteId).eq("arquivo_sha256", sha).order("created_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (erroCliente || erroBoletos) return json({ erro: publicError(erroCliente ?? erroBoletos) }, 500);
    if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);
    return json({
      cliente: { nome: cliente.nome_completo ?? null, cpf: cliente.cpf ?? null },
      parcelas: (boletos ?? []).map((b: any) => ({
        id: b.id,
        numero: Number(b.numero_parcela),
        total: Number(b.total_parcelas),
        vencimento: b.data_vencimento ?? null,
        valorCentavos: Math.round(Number(b.valor) * 100),
        temBoleto: Boolean(b.boleto_url),
        identificador: b.identificador_externo ?? null,
        status: String(b.status),
      })),
      documentoJaImportado: importacao.data ? { em: importacao.data.created_at } : null,
    });
  }

  if (request.method !== "POST" || !acao) return json({ erro: "Método não permitido." }, 405);
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  if (!temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL)) {
    return json({ erro: "Seu papel não tem permissão para importar carnês." }, 403);
  }

  if (acao === "folhas") {
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ erro: "Envio inválido." }, 400); }
    const sha = String(form.get("sha256") ?? "").toLowerCase();
    if (!SHA.test(sha)) return json({ erro: "Documento inválido." }, 400);
    const { data: cliente } = await db.from("clientes").select("id").eq("id", clienteId).is("arquivado_em", null).maybeSingle();
    if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);
    const folhas = form.getAll("folha").filter((f): f is File => f instanceof File);
    if (!folhas.length || folhas.length > 40) return json({ erro: "Lote de folhas inválido." }, 400);
    const enviados: string[] = [];
    for (const folha of folhas) {
      const nome = folha.name.toLowerCase();
      const partes = nome.match(/^f(\d{1,3})\.(pdf|jpg|png)$/);
      if (!partes) return json({ erro: "Nome de folha inválido." }, 400);
      if (folha.size === 0 || folha.size > FOLHA_MAXIMA) return json({ erro: "Folha vazia ou grande demais." }, 400);
      const bytes = new Uint8Array(await folha.arrayBuffer());
      const tipo = tipoPorConteudo(bytes);
      if (!tipo || tipo !== EXTENSOES[partes[2]]) return json({ erro: "O conteúdo da folha não corresponde ao tipo informado." }, 400);
      const caminho = `carnes/${clienteId}/${sha}/${nome}`;
      const { error } = await db.storage.from(BUCKET).upload(caminho, bytes, { contentType: tipo, upsert: true });
      if (error) return json({ erro: publicError(error, "Não foi possível salvar a folha do boleto.") }, 500);
      enviados.push(caminho);
    }
    return json({ enviados }, 201);
  }

  // acao === "importar"
  const body = await request.json().catch(() => null) as null | { chave?: string; documento?: Record<string, unknown>; itens?: ItemImportacao[]; cpfDocumento?: string | null };
  if (!body || typeof body.chave !== "string" || !/^[A-Za-z0-9-]{16,80}$/.test(body.chave) || !body.documento) return json({ erro: "Importação inválida." }, 400);
  const documento = body.documento;
  const sha = String(documento.sha256 ?? "").toLowerCase();
  if (!SHA.test(sha)) return json({ erro: "Documento inválido." }, 400);
  const prefixo = `carnes/${clienteId}/${sha}/`;

  const { data: cliente } = await db.from("clientes").select("id,cpf").eq("id", clienteId).is("arquivado_em", null).maybeSingle();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

  // CPF do documento diferente do cadastro: só com confirmação explícita. O CPF não é gravado.
  const cpfDoc = normalizarCpf(body.cpfDocumento ?? null);
  const cpfCliente = normalizarCpf(cliente.cpf ?? null);
  const cpfDivergente = Boolean(cpfDoc && cpfCliente && cpfValido(cpfDoc) && cpfDoc !== cpfCliente);
  if (cpfDivergente && documento.cpfDivergenteConfirmado !== true) {
    return json({ erro: "O CPF do documento não corresponde à cliente. Confirme explicitamente para continuar." }, 409);
  }

  const { data: objetos, error: erroLista } = await db.storage.from(BUCKET).list(prefixo.slice(0, -1), { limit: 1000 });
  if (erroLista) return json({ erro: publicError(erroLista) }, 500);
  const existentes = new Set((objetos ?? []).map((o: { name: string }) => o.name));
  const itens = (body.itens ?? []).map((it) => ({ ...it, identificador: it.identificador ? somenteDigitos(it.identificador) : null }));
  const invalido = validarItens(itens, prefixo, existentes);
  if (invalido) return json({ erro: invalido }, 400);

  const alertas = Array.isArray(documento.alertas) ? documento.alertas.filter((a): a is string => typeof a === "string" && /^[A-Z_]{3,40}$/.test(a)).slice(0, 60) : [];
  const metricas = documento.metricas && typeof documento.metricas === "object" ? documento.metricas : {};
  const { data, error } = await db.rpc("carne_importar_parcelas", {
    p_cliente_id: clienteId,
    p_chave: body.chave,
    p_documento: {
      sha256: sha,
      nome: typeof documento.nome === "string" ? documento.nome.slice(0, 200) : null,
      tipo: documento.tipo,
      tamanho: documento.tamanho,
      paginas: documento.paginas,
      tipoDocumento: documento.tipoDocumento,
      parser: documento.parser,
      fingerprint: documento.fingerprint,
      banco: documento.banco,
      confianca: documento.confianca,
      nivel: documento.nivel,
      alertas,
      metricas,
      permitirReimportacao: documento.permitirReimportacao === true,
      cpfDivergenteConfirmado: cpfDivergente && documento.cpfDivergenteConfirmado === true,
    },
    p_itens: itens,
    p_usuario: colaborador.id,
  });
  if (error) {
    const traduzido = erroRpc(error.message ?? "");
    if (traduzido) return traduzido;
    return json({ erro: publicError(error, "Não foi possível concluir a importação.") }, 500);
  }
  return json({ resultado: data }, 201);
}
