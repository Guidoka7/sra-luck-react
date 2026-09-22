import type { CartaoCliente } from "@/features/scheduling/types";
import { DrawerIcon } from "./DrawerIcons";
import { passosDaJornada } from "./drawerModel";
import styles from "./ClienteDrawer.module.css";

/** Aba Jornada — mesma lista de etapas do app da cliente (`passosDaJornada`). */
export function JornadaPanel({ cartao, concluido, erro, onTentar }: { cartao: CartaoCliente | null; concluido: boolean; erro: string | null; onTentar: () => void }) {
  if (!cartao) {
    return <div className={styles.stateBox} role={erro ? "alert" : undefined}>
      <strong>{erro ? "Jornada indisponível" : "Carregando jornada…"}</strong>
      {erro ?? "Buscando o estado real do processo."}
      {erro ? <div><button type="button" className={styles.retryBtn} onClick={onTentar}>Tentar novamente</button></div> : null}
    </div>;
  }
  const passos = passosDaJornada(cartao, concluido);
  const atual = passos.find((p) => p.status === "current") ?? passos[passos.length - 1];
  return <div className={styles.stack}>
    <article className={styles.card}>
      <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="route" aria-hidden="true" />Jornada da cliente</h3><span className={styles.journeyBadge}><DrawerIcon name="usercard" width={13} height={13} aria-hidden="true" /> Espelhada no app</span></div>
      <div className={styles.journeyBody}>
        {atual && <div className={styles.journeyCurrent}>
          <div>
            <span className={styles.journeyKicker}>{atual.status === "done" ? "Jornada concluída" : "Etapa atual no app"}</span>
            <div className={styles.journeyNow}>{atual.title}</div>
            <div className={styles.journeyDetail}>{atual.description}</div>
          </div>
        </div>}
        <div className={styles.journeyHeading}>
          <div><span className={styles.journeyKicker}>Passo a passo</span><strong>Do contrato à cirurgia</strong></div>
          <span className={styles.journeyLegend}>Concluído · Agora · Próximos</span>
        </div>
        <ol className={styles.journeyList} aria-label="Etapas da jornada da cliente" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {passos.map((p, i) => {
            const cls = p.status === "done" ? styles.complete : p.status === "current" ? styles.current : styles.upcoming;
            const rotulo = p.status === "done" ? "Concluído" : p.status === "current" ? "Agora" : "Próximo";
            return <li key={p.id} className={`${styles.journeyStep} ${cls}`} aria-current={p.status === "current" ? "step" : undefined}>
              <div className={styles.marker} aria-hidden="true">{p.status === "done" ? <DrawerIcon name="check" width={12} height={12} /> : <span>{i + 1}</span>}</div>
              <div>
                <div className={styles.stage}>Etapa {i + 1}</div>
                <div className={styles.journeyTitle}>{p.title}</div>
                <div className={styles.journeyText}>{p.description}</div>
              </div>
              <span className={`${styles.journeyState} ${cls}`}>{rotulo}</span>
            </li>;
          })}
        </ol>
      </div>
    </article>
  </div>;
}
