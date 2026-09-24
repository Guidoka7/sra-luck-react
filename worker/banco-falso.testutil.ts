/**
 * Banco em memória para testes das integrações (subconjunto do cliente Supabase usado
 * por crm-importacao.ts e conta-azul.ts). Não é usado em produção.
 */
type Linha = Record<string, any>;
type Filtro = (l: Linha) => boolean;

const RELACOES: Record<string, { tabela: string; chave: string }> = {
  boletos: { tabela: "boletos", chave: "boleto_id" },
  clientes: { tabela: "clientes", chave: "cliente_id" },
};

const UNICOS: Record<string, string[][]> = {
  conta_azul_vinculos: [["boleto_id"], ["marcador"], ["ca_parcela_id"]],
  integracao_fila: [["chave_idempotencia"]],
  novas_vendas: [["rd_station_id"]],
  integracoes_config: [["provedor", "funcao"]],
  integracao_cursores: [["provedor", "nome"]],
};

const PADROES: Record<string, () => Linha> = {
  conta_azul_vinculos: () => ({ estado: "aguardando_criacao", sra_snapshot: {}, ca_snapshot: {}, ca_parcela_id: null, ca_evento_id: null, ca_baixa_id: null, baixa_origem: null, ultima_sincronizacao_em: null }),
  integracao_fila: () => ({ estado: "pendente", tentativas: 0, max_tentativas: 6, payload: {}, proxima_tentativa_em: new Date().toISOString() }),
  integracao_conflitos: () => ({ estado: "aberto", dados_sra: {}, dados_externos: {} }),
  integracao_importacoes: () => ({ status: "em_andamento", totais: {} }),
  integracao_importacao_itens: () => ({ correspondencias: [], dados: {}, revisado_em: null }),
};

