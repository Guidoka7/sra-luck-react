import { CAMPOS_NATIVOS_CRM } from "./integracoes-registro";
import { arrayValue, listarSeguro, listarTudo, objectValue, rdGet, stringValue } from "./rd-station-readonly";
import type { Env } from "./supabase";

type Json = Record<string, any>;
type EntidadeCampo = "deal" | "contact";

type CampoMeta = {
  slug: string;
  nome: string;
  entidade: EntidadeCampo;
  tipo: string;
  opcoes: string[];
};

type CampoDisponivel = CampoMeta & {
  fonte: string;
  ocorrencias: number;
};

type CampoNativoDisponivel = {
  fonte: string;
  rotulo: string;
  ocorrencias: number;
};

type InventarioFunil = {
  campos: CampoDisponivel[];
  camposNativos: CampoNativoDisponivel[];
  amostra: {
    negociacoes: number;
    contatos: number;
    criterio: "campo_com_valor_observado";
  };
};

const ROTULOS_NATIVOS: Record<string, string> = {
  "deal_field:name": "Negociação: Nome",
  "deal_field:status": "Negociação: Status",
  "deal_field:total_price": "Negociação: Valor total",
  "deal_field:created_at": "Negociação: Criada em",
  "deal_field:updated_at": "Negociação: Atualizada em",
  "deal_field:pipeline_id": "Negociação: Funil",
  "deal_field:stage_id": "Negociação: Etapa",
  "deal_field:user_id": "Negociação: Usuário responsável",
  "contact_field:name": "Contato: Nome",
  "contact_field:emails": "Contato: E-mails",
  "contact_field:phones": "Contato: Telefones",
};

function valorPresente(valor: unknown) {
  if (valor === undefined || valor === null || valor === "") return false;
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === "object") return Object.keys(valor as Json).length > 0;
  return true;
}

function incrementar(mapa: Map<string, number>, chave: string) {
  mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
}

function pipelineId(deal: Json) {
  return stringValue(deal.pipeline_id) || stringValue(objectValue(deal.pipeline).id);
}

function contatoIds(deal: Json) {
  const ids = new Set<string>();
  for (const item of arrayValue(deal.contact_ids)) {
    const id = stringValue(item) || stringValue(objectValue(item).id);
    if (id) ids.add(id);
  }
  const direto = stringValue(objectValue(deal.contact).id);
  if (direto) ids.add(direto);
  return [...ids];
}

function camposPersonalizados(registro: Json): Array<[string, unknown]> {
  const cf = registro.custom_fields;
  if (cf && typeof cf === "object" && !Array.isArray(cf)) return Object.entries(cf as Json);
  const saida: Array<[string, unknown]> = [];
  for (const bruto of arrayValue(cf)) {
    const item = objectValue(bruto);
    const meta = objectValue(item.custom_field);
    const slug = stringValue(item.slug) || stringValue(meta.slug);
    if (slug) saida.push([slug, item.value]);
  }
  return saida;
}

function metadados(definicoes: Json[]) {
  const mapa = new Map<string, CampoMeta>();
  for (const bruto of definicoes) {
    const entidade = stringValue(bruto.entity) as EntidadeCampo;
    const slug = stringValue(bruto.slug);
    if (!["deal", "contact"].includes(entidade) || !/^[a-z0-9_]{1,60}$/.test(slug)) continue;
    mapa.set(`${entidade}:${slug}`, {
      slug,
      nome: stringValue(bruto.name) || slug,
      entidade,
      tipo: stringValue(bruto.type),
      opcoes: arrayValue(bruto.options).map(stringValue).filter(Boolean),
    });
  }
  return mapa;
}

function observarRegistro(entidade: EntidadeCampo, registro: Json, custom: Map<string, number>, nativos: Map<string, number>) {
  for (const [slug, valor] of camposPersonalizados(registro)) {
    if (valorPresente(valor) && /^[a-z0-9_]{1,60}$/.test(slug)) incrementar(custom, `${entidade}:${slug}`);
  }
  for (const campo of CAMPOS_NATIVOS_CRM) {
    const [origemEntidade, chave] = campo.fonte.split(":");
    if (origemEntidade !== `${entidade}_field`) continue;
    if (valorPresente(registro[chave])) incrementar(nativos, campo.fonte);
  }
}

