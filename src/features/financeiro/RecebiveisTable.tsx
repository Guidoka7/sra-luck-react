import { Eye, FileCheck2 } from "lucide-react";
import { EmptyPanel, StatusPill } from "@/components/admin/ExecutiveUI";
import { formatarCpf } from "@/lib/cpf";
import { formatarMoeda } from "@/lib/utils";
import { RECEBIVEL_STATUS_META, type Recebivel } from "./types";

function dataBr(value: string | null) { return value ? value.split("-").reverse().join("/") : "—"; }

export function RecebiveisTable({ itens, carregando, validacao = false, onAbrir }: { itens: Recebivel[]; carregando: boolean; validacao?: boolean; onAbrir: (item: Recebivel) => void }) {
  if (carregando) return <div className="space-y-2">{Array.from({ length: validacao ? 4 : 6 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-blush/45 dark:bg-white/[0.04]" />)}</div>;
  if (!itens.length) return <EmptyPanel title={validacao ? "Nenhum comprovante aguardando validação" : "Nenhum recebível encontrado"} description={validacao ? "A fila está em dia para os dados disponíveis." : "Ajuste o período, o status ou a busca para consultar outros lançamentos."} />;

  return <div className="overflow-x-auto rounded-xl border border-rose/10 dark:border-white/8">
    <table className={`w-full border-collapse text-left ${validacao ? "min-w-[860px]" : "min-w-[1260px]"}`}>
      <thead className="bg-blush/55 text-[9px] font-bold uppercase tracking-[.13em] text-clay/48 dark:bg-white/[0.045] dark:text-white/42">
        {validacao ? <tr>
          <th className="px-3 py-2.5">Cliente / contrato</th><th className="px-3 py-2.5">Parcela</th><th className="px-3 py-2.5">Vencimento</th><th className="px-3 py-2.5 text-right">Valor</th><th className="px-3 py-2.5">Banco</th><th className="px-3 py-2.5">Comprovante</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Ação</th>
        </tr> : <tr>
          <th className="px-3 py-2.5">Cliente / contrato</th><th className="px-3 py-2.5">Parcela</th><th className="px-3 py-2.5">Vencimento</th><th className="px-3 py-2.5 text-right">Original</th><th className="px-3 py-2.5 text-right">Juros</th><th className="px-3 py-2.5 text-right">Multa</th><th className="px-3 py-2.5 text-right">Esperado / recebido</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Método</th><th className="px-3 py-2.5">Banco</th><th className="px-3 py-2.5">Pagamento</th><th className="px-3 py-2.5">Comprovante / ID</th><th className="sticky right-0 bg-blush/80 px-3 py-2.5 text-right dark:bg-[#201d22]">Ações</th>
        </tr>}
      </thead>
      <tbody className="divide-y divide-rose/8 bg-white/60 text-xs dark:divide-white/6 dark:bg-[#151317]/72">
        {itens.map((item) => { const status = RECEBIVEL_STATUS_META[item.status] ?? { label: item.status, tone: "neutral" as const }; return validacao ? <tr key={item.id} className="transition hover:bg-blush/30 dark:hover:bg-white/[0.025]">
          <td className="px-3 py-2.5"><p className="max-w-[190px] truncate font-semibold text-burgundy dark:text-cream">{item.cliente}</p><p className="mt-0.5 text-[10px] text-clay/42 dark:text-white/35">{item.cpf ? formatarCpf(item.cpf) : "CPF não informado"}</p></td>
          <td className="px-3 py-2.5 font-medium text-burgundy dark:text-cream">{item.numeroParcela}/{item.totalParcelas}</td>
          <td className="px-3 py-2.5 text-clay/65 dark:text-white/58">{dataBr(item.vencimento)}</td>
          <td className="px-3 py-2.5 text-right font-semibold text-burgundy dark:text-cream">{formatarMoeda(item.valorOriginal)}</td>
          <td className="px-3 py-2.5"><p className="text-clay/65 dark:text-white/58">{item.instituicaoConta ?? "Não informado"}</p><p className="text-[10px] text-clay/38 dark:text-white/32">{item.origem.replaceAll("_", " ")}</p></td>
          <td className="px-3 py-2.5"><span className={item.comprovante ? "font-medium text-success" : "text-clay/45"}>{item.comprovante ? "Anexado" : "Ausente"}</span></td>
          <td className="px-3 py-2.5"><StatusPill tone={status.tone}>{status.label}</StatusPill></td>
          <td className="px-3 py-2.5 text-right"><button type="button" onClick={() => onAbrir(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-burgundy px-2.5 py-2 text-[10px] font-bold uppercase tracking-[.1em] text-cream hover:bg-rose-dark">{<FileCheck2 className="h-3.5 w-3.5" />}Validar</button></td>
        </tr> : <tr key={item.id} className="transition hover:bg-blush/30 dark:hover:bg-white/[0.025]">
          <td className="px-3 py-2.5"><p className="max-w-[190px] truncate font-semibold text-burgundy dark:text-cream">{item.cliente}</p><p className="mt-0.5 text-[10px] text-clay/42 dark:text-white/35">{item.cpf ? formatarCpf(item.cpf) : "CPF não informado"}</p></td>
          <td className="px-3 py-2.5 font-medium text-burgundy dark:text-cream">{item.numeroParcela}/{item.totalParcelas}</td>
          <td className="px-3 py-2.5 text-clay/65 dark:text-white/58">{dataBr(item.vencimento)}</td>
          <td className="px-3 py-2.5 text-right">{formatarMoeda(item.valorOriginal)}</td>
          <td className="px-3 py-2.5 text-right">{formatarMoeda(item.juros)}</td>
          <td className="px-3 py-2.5 text-right">{formatarMoeda(item.multa)}</td>
          <td className="px-3 py-2.5 text-right"><p className="font-semibold text-burgundy dark:text-cream">{formatarMoeda(item.valorEsperado)}</p><p className="text-[10px] text-success">{item.valorRecebido === null ? "—" : formatarMoeda(item.valorRecebido)}</p></td>
          <td className="px-3 py-2.5"><StatusPill tone={status.tone}>{status.label}</StatusPill></td>
          <td className="px-3 py-2.5 capitalize text-clay/65 dark:text-white/58">{item.formaPagamento?.replaceAll("_", " ") ?? "—"}</td>
          <td className="px-3 py-2.5"><p className="text-clay/65 dark:text-white/58">{item.instituicaoConta ?? "Não informado"}</p><p className="max-w-[130px] truncate text-[10px] text-clay/38 dark:text-white/32">{item.origem.replaceAll("_", " ")}</p></td>
          <td className="px-3 py-2.5">{dataBr(item.dataPagamento)}</td>
          <td className="px-3 py-2.5"><p>{item.comprovante ? "Anexado" : "—"}</p><p className="max-w-[120px] truncate text-[10px] text-clay/38 dark:text-white/32">{item.externalId ?? "Sem ID externo"}</p></td>
          <td className="sticky right-0 bg-white/95 px-3 py-2.5 text-right dark:bg-[#171519]"><button type="button" onClick={() => onAbrir(item)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose/15 px-2.5 py-2 text-[10px] font-bold uppercase tracking-[.1em] text-burgundy hover:bg-blush dark:border-white/10 dark:text-cream dark:hover:bg-white/7"><Eye className="h-3.5 w-3.5" />Detalhes</button></td>
        </tr>; })}
      </tbody>
    </table>
  </div>;
}
