import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

const TIPOS_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANHO_MAXIMO = 5 * 1024 * 1024;
const BUCKET = "boletos-clientes";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const boletoId = params.id;
  const supabase = createServiceSupabaseClient();
  const { data: boleto } = await supabase.from("boletos").select("id, cliente_id, numero_parcela, status, comprovante_url").eq("id", boletoId).single();
  if (!boleto || boleto.cliente_id !== sessao.clienteId) return NextResponse.json({ erro: "Boleto não encontrado." }, { status: 404 });

  const { data: clienteAntes } = await supabase.from("clientes").select("status_revisao_financeira").eq("id", sessao.clienteId).single();

  let formData: FormData;
  try { formData = await req.formData(); } catch { return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 }); }
  const arquivo = formData.get("arquivo") as File | null;
  if (!arquivo) return NextResponse.json({ erro: "Arquivo não fornecido." }, { status: 400 });
  if (!TIPOS_PERMITIDOS.includes(arquivo.type)) return NextResponse.json({ erro: "Tipo de arquivo não permitido. Use PDF, JPG ou PNG." }, { status: 400 });
  if (arquivo.size > TAMANHO_MAXIMO) return NextResponse.json({ erro: "Arquivo maior que 5MB." }, { status: 400 });

  const extensao = arquivo.name.split(".").pop() || "pdf";
  const caminho = `${sessao.clienteId}/${boletoId}/${Date.now()}.${extensao}`;
  const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (erroUpload) { console.error("Erro upload comprovante:", erroUpload); return NextResponse.json({ erro: "Erro ao enviar o arquivo." }, { status: 500 }); }

  // O envio do comprovante NÃO confirma o pagamento.
  // Ele fica pendente até a administração analisar e confirmar ou rejeitar.
  const { error: erroUpdate } = await supabase.from("boletos").update({ status: "pendente_confirmacao", comprovante_url: caminho, data_pagamento: null, observacoes: null }).eq("id", boletoId);
  if (erroUpdate) {
    await supabase.storage.from(BUCKET).remove([caminho]);
    return NextResponse.json({ erro: "Erro ao salvar o comprovante." }, { status: 500 });
  }

  if (boleto.comprovante_url && boleto.comprovante_url !== caminho) {
    await supabase.storage.from(BUCKET).remove([boleto.comprovante_url]);
  }

  // Se a revisão anterior foi recusada, o novo comprovante precisa passar
  // novamente pelo levantamento antes que a agenda de termos seja liberada.
  if (clienteAntes?.status_revisao_financeira === "recusada") {
    const { data: podeAgendar } = await supabase.rpc("pode_agendar", { p_cliente_id: sessao.clienteId });
    if (Boolean(podeAgendar)) {
      await supabase.from("clientes").update({
        status_revisao_financeira: "pendente",
        data_atingiu_percentual: new Date().toISOString(),
        observacao_revisao_financeira: null,
      }).eq("id", sessao.clienteId);
    }
  }

  return NextResponse.json({ sucesso: true, boleto_id: boletoId, status: "pendente_confirmacao" });
}
