import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * API para o calendário de liberação financeira.
 *
 * A previsão sugerida pelo sistema segue uma regra fixa:
 * 90 dias corridos após a data da assinatura dos termos.
 * O administrador continua podendo alterar manualmente a previsão.
 */

interface DiaAnalise {
  data: string;
  dia: number;
  estado: "verde" | "amarelo" | "vermelho" | "cinza" | "passado";
  vagasDisponiveis: boolean;
  oracamentoAntes: number;
  oracamentoDepois: number;
  ultrapassagem: number;
  dentroOrcamento: boolean;
  diasDisponibilizados: number;
  ocupante: { nome: string; valor: number } | null;
}

interface AlternativaData {
  data: string;
  dia: number;
  estado: "verde" | "amarelo";
  oracamentoDepois: number;
  ultrapassagem: number;
  motivo: string;
}

interface MelhorData {
  data: string;
  dia: number;
  mes: number;
  ano: number;
  oracamentoMes: number;
  comprometidoAntes: number;
  valorCliente: number;
  totalDepois: number;
  dentroOrcamento: boolean;
  motivo: string;
}

interface ClienteInfo {
  id: string;
  nome: string;
  valor: number;
  status: "apta" | "termos_assinados";
  dataTermos: string | null;
}

interface Calendario {
  ano: number;
  mes: number;
  dias: DiaAnalise[];
}

interface Resposta {
  cliente: ClienteInfo | null;
  erro?: string;
  orcamentoMensal: number;
  calendario: Calendario;
  melhorData: MelhorData | null;
  alternativas: {
    verdes: AlternativaData[];
    amarelas: AlternativaData[];
  };
}

