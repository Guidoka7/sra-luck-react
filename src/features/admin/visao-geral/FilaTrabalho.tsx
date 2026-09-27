import { useState } from "react";
import Link from "next/link";
import { AlertOctagon, CheckCircle2, ChevronDown, ChevronRight, Clock3, Lightbulb } from "lucide-react";
import type { AdminAccessProfile } from "@/lib/adminAccess";
import type { Pendencia, SeveridadePendencia } from "@/lib/visaoGeralContrato";
import { DESTINO_AREA, hrefArea, hrefItem } from "./destinos";
import { moeda, numero } from "./formatos";

const ICONE: Record<SeveridadePendencia, typeof Clock3> = {
  critica: AlertOctagon,
  atencao: Clock3,
  info: Lightbulb,
  ok: CheckCircle2,
};

const ROTULO_SEVERIDADE: Record<SeveridadePendencia, string> = {
  critica: "Prazo vencido",
  atencao: "Requer ação",
  info: "Oportunidade",
  ok: "Em dia",
};

function LinhaPendencia({ pendencia, perfil, aberta, alternar }: {
  pendencia: Pendencia;
  perfil: AdminAccessProfile | null;
  aberta: boolean;
  alternar: () => void;
}) {
  const Icone = ICONE[pendencia.severidade];
  const destino = hrefArea(perfil, pendencia.area, pendencia.id);
  const restantes = pendencia.total - pendencia.itens.length;
  const idLista = `vg-fila-${pendencia.id}`;

  return <li className={`vg-fila-item vg-sev-${pendencia.severidade}${aberta ? " is-open" : ""}`}>
    <button type="button" className="vg-fila-linha" onClick={alternar} aria-expanded={aberta} aria-controls={idLista}>
      <span className="vg-fila-icone" aria-hidden="true"><Icone size={16} strokeWidth={2.2} /></span>
      <span className="vg-fila-texto">
        <span className="vg-fila-titulo">{pendencia.titulo}</span>
        <span className="vg-fila-desc">{pendencia.descricao}</span>
      </span>
      <span className="vg-fila-numeros">
        <span className="vg-fila-total" aria-label={`${pendencia.total} itens`}>{numero(pendencia.total)}</span>
        {pendencia.valor !== null && pendencia.valor > 0 && <span className="vg-fila-valor">{moeda(pendencia.valor)}</span>}
      </span>
      <span className="vg-sr">{ROTULO_SEVERIDADE[pendencia.severidade]}</span>
      <ChevronDown className="vg-fila-chevron" size={16} aria-hidden="true" />
    </button>
    {aberta && <div className="vg-fila-detalhe" id={idLista}>
      <ul className="vg-fila-lista">
        {pendencia.itens.map((item) => {
          const href = hrefItem(perfil, pendencia.area, item, pendencia.id);
          const conteudo = <>
            <span className="vg-item-nome">{item.nome}</span>
            <span className="vg-item-detalhe">{item.detalhe}</span>
            {item.meta && <span className={`vg-item-meta${item.atrasado ? " is-late" : ""}`}>{item.meta}</span>}
          </>;
          return <li key={item.id}>
            {href ? <Link href={href} className="vg-item vg-item-link">{conteudo}<ChevronRight size={14} aria-hidden="true" className="vg-item-seta" /></Link>
              : <div className="vg-item">{conteudo}</div>}
          </li>;
        })}
      </ul>
      <div className="vg-fila-rodape">
        <span>{restantes > 0 ? `+ ${numero(restantes)} ${restantes === 1 ? "item" : "itens"} na área` : "Todos os itens exibidos"}</span>
        {destino ? <Link href={destino} className="vg-link">{DESTINO_AREA[pendencia.area].rotulo}<ChevronRight size={13} aria-hidden="true" /></Link>
          : <span className="vg-fila-sem-acesso">Sem acesso a esta área</span>}
      </div>
    </div>}
  </li>;
}

export function FilaTrabalho({ pendencias, perfil }: { pendencias: Pendencia[]; perfil: AdminAccessProfile | null }) {
  const ativas = pendencias.filter((p) => p.severidade !== "ok");
  const emDia = pendencias.filter((p) => p.severidade === "ok");
  // A primeira pendência crítica já vem aberta: é a próxima ação do dia.
  const [aberta, setAberta] = useState<string | null>(() => ativas.find((p) => p.severidade === "critica")?.id ?? null);

  return <section className="vg-panel vg-fila" aria-labelledby="vg-fila-titulo">
    <header className="vg-panel-head">
      <div>
        <h2 id="vg-fila-titulo">Fila de trabalho</h2>
        <p>O que precisa de ação, do prazo mais urgente para o menos urgente.</p>
      </div>
    </header>
    {ativas.length === 0
      ? <div className="vg-vazio vg-vazio-ok"><CheckCircle2 size={22} aria-hidden="true" /><strong>Operação em dia</strong><span>Nenhuma pendência aberta agora.</span></div>
      : <ul className="vg-fila-lista-principal">
        {ativas.map((p) => <LinhaPendencia key={p.id} pendencia={p} perfil={perfil} aberta={aberta === p.id} alternar={() => setAberta((atual) => atual === p.id ? null : p.id)} />)}
      </ul>}
    {emDia.length > 0 && <div className="vg-em-dia">
      <span className="vg-em-dia-rotulo"><CheckCircle2 size={13} aria-hidden="true" /> Em dia</span>
      {emDia.map((p) => <span key={p.id} className="vg-chip">{p.titulo}</span>)}
    </div>}
  </section>;
}
