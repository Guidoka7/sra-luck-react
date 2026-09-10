import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const CANAL_AGENDA_CLIENTES = "agenda-clientes";

type StatusCanal = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | string;

async function publicarAtualizacaoAgenda(payload: Record<string, unknown>) {
  const serviceClient = createServiceSupabaseClient();
  const canal = serviceClient.channel(CANAL_AGENDA_CLIENTES);
  try {
    await new Promise<void>((resolve) => {
      let finalizado = false;
      const finalizar = () => {
        if (finalizado) return;
        finalizado = true;
        resolve();
      };
      const timeout = setTimeout(finalizar, 3000);
      canal.subscribe(async (status: StatusCanal) => {
        if (status === "SUBSCRIBED") {
          try {
            await canal.send({
              type: "broadcast",
              event: "datas_atualizadas",
              payload,
            });
          } catch (erro) {
            console.error("Falha ao enviar atualização da agenda em tempo real:", erro);
          } finally {
            clearTimeout(timeout);
            finalizar();
          }
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          clearTimeout(timeout);
          finalizar();
        }
      });
    });
  } catch (erro) {
    console.error("Falha ao publicar atualização da agenda em tempo real:", erro);
  } finally {
    try {
      await serviceClient.removeChannel(canal);
    } catch {}
  }
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ano = Number(searchParams.get("ano"));
  const mes = Number(searchParams.get("mes"));
  const inicioMes = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximoMes = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;

  const { data: datas, error } = await supabase
    .from("datas")
    .select("*")
    .gte("data", inicioMes)
    .lt("data", proximoMes)
    .order("data", { ascending: true });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const { data: agendamentos } = await supabase
    .from("agendamentos")
    .select("data_id, valor_contrato, created_at, clientes(id, nome_completo, status_revisao_financeira)")
    .eq("status", "confirmado");

  type AgendamentoComCliente = {
    data_id: string;
    valor_contrato: number;
    created_at: string;
    clientes:
      | { id: string; nome_completo: string; status_revisao_financeira: string | null }
      | { id: string; nome_completo: string; status_revisao_financeira: string | null }[]
      | null;
  };

  const clientesPorData = new Map<string, { clienteId: string | null; nome: string; valor: number; criadoEm: string; statusRevisaoFinanceira: string | null }[]>();
  for (const a of (agendamentos ?? []) as AgendamentoComCliente[]) {
    const clienteInfo = Array.isArray(a.clientes) ? a.clientes[0] : a.clientes;
    const lista = clientesPorData.get(a.data_id) ?? [];
    lista.push({ clienteId: clienteInfo?.id ?? null, nome: clienteInfo?.nome_completo ?? "Cliente sem nome", valor: a.valor_contrato, criadoEm: a.created_at, statusRevisaoFinanceira: clienteInfo?.status_revisao_financeira ?? null });
    clientesPorData.set(a.data_id, lista);
  }

  const resultado = (datas ?? []).map((d) => {
    const clientes = clientesPorData.get(d.id) ?? [];
    return { ...d, vagasOcupadas: clientes.length, clientes };
  });

  return NextResponse.json({ datas: resultado });
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const body = await req.json();
  if (!body.data) return NextResponse.json({ erro: "Informe a data." }, { status: 400 });

  const { data, error } = await supabase
    .from("datas")
    .upsert({ data: body.data, vagas_totais: Number(body.vagasTotais) || 1, status: "disponivel" }, { onConflict: "data" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

  await supabase.from("logs_alteracoes").insert({ usuario: user.email ?? "admin", acao: "liberou_data", entidade: "datas", entidade_id: data.id, detalhes: { data: body.data, vagas: body.vagasTotais } });
  await publicarAtualizacaoAgenda({ acao: "liberada", data: data.data, dataId: data.id });

  return NextResponse.json({ data });
}