export function bancoFalso(inicial: Record<string, Linha[]> = {}, rpcs: Record<string, (args: Linha) => unknown> = {}) {
  const tabelas = new Map<string, Linha[]>(Object.entries(inicial).map(([k, v]) => [k, v.map((x: Linha) => ({ ...x }))]));
  const tabela = (nome: string) => { if (!tabelas.has(nome)) tabelas.set(nome, []); return tabelas.get(nome)!; };
  let seq = 0;
  const novoId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

  function violaUnico(nome: string, linha: Linha, ignorar?: Linha) {
    const regras = UNICOS[nome] ?? [];
    const rows = tabela(nome).filter((r) => r !== ignorar);
    for (const cols of regras) {
      if (cols.some((c) => linha[c] == null)) continue;
      if (rows.some((r) => cols.every((c) => r[c] === linha[c]))) return true;
    }
    if (nome === "integracao_conflitos" && linha.estado === "aberto") {
      return rows.some((r) => r.estado === "aberto" && r.provedor === linha.provedor && r.referencia === linha.referencia && r.tipo === linha.tipo);
    }
    return false;
  }

  function comRelacoes(linha: Linha, colunas: string) {
    const out = { ...linha };
    for (const m of colunas.matchAll(/(\w+)\(/g)) {
      const rel = RELACOES[m[1]];
      if (rel) out[m[1]] = tabela(rel.tabela).find((r) => r.id === linha[rel.chave]) ?? null;
    }
    return out;
  }

  function construtor(nome: string) {
    const filtros: Filtro[] = [];
    let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let dados: Linha[] = [];
    let patch: Linha = {};
    let colunas = "*";
    let contar = false, cabeca = false, limite = Infinity, de = 0, ate = Infinity;
    let ordem: { col: string; asc: boolean } | null = null;
    let onConflict: string[] = [];

    const executar = (): { data: any; error: any; count?: number } => {
      const rows = tabela(nome);
      if (op === "insert" || op === "upsert") {
        const inseridas: Linha[] = [];
        for (const d of dados) {
          const linha: Linha = { id: novoId(), created_at: new Date().toISOString(), ...(PADROES[nome]?.() ?? {}), ...d };
          if (op === "upsert" && onConflict.length) {
            const alvo = rows.find((r) => onConflict.every((c) => r[c] === linha[c]));
            if (alvo) { Object.assign(alvo, d); inseridas.push(alvo); continue; }
          }
          if (violaUnico(nome, linha)) return { data: null, error: { code: "23505", message: "duplicate" } };
          rows.push(linha); inseridas.push(linha);
        }
        return { data: inseridas.map((l) => ({ ...l })), error: null };
      }
      let alvo = rows.filter((r) => filtros.every((f) => f(r)));
      if (op === "update") {
        for (const r of alvo) {
          const nova = { ...r, ...patch };
          if (violaUnico(nome, nova, r)) return { data: null, error: { code: "23505" } };
          Object.assign(r, patch);
        }
        return { data: alvo.map((l) => ({ ...l })), error: null };
      }
      if (op === "delete") {
        tabelas.set(nome, rows.filter((r) => !alvo.includes(r)));
        return { data: alvo, error: null };
      }
      if (ordem) {
        const { col, asc } = ordem;
        alvo = [...alvo].sort((a, b) => (a[col] ?? "") < (b[col] ?? "") ? (asc ? -1 : 1) : (a[col] ?? "") > (b[col] ?? "") ? (asc ? 1 : -1) : 0);
      }
      const total = alvo.length;
      alvo = alvo.slice(de, Math.min(ate + 1, alvo.length)).slice(0, limite);
      if (cabeca) return { data: null, error: null, count: total };
      return { data: alvo.map((l) => comRelacoes(l, colunas)), error: null, count: contar ? total : undefined };
    };

    const q: any = {
      select: (c = "*", o?: { count?: string; head?: boolean }) => { colunas = c; if (o?.count) contar = true; if (o?.head) cabeca = true; return q; },
      insert: (d: Linha | Linha[]) => { op = "insert"; dados = Array.isArray(d) ? d : [d]; return q; },
      upsert: (d: Linha | Linha[], o?: { onConflict?: string }) => { op = "upsert"; dados = Array.isArray(d) ? d : [d]; onConflict = (o?.onConflict ?? "").split(",").filter(Boolean); return q; },
      update: (p: Linha) => { op = "update"; patch = p; return q; },
      delete: () => { op = "delete"; return q; },
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; },
      neq: (c: string, v: unknown) => { filtros.push((l) => l[c] !== v); return q; },
      in: (c: string, v: unknown[]) => { filtros.push((l) => v.includes(l[c])); return q; },
      is: (c: string, v: null) => { filtros.push((l) => (l[c] ?? null) === v); return q; },
      not: (c: string, operador: string, v: null) => { if (operador === "is") filtros.push((l) => (l[c] ?? null) !== v); return q; },
      lte: (c: string, v: string) => { filtros.push((l) => l[c] <= v); return q; },
      gte: (c: string, v: string) => { filtros.push((l) => l[c] >= v); return q; },
      like: (c: string, padrao: string) => { const p = padrao.replace(/%$/, ""); filtros.push((l) => String(l[c] ?? "").startsWith(p)); return q; },
      or: (expr: string) => {
        const partes = expr.split(",").map((x) => { const [c, o, ...v] = x.split("."); return { c, o, v: v.join(".") }; });
        filtros.push((l) => partes.some((p) => p.o === "eq" && String(l[p.c]) === p.v));
        return q;
      },
      order: (c: string, o?: { ascending?: boolean }) => { ordem = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limite = n; return q; },
      range: (a: number, b: number) => { de = a; ate = b; return q; },
      maybeSingle: async () => { const r = executar(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      single: async () => { const r = executar(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { message: "no rows" }) }; },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
    };
    return q;
  }

  const db = {
    from: (nome: string) => construtor(nome),
    rpc: async (nome: string, args: Linha) => {
      if (rpcs[nome]) return { data: rpcs[nome](args), error: null };
      if (nome === "integracao_tentar_trava") return { data: true, error: null };
      return { data: null, error: null };
    },
  };
  return { db: db as never, tabela };
}
