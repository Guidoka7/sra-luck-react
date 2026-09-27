import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import type { AdminAccessProfile } from "@/lib/adminAccess";
import type { EventoAgendaVisaoGeral } from "@/lib/visaoGeralContrato";
import { hrefAgenda, hrefEvento } from "./destinos";
import { plural, rotuloDia } from "./formatos";

const STATUS: Record<EventoAgendaVisaoGeral["status"], string> = {
  assinado: "Assinado",
  a_assinar: "A assinar",
  confirmada: "Confirmada",
  realizada: "Realizada",
};

export function AgendaSemana({ eventos, hoje, mes, rotuloMes, perfil }: {
  eventos: EventoAgendaVisaoGeral[];
  hoje: string;
  mes: { termos: number; cirurgias: number };
  rotuloMes: string;
  perfil: AdminAccessProfile | null;
}) {
  const dias = new Map<string, EventoAgendaVisaoGeral[]>();
  for (const evento of eventos) dias.set(evento.data, [...(dias.get(evento.data) ?? []), evento]);
  const agenda = hrefAgenda(perfil);

  return <section className="vg-panel vg-agenda" aria-labelledby="vg-agenda-titulo">
    <header className="vg-panel-head">
      <div>
        <h2 id="vg-agenda-titulo">Agenda · próximos 7 dias</h2>
        <p>Assinaturas de termos e cirurgias confirmadas.</p>
      </div>
      {agenda && <Link href={agenda} className="vg-link">Abrir agenda<ChevronRight size={13} aria-hidden="true" /></Link>}
    </header>

    {dias.size === 0
      ? <div className="vg-vazio"><CalendarDays size={20} aria-hidden="true" /><strong>Semana sem compromissos</strong><span>Nenhum termo ou cirurgia nos próximos 7 dias.</span></div>
      : <ol className="vg-agenda-dias">
        {[...dias.entries()].map(([data, lista]) => <li key={data} className={data === hoje ? "is-today" : undefined}>
          <h3 className="vg-agenda-dia">{rotuloDia(data, hoje)}<span>{plural(lista.length, "compromisso", "compromissos")}</span></h3>
          <ul>
            {lista.map((evento) => {
              const href = hrefEvento(perfil, evento);
              const conteudo = <>
                <span className="vg-evento-hora">{evento.horario ?? "—"}</span>
                <span className={`vg-evento-tipo is-${evento.tipo}`}>{evento.tipo === "cirurgia" ? "Cirurgia" : "Termos"}</span>
                <span className="vg-evento-nome">{evento.nome}</span>
                <span className={`vg-evento-status is-${evento.status}`}>{STATUS[evento.status]}</span>
              </>;
              return <li key={evento.id}>{href ? <Link href={href} className="vg-evento vg-evento-link">{conteudo}</Link> : <div className="vg-evento">{conteudo}</div>}</li>;
            })}
          </ul>
        </li>)}
      </ol>}

    <footer className="vg-panel-foot">
      <span>Em {rotuloMes}: <strong>{plural(mes.termos, "termo", "termos")}</strong> · <strong>{plural(mes.cirurgias, "cirurgia", "cirurgias")}</strong></span>
    </footer>
  </section>;
}
