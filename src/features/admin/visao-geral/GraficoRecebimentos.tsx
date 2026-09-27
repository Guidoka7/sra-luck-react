import { useEffect, useRef, useState } from "react";
import type { MesFinanceiro } from "@/lib/visaoGeralContrato";
import { moeda, moedaEixo } from "./formatos";

/**
 * Previsto × recebido por mês (barras agrupadas, um único eixo em R$).
 * Previsto = soma das parcelas com vencimento no mês; recebido = valores
 * efetivamente recebidos no mês (inclui atrasadas e antecipadas).
 */
const ALTURA = 230;
const M = { topo: 14, dir: 8, base: 30, esq: 58 };
const ESPACO = 2;

function tetoRedondo(valor: number) {
  if (valor <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(valor));
  const passos = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return (passos.find((p) => p * magnitude >= valor) ?? 10) * magnitude;
}

export function GraficoRecebimentos({ serie }: { serie: MesFinanceiro[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  // O SVG é desenhado na largura real do painel: textos e barras mantêm o
  // tamanho em qualquer tela, sem escalar o desenho.
  const areaRef = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(640);
  useEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(([entrada]) => setLargura(Math.max(280, Math.round(entrada.contentRect.width))));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);
  const maximo = tetoRedondo(Math.max(0, ...serie.flatMap((m) => [m.previsto, m.recebido])));
  const areaL = largura - M.esq - M.dir;
  const areaA = ALTURA - M.topo - M.base;
  const grupo = areaL / Math.max(1, serie.length);
  const BARRA = Math.max(8, Math.min(22, Math.floor(grupo / 3.2)));
  const y = (v: number) => M.topo + areaA - (v / maximo) * areaA;
  const altura = (v: number) => Math.max(0, (v / maximo) * areaA);
  const linhas = [0, 0.5, 1].map((f) => f * maximo);
  const semDados = serie.every((m) => m.previsto === 0 && m.recebido === 0);
  const selecionado = ativo !== null ? serie[ativo] : null;

  function barra(x: number, valor: number, classe: string) {
    const h = altura(valor);
    if (h <= 0) return null;
    const r = Math.min(4, h);
    const topo = y(valor);
    const base = M.topo + areaA;
    // Cantos arredondados só no topo; a base fica ancorada no eixo.
    return <path className={classe} d={`M${x},${base} V${topo + r} Q${x},${topo} ${x + r},${topo} H${x + BARRA - r} Q${x + BARRA},${topo} ${x + BARRA},${topo + r} V${base} Z`} />;
  }

  return <div className="vg-grafico">
    <div className="vg-legenda" aria-hidden="true">
      <span><i className="vg-leg-previsto" />Previsto (vencimentos)</span>
      <span><i className="vg-leg-recebido" />Recebido</span>
    </div>
    {semDados
      ? <div className="vg-vazio"><strong>Sem movimentação no período</strong><span>Nenhuma parcela prevista ou recebida nestes meses.</span></div>
      : <div className="vg-grafico-area" ref={areaRef} onMouseLeave={() => setAtivo(null)}>
        <svg viewBox={`0 0 ${largura} ${ALTURA}`} width={largura} height={ALTURA} role="img" aria-label="Recebimentos previstos e realizados nos últimos meses">
          {linhas.map((v) => <g key={v}>
            <line className="vg-grade" x1={M.esq} x2={largura - M.dir} y1={y(v)} y2={y(v)} />
            <text className="vg-eixo" x={M.esq - 8} y={y(v) + 3.5} textAnchor="end">{moedaEixo(v)}</text>
          </g>)}
          {serie.map((m, i) => {
            const centro = M.esq + grupo * i + grupo / 2;
            const x0 = centro - BARRA - ESPACO / 2;
            return <g key={m.mes} className={`vg-grupo${ativo === i ? " is-active" : ""}${m.futuro ? " is-future" : ""}`}>
              <rect className="vg-grupo-alvo" x={M.esq + grupo * i} y={M.topo} width={grupo} height={areaA} />
              {barra(x0, m.previsto, "vg-barra-previsto")}
              {barra(x0 + BARRA + ESPACO, m.recebido, "vg-barra-recebido")}
              <text className="vg-eixo vg-eixo-mes" x={centro} y={ALTURA - 10} textAnchor="middle">{m.rotulo}</text>
              <rect
                className="vg-grupo-hit" x={M.esq + grupo * i} y={M.topo} width={grupo} height={areaA + M.base}
                tabIndex={0} role="button" aria-label={`${m.rotulo}: previsto ${moeda(m.previsto)}, recebido ${moeda(m.recebido)}`}
                onMouseEnter={() => setAtivo(i)} onFocus={() => setAtivo(i)} onBlur={() => setAtivo(null)}
              />
            </g>;
          })}
        </svg>
        {selecionado && ativo !== null && <div
          className="vg-tooltip" role="status"
          style={{ left: Math.min(largura - 100, Math.max(100, M.esq + grupo * ativo + grupo / 2)) }}
        >
          <strong>{selecionado.rotulo}{selecionado.futuro ? " · previsão" : ""}</strong>
          <span><i className="vg-leg-previsto" />Previsto<b>{moeda(selecionado.previsto)}</b></span>
          <span><i className="vg-leg-recebido" />Recebido<b>{moeda(selecionado.recebido)}</b></span>
          {selecionado.vencido > 0 && <span className="is-late">Em atraso<b>{moeda(selecionado.vencido)}</b></span>}
        </div>}
      </div>}
    <table className="vg-sr">
      <caption>Recebimentos por mês</caption>
      <thead><tr><th>Mês</th><th>Previsto</th><th>Recebido</th><th>Em atraso</th></tr></thead>
      <tbody>{serie.map((m) => <tr key={m.mes}><td>{m.rotulo}</td><td>{moeda(m.previsto)}</td><td>{moeda(m.recebido)}</td><td>{moeda(m.vencido)}</td></tr>)}</tbody>
    </table>
  </div>;
}
