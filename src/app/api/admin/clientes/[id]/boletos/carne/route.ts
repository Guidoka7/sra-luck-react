import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const BUCKET = "boletos-clientes";
const TAMANHO_MAXIMO = 20 * 1024 * 1024; // 20MB para o carnê completo

/**
 * Recebe um único PDF com o carnê completo do banco (uma página por parcela,
 * em ordem) e corta cada página, associando-a à parcela correspondente da
 * cliente (página 1 -> numero_parcela 1, página 2 -> numero_parcela 2, ...).
 *
 * As parcelas precisam já existir (geradas via POST /boletos antes disso).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabaseAuth = createServerSupabaseClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const clienteId = params.id;
  const supabase = createServiceSupabaseClient();

  const { data: cliente } = await supabase
    .from("clientes")
    .select("id, nome_completo")
    .eq("id", clienteId)
    .single();
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });

  const { data: boletos, error: erroBoletos } = await supabase
    .from("boletos")
    .select("id, numero_parcela")
    .eq("cliente_id", clienteId)
    .order("numero_parcela", { ascending: true });

  if (erroBoletos) return NextResponse.json({ erro: erroBoletos.message }, { status: 500 });
  if (!boletos || boletos.length === 0) {
    return NextResponse.json(
      { erro: "Essa cliente ainda não tem parcelas geradas. Gere as parcelas antes de anexar o carnê." },
      { status: 400 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const arquivo = formData.get("arquivo") as File | null;
  if (!arquivo) return NextResponse.json({ erro: "Arquivo não fornecido." }, { status: 400 });
  if (arquivo.type !== "application/pdf") {
    return NextResponse.json({ erro: "O carnê precisa ser um arquivo PDF." }, { status: 400 });
  }
  if (arquivo.size > TAMANHO_MAXIMO) {
    return NextResponse.json({ erro: "Arquivo maior que 20MB." }, { status: 400 });
  }

  const bytes = await arquivo.arrayBuffer();
  let carne: PDFDocument;
  try {
    carne = await PDFDocument.load(bytes);
  } catch {
    return NextResponse.json({ erro: "Não foi possível ler o PDF. O arquivo pode estar corrompido." }, { status: 400 });
  }

  const totalPaginas = carne.getPageCount();
  if (totalPaginas !== boletos.length) {
    return NextResponse.json(
      {
        erro: `O carnê tem ${totalPaginas} página(s), mas a cliente tem ${boletos.length} parcela(s). ` +
          "O número de páginas precisa ser igual ao número de parcelas, uma página por boleto.",
      },
      { status: 400 }
    );
  }

  // Corta cada página em um PDF individual e sobe pro Storage, na ordem.
  const atualizacoes: { id: string; numero_parcela: number; caminho: string }[] = [];
  for (let i = 0; i < totalPaginas; i++) {
    const paginaDoc = await PDFDocument.create();
    const [pagina] = await paginaDoc.copyPages(carne, [i]);
    paginaDoc.addPage(pagina);
    const paginaBytes = await paginaDoc.save();

    const boleto = boletos[i];
    const caminho = `${clienteId}/${boleto.id}/boleto-${Date.now()}.pdf`;

    const { error: erroUpload } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, paginaBytes, { contentType: "application/pdf", upsert: true });

    if (erroUpload) {
      console.error("Erro upload página do carnê:", erroUpload);
      return NextResponse.json(
        { erro: `Erro ao enviar a página ${i + 1} (parcela ${boleto.numero_parcela}). Nada foi salvo — tente novamente.` },
        { status: 500 }
      );
    }

    atualizacoes.push({ id: boleto.id, numero_parcela: boleto.numero_parcela, caminho });
  }

  // Só depois de subir tudo com sucesso, associa cada caminho à sua parcela.
  for (const item of atualizacoes) {
    const { error: erroUpdate } = await supabase
      .from("boletos")
      .update({ boleto_url: item.caminho })
      .eq("id", item.id);

    if (erroUpdate) {
      return NextResponse.json(
        { erro: `Arquivos enviados, mas houve erro ao salvar a referência da parcela ${item.numero_parcela}. Tente novamente ou fale com o suporte.` },
        { status: 500 }
      );
    }
  }

  await supabase.from("logs_alteracoes").insert({
    usuario: user.email ?? "admin",
    acao: "anexou_carne",
    entidade: "clientes",
    entidade_id: clienteId,
    detalhes: { cliente: cliente.nome_completo, paginas: totalPaginas },
  });

  return NextResponse.json({ sucesso: true, parcelas_atualizadas: atualizacoes.length });
}
