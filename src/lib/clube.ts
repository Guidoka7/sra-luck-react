export interface ClubeRecompensa {
  id: string;
  titulo: string;
  descricao: string | null;
  categoria: string | null;
  pontos: number;
  estoque: number | null;
  ativo: boolean;
  ordem: number;
  icone_key: string | null;
  instrucoes_pos_resgate: string | null;
  imagem_url?: string | null;
}

export interface ClubePontosEvento {
  id: string;
  tipo: "indicacao" | "bonus" | "resgate" | "ajuste";
  pontos: number;
  referencia: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ClubeBeneficio {
  id: string;
  beneficio_key: string;
  status: "disponivel" | "utilizado" | "cancelado";
  origem: string;
  created_at: string;
  solicitado_em?: string | null;
  arquivo_disponivel?: boolean;
}

export interface ClubeIndicacao {
  id: string;
  nome_indicado: string;
  status: "enviada" | "qualificada" | "venda" | "invalidada";
  pontos_creditados: number;
  created_at: string;
  status_atualizado_em?: string | null;
  pontos_creditados_em?: string | null;
}

export interface ClubeConfig { pontosPrimeiraParcela: number; pontosParcelaEmDia: number; pontosIndicacao: number }
export type ClubeCampanhaTipo = "primeira_parcela" | "parcela_em_dia" | "indicacao" | "resgate" | "informativa";
export interface ClubeCampanha {
  id: string; chave?: string | null; tipo: ClubeCampanhaTipo; titulo: string; descricao: string | null;
  recompensa_texto: string | null; ativo: boolean; ordem: number; created_at: string;
}

export interface ClubeMissoes {
  primeiraParcela: { concluida: boolean; pontos: number };
  parcelaEmDia: { vezes: number; pontosGanhos: number; pontosPorParcela: number; proxima: { numero: number; vencimento: string | null } | null };
  indicacao: { creditadas: number; pontosGanhos: number; pontosPorIndicacao: number };
}

export interface ClubeResgate { id: string; titulo: string; pontos: number; status: "solicitado" | "aprovado" | "separacao" | "entregue" | "cancelado"; created_at: string }

export interface ClubeData {
  saldo: number;
  recompensas: ClubeRecompensa[];
  historico: ClubePontosEvento[];
  beneficios: ClubeBeneficio[];
  indicacoes: { confirmadas: number; emAnalise: number; itens: ClubeIndicacao[] };
  config?: ClubeConfig;
  missoes?: ClubeMissoes;
  campanhas?: ClubeCampanha[];
  resgates?: ClubeResgate[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  const dados = await resposta.json().catch(() => ({})) as T & { erro?: string };
  if (!resposta.ok) throw new Error(dados.erro ?? "Não foi possível concluir a operação.");
  return dados;
}

export function buscarClube() {
  return api<ClubeData>("/api/cliente/credit-ops/club");
}

export function resgatarPremio(recompensaId: string, idempotencyKey: string) {
  return api<{ resgate: unknown; saldo: number }>("/api/cliente/credit-ops/redeem", {
    method: "POST",
    body: JSON.stringify({ recompensaId, idempotencyKey }),
  });
}

export function indicarAmiga(nome: string, telefone: string, consentimentoContato: boolean) {
  return api<{ indicacao: unknown }>("/api/cliente/credit-ops/referrals", {
    method: "POST",
    body: JSON.stringify({ nome, telefone, consentimentoContato }),
  });
}

export function usarBeneficio(beneficioId: string) {
  return api<{ beneficio: ClubeBeneficio }>(`/api/cliente/credit-ops/beneficios/${beneficioId}/usar`, { method: "POST" });
}

export const VOUCHER_CONSULTA_KEY = "voucher_consulta_doutor";

export function solicitarVoucher(beneficioId: string) {
  return api<{ beneficio: ClubeBeneficio }>(`/api/cliente/credit-ops/beneficios/${beneficioId}/solicitar`, { method: "POST" });
}

export function abrirArquivoVoucher(beneficioId: string) {
  return api<{ url: string }>(`/api/cliente/credit-ops/beneficios/${beneficioId}/arquivo`);
}