export function inventariarCamposPorFunil(deals: Json[], contatos: Json[], definicoes: Json[]) {
  const meta = metadados(definicoes);
  const contatosPorId = new Map<string, Json>();
  for (const contato of contatos) {
    const id = stringValue(contato.id);
    if (id) contatosPorId.set(id, contato);
  }

  const bruto = new Map<string, {
    negociacoes: number;
    contatoIds: Set<string>;
    custom: Map<string, number>;
    nativos: Map<string, number>;
  }>();

  for (const deal of deals) {
    const idFunil = pipelineId(deal);
    if (!idFunil) continue;
    let atual = bruto.get(idFunil);
    if (!atual) {
      atual = { negociacoes: 0, contatoIds: new Set<string>(), custom: new Map(), nativos: new Map() };
      bruto.set(idFunil, atual);
    }
    atual.negociacoes += 1;
    observarRegistro("deal", deal, atual.custom, atual.nativos);
    for (const id of contatoIds(deal)) atual.contatoIds.add(id);
  }

  const saida: Record<string, InventarioFunil> = {};
  for (const [idFunil, atual] of bruto) {
    let contatosObservados = 0;
    for (const id of atual.contatoIds) {
      const contato = contatosPorId.get(id);
      if (!contato) continue;
      contatosObservados += 1;
      observarRegistro("contact", contato, atual.custom, atual.nativos);
    }

    const campos = [...atual.custom.entries()].map(([fonte, ocorrencias]) => {
      const [entidade, slug] = fonte.split(":") as [EntidadeCampo, string];
      const conhecido = meta.get(fonte);
      return {
        fonte,
        slug,
        nome: conhecido?.nome ?? slug,
        entidade,
        tipo: conhecido?.tipo ?? "",
        opcoes: conhecido?.opcoes ?? [],
        ocorrencias,
      } satisfies CampoDisponivel;
    }).sort((a, b) => `${a.entidade}:${a.nome}`.localeCompare(`${b.entidade}:${b.nome}`, "pt-BR"));

    const camposNativos = [...atual.nativos.entries()].map(([fonte, ocorrencias]) => ({
      fonte,
      rotulo: ROTULOS_NATIVOS[fonte] ?? CAMPOS_NATIVOS_CRM.find((c) => c.fonte === fonte)?.rotulo ?? fonte,
      ocorrencias,
    })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));

    saida[idFunil] = {
      campos,
      camposNativos,
      amostra: { negociacoes: atual.negociacoes, contatos: contatosObservados, criterio: "campo_com_valor_observado" },
    };
  }
  return saida;
}

/**
 * O endpoint de custom_fields do RD é da conta inteira e não aceita filtro por funil.
 * Por isso as opções de origem são derivadas dos dados realmente observados nas negociações
 * de cada pipeline e nos contatos vinculados a essas negociações. Não inventamos que um campo
 * pertence a um funil quando a API não fornece essa associação.
 */
export async function opcoesCrm(env: Env) {
  const [funis, deals, contatos, definicoes] = await Promise.all([
    listarTudo(env, "pipelines"),
    listarSeguro(env, "deals"),
    listarSeguro(env, "contacts"),
    listarSeguro(env, "custom_fields"),
  ]);
  const inventario = inventariarCamposPorFunil(deals, contatos, definicoes);

  const comEtapas = await Promise.all(funis.map(async (f) => {
    const id = stringValue(f.id);
    let etapas: Json[] = [];
    try {
      etapas = arrayValue((await rdGet(env, `/pipelines/${encodeURIComponent(id)}/stages?page[number]=1&page[size]=100`)).data).map(objectValue);
    } catch {
      etapas = [];
    }
    const camposDoFunil = inventario[id] ?? {
      campos: [],
      camposNativos: [],
      amostra: { negociacoes: 0, contatos: 0, criterio: "campo_com_valor_observado" as const },
    };
    return {
      id,
      nome: stringValue(f.name) || id,
      etapas: etapas.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)).map((e) => ({ id: stringValue(e.id), nome: stringValue(e.name) || stringValue(e.id) })),
      ...camposDoFunil,
    };
  }));

  // Compatibilidade temporária com telas antigas. O novo Dev Console usa somente funis[].campos.
  const camposLegados = definicoes
    .filter((c) => ["deal", "contact"].includes(stringValue(c.entity)))
    .map((c) => ({ slug: stringValue(c.slug), nome: stringValue(c.name) || stringValue(c.slug), entidade: stringValue(c.entity) as EntidadeCampo, tipo: stringValue(c.type), opcoes: arrayValue(c.options).map(stringValue).filter(Boolean) }))
    .filter((c) => /^[a-z0-9_]{1,60}$/.test(c.slug));

  return {
    funis: comEtapas,
    campos: camposLegados,
    camposNativos: CAMPOS_NATIVOS_CRM,
    escopoCampos: "por_funil_observado" as const,
    inventario: { negociacoesLidas: deals.length, contatosLidos: contatos.length },
  };
}