function adicionarDias(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

function partesData(iso: string) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return { ano, mes, dia };
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const agendamentoId = searchParams.get("agendamento_id") || null;
  const ano = Number(searchParams.get("ano"));
  const mes = Number(searchParams.get("mes"));

  if (!ano || !mes) {
    return NextResponse.json(
      { erro: "Parâmetros obrigatórios: ano, mes" },
      { status: 400 }
    );
  }

  const hoje = new Date();
  const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

  // Cliente selecionada é opcional: o calendário-base existe independentemente dela.
  let clienteId: string | null = null;
  let cliente: ClienteInfo | null = null;

  if (agendamentoId) {
    const { data: agendamento, error: erroAgendamento } = await supabase
      .from("agendamentos")
      .select("cliente_id, valor_contrato, clientes(id, nome_completo, valor_contrato), datas(data)")
      .eq("id", agendamentoId)
      .eq("status", "confirmado")
      .single();

    if (erroAgendamento || !agendamento) {
      return NextResponse.json({ erro: "Agendamento não encontrado" }, { status: 404 });
    }

    clienteId = (agendamento as any).cliente_id;
    const dataTermos = (agendamento as any).datas?.data ?? null;
    // A assinatura só é considerada realizada quando chega o dia da assinatura.
    // Se a data futura já estiver cadastrada, a cliente continua como "apta" até lá.
    const termosJaAssinados = Boolean(dataTermos && dataTermos <= isoHoje);
    cliente = {
      id: clienteId!,
      nome: (agendamento as any).clientes?.nome_completo ?? "Cliente",
      valor: Number(agendamento.valor_contrato),
      status: termosJaAssinados ? "termos_assinados" : "apta",
      dataTermos,
    };
  }

  const { data: config } = await supabase
    .from("configuracoes")
    .select("meta_orcamento_mensal")
    .eq("id", 1)
    .single();

  const orcamentoMensal = Number(config?.meta_orcamento_mensal ?? 100000);
  const anoFimBusca = ano + 2;

  const { data: datasLiberadasTodas } = await supabase
    .from("datas_liberacao_financeira")
    .select("data")
    .eq("status", "disponivel")
    .gte("data", `${ano}-01-01`)
    .lte("data", `${anoFimBusca}-12-31`);
  const datasDisponibilizadas = new Set((datasLiberadasTodas ?? []).map((d) => d.data));

  const { data: liberacoesConfirmadas } = await supabase
    .from("agendamentos")
    .select("cliente_id, valor_contrato, previsao_liberacao_financeira, clientes(nome_completo)")
    .eq("status", "confirmado")
    .not("previsao_liberacao_financeira", "is", null)
    .gte("previsao_liberacao_financeira", `${ano}-01-01`)
    .lte("previsao_liberacao_financeira", `${anoFimBusca}-12-31`);

  const ocupadas = new Map<string, { nome: string; valor: number; clienteId: string }>();
  const oracamentoPorMes = new Map<string, number>();

  for (const item of liberacoesConfirmadas ?? []) {
    const dataOcupada = (item as any).previsao_liberacao_financeira as string | null;
    if (!dataOcupada) continue;

    ocupadas.set(dataOcupada, {
      nome: (item as any).clientes?.nome_completo ?? "Cliente",
      valor: Number(item.valor_contrato),
      clienteId: (item as any).cliente_id,
    });

    if (!clienteId || (item as any).cliente_id !== clienteId) {
      const chaveMes = dataOcupada.slice(0, 7);
      oracamentoPorMes.set(chaveMes, (oracamentoPorMes.get(chaveMes) ?? 0) + Number(item.valor_contrato));
    }
  }

  const valorCliente = cliente?.valor ?? 0;

  function analisarMes(anoM: number, mesM: number): DiaAnalise[] {
    const totalDias = new Date(anoM, mesM, 0).getDate();
    const mesStr = String(mesM).padStart(2, "0");
    const chaveMes = `${anoM}-${mesStr}`;
    const oracamentoDoMes = oracamentoPorMes.get(chaveMes) ?? 0;
    const dias: DiaAnalise[] = [];

    for (let dia = 1; dia <= totalDias; dia++) {
      const isoData = `${anoM}-${mesStr}-${String(dia).padStart(2, "0")}`;
      const ePassado = isoData < isoHoje;
      const ocupante = ocupadas.get(isoData);
      const estaDisponibilizada = datasDisponibilizadas.has(isoData);

      const base = {
        data: isoData,
        dia,
        oracamentoAntes: oracamentoDoMes,
        diasDisponibilizados: estaDisponibilizada ? 1 : 0,
      };

      if (ePassado) {
        dias.push({ ...base, estado: "passado", vagasDisponiveis: false, oracamentoDepois: oracamentoDoMes, ultrapassagem: 0, dentroOrcamento: true, ocupante: ocupante ? { nome: ocupante.nome, valor: ocupante.valor } : null });
        continue;
      }

      if (ocupante) {
        dias.push({ ...base, estado: "vermelho", vagasDisponiveis: false, oracamentoDepois: oracamentoDoMes, ultrapassagem: 0, dentroOrcamento: true, ocupante: { nome: ocupante.nome, valor: ocupante.valor } });
        continue;
      }

      if (!estaDisponibilizada) {
        dias.push({ ...base, estado: "cinza", vagasDisponiveis: false, oracamentoDepois: oracamentoDoMes, ultrapassagem: 0, dentroOrcamento: true, ocupante: null });
        continue;
      }

      if (!cliente) {
        dias.push({ ...base, estado: "verde", vagasDisponiveis: true, oracamentoDepois: oracamentoDoMes, ultrapassagem: 0, dentroOrcamento: true, ocupante: null });
        continue;
      }

      const novoTotal = oracamentoDoMes + valorCliente;
      const ultrapassagem = Math.max(0, novoTotal - orcamentoMensal);
      const dentroOrcamento = novoTotal <= orcamentoMensal;
      dias.push({ ...base, estado: dentroOrcamento ? "verde" : "amarelo", vagasDisponiveis: true, oracamentoDepois: novoTotal, ultrapassagem, dentroOrcamento, ocupante: null });
    }

    return dias;
  }

  const diasCalendario = analisarMes(ano, mes);

  // A sugestão do sistema NÃO é mais a primeira data verde.
  // Ela é obrigatoriamente 90 dias corridos após a assinatura dos termos.
  // A disponibilidade/orçamento continuam sendo exibidos no calendário, e o administrador
  // pode escolher outra data manualmente quando necessário.
  let melhorData: MelhorData | null = null;

  if (cliente?.dataTermos && cliente.dataTermos <= isoHoje) {
    const dataSugerida = adicionarDias(cliente.dataTermos, 90);
    const { ano: anoSugerido, mes: mesSugerido, dia: diaSugerido } = partesData(dataSugerida);
    const diasMesSugerido = anoSugerido === ano && mesSugerido === mes ? diasCalendario : analisarMes(anoSugerido, mesSugerido);
    const diaSugeridoAnalise = diasMesSugerido.find((d) => d.data === dataSugerida);
    const chaveMesSugerido = dataSugerida.slice(0, 7);
    const comprometidoAntes = diaSugeridoAnalise?.oracamentoAntes ?? (oracamentoPorMes.get(chaveMesSugerido) ?? 0);
    const totalDepois = comprometidoAntes + valorCliente;
    const dentroOrcamento = totalDepois <= orcamentoMensal;

    melhorData = {
      data: dataSugerida,
      dia: diaSugerido,
      mes: mesSugerido,
      ano: anoSugerido,
      oracamentoMes: orcamentoMensal,
      comprometidoAntes,
      valorCliente,
      totalDepois,
      dentroOrcamento,
      motivo: "Sugestão automática: 90 dias corridos após a assinatura dos termos.",
    };
  }

  const verdes: AlternativaData[] = [];
  const amarelas: AlternativaData[] = [];

  if (cliente) {
    for (const dia of diasCalendario) {
      if (dia.estado === "verde") {
        verdes.push({ data: dia.data, dia: dia.dia, estado: "verde", oracamentoDepois: dia.oracamentoDepois, ultrapassagem: 0, motivo: "Data disponível dentro do orçamento mensal" });
      } else if (dia.estado === "amarelo") {
        amarelas.push({ data: dia.data, dia: dia.dia, estado: "amarelo", oracamentoDepois: dia.oracamentoDepois, ultrapassagem: dia.ultrapassagem, motivo: `Ultrapassa o orçamento em ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(dia.ultrapassagem)}.` });
      }
    }
  }

  const resposta: Resposta = {
    cliente,
    orcamentoMensal,
    calendario: { ano, mes, dias: diasCalendario },
    melhorData,
    alternativas: { verdes: verdes.slice(0, 5), amarelas: amarelas.slice(0, 5) },
  };

  return NextResponse.json(resposta);
}
