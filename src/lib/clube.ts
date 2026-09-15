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
}

export interface ClubePontosEvento {
  id: string;
  tipo: "indicacao" | "bonus" | "resgate" | "ajuste";
  pontos: number;
  created_at: string;
}

export interface ClubeBeneficio {
  id: string;
  beneficio_key: string;
  status: "disponivel" | "utilizado" | "cancelado";
  origem: string;
  created_at: string;
}

export interface ClubeIndicacao {
  id: string;
  status: "enviada" | "qualificada" | "venda" | "invalidada";
  pontos_creditados: number;
  created_at: string;
}

export interface ClubeData {
  saldo: number;
  recompensas: ClubeRecompensa[];
  historico: ClubePontosEvento[];
  beneficios: ClubeBeneficio[];
  indicacoes: { confirmadas: number; emAnalise: number; itens: ClubeIndicacao[] };
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

export async function indicarAmiga(nome: string, telefone: string, consentimentoContato?: boolean) {
  let consentimento = consentimentoContato === true;
  if (!consentimento && typeof window !== "undefined") {
    consentimento = window.confirm("Confirme somente se sua amiga autorizou a Sra. Luck a usar o nome e telefone informados para entrar em contato com ela.");
  }
  if (!consentimento) throw new Error("A indicação só pode ser enviada após a autorização da pessoa indicada.");
  return api<{ indicacao: unknown }>("/api/cliente/credit-ops/referrals", {
    method: "POST",
    body: JSON.stringify({ nome, telefone, consentimentoContato: true }),
  });
}

export function usarBeneficio(beneficioId: string) {
  return api<{ beneficio: ClubeBeneficio }>(`/api/cliente/credit-ops/beneficios/${beneficioId}/usar`, { method: "POST" });
}

export const VOUCHER_CONSULTA_KEY = "voucher_consulta_doutor";
