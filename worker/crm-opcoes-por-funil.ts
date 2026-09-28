import "./integracoes-registro-rd-slug-patch";
import { CAMPOS_NATIVOS_CRM } from "./integracoes-registro";

type Json = Record<string, any>;
export type CampoCatalogoCrm = { slug: string; nome: string; entidade: "deal" | "contact"; tipo: string };
export type CampoNativoCrm = { fonte: string; rotulo: string };

function objectValue(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

const SLUG_RD = /^[a-z0-9_-]{1,100}$/;

function slugsPersonalizados(registro: Json) {
  const cf = registro.custom_fields;
  if (cf && typeof cf === "object" && !Array.isArray(cf)) return Object.keys(cf).filter((slug) => SLUG_RD.test(slug));
  return arrayValue(cf).map((raw) => {
    const item = objectValue(raw);
    return stringValue(item.slug) || stringValue(objectValue(item.custom_field).slug);
  }).filter((slug) => SLUG_RD.test(slug));
}

function idsContato(deal: Json) {
  const ids = new Set<string>();
  const adicionar = (value: unknown) => {
    const id = typeof value === "object" && value !== null ? stringValue(objectValue(value).id) : stringValue(value);
    if (id) ids.add(id);
  };
  adicionar(deal.contact_id);
  adicionar(deal.contact);
  for (const value of arrayValue(deal.contact_ids)) adicionar(value);
  for (const value of arrayValue(deal.contacts)) adicionar(value);
  return [...ids];
}

function possuiChave(registro: Json, chave: string) {
  return Object.prototype.hasOwnProperty.call(registro, chave);
}

export function camposDisponiveisDoFunil(deals: Json[], contatosPorId: Map<string, Json>, catalogo: CampoCatalogoCrm[]) {
  const custom = new Set<string>();
  const nativos = new Set<string>();
  const contatosUsados = new Set<string>();
  const meta = new Map(catalogo.map((campo) => [`${campo.entidade}:${campo.slug}`, campo]));

  for (const deal of deals) {
    for (const slug of slugsPersonalizados(deal)) custom.add(`deal:${slug}`);
    for (const campo of CAMPOS_NATIVOS_CRM) {
      if (!campo.fonte.startsWith("deal_field:")) continue;
      const chave = campo.fonte.slice("deal_field:".length);
      if (possuiChave(deal, chave)) nativos.add(campo.fonte);
    }
    for (const id of idsContato(deal)) contatosUsados.add(id);
  }

  for (const id of contatosUsados) {
    const contato = contatosPorId.get(id);
    if (!contato) continue;
    for (const slug of slugsPersonalizados(contato)) custom.add(`contact:${slug}`);
    for (const campo of CAMPOS_NATIVOS_CRM) {
      if (!campo.fonte.startsWith("contact_field:")) continue;
      const chave = campo.fonte.slice("contact_field:".length);
      if (possuiChave(contato, chave)) nativos.add(campo.fonte);
    }
  }

  const campos = [...custom].map((fonte) => {
    const [entidade, slug] = fonte.split(":") as ["deal" | "contact", string];
    const encontrado = meta.get(fonte);
    return {
      slug,
      nome: encontrado?.nome || slug,
      entidade,
      tipo: encontrado?.tipo || "desconhecido",
    };
  }).sort((a, b) => `${a.entidade}:${a.nome}`.localeCompare(`${b.entidade}:${b.nome}`, "pt-BR"));

  const camposNativos = CAMPOS_NATIVOS_CRM.filter((campo) => nativos.has(campo.fonte));
  return { campos, camposNativos, totalNegociacoes: deals.length, totalContatos: contatosUsados.size };
}
