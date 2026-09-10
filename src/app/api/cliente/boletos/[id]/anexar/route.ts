import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

const TIPOS_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png"] as const;
const TAMANHO_MAXIMO = 5 * 1024 * 1024;
const BUCKET = "boletos-clientes";

function detectarTipoArquivo(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  return null;
}

function extensaoPorTipo(tipo: "application/pdf" | "image/jpeg" | "image/png") {
  return tipo === "application/pdf" ? "pdf" : tipo === "image/jpeg" ? "jpg" : "png";
}

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
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) return NextResponse.json({ erro: "Arquivo não fornecido." }, { status: 400 });
  if (!TIPOS_PERMITIDOS.includes(arquivo.type as (typeof TIPOS_PERMITIDOS)[number])) return NextResponse.json({ erro: "Tipo de arquivo não permitido. Use PDF, JPG ou PNG." }, { status: 400 });
  if (arquivo.size === 0 || arquivo.size > TAMANHO_MAXIMO) return NextResponse.json({ erro: "O arquivo deve ter até 5MB e não pode estar vazio." }, { status: 400 });

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipoDetectado = detectarTipoArquivo(bytes);
  if (!tipoDetectado || tipoDetectado !== arquivo.type) {
    return NextResponse.json({ erro: "O conteúdo do arquivo não corresponde ao tipo informado. Envie um PDF, JPG ou PNG válido." }, { status: 400 });
  }

  const extensao = extensaoPorTipo(tipoDetectado);
  const caminho = `${sessao.clienteId}/${boletoId}/${Date.now()}.${extensao}`;
  const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: tipoDetectado, upsert: false });
  if (erroUpload) { console.error("Erro upload comprovante:", erroUpload); return NextResponse.json({ erro: "Erro ao enviar o arquivo." }, { status: 500 }); }

  const { error: erroUpdate } = await supabase.from("boletos").update({ status: "pendente_confirmacao", comprovante_url: caminho, data_pagamento: null, observacoes: null }).eq("id", boletoId);
  if (erroUpdate) {
    await supabase.storage.from(BUCKET).remove([caminho]);
    return NextResponse.json({ erro: "Erro ao salvar o comprovante." }, { status: 500 });
  }

  if (boleto.comprovante_url && boleto.comprovante_url !== caminho) {
    await supabase.storage.from(BUCKET).remove([boleto.comprovante_url]);
  }

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
