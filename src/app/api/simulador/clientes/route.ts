import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Lista enxuta de clientes (id + nome) só pra alimentar o seletor "Cliente
// de teste" do simulador de iPhone — não expõe CPF, telefone nem outros
// dados sensíveis. Protegida do mesmo jeito que o resto do painel: exige a
// sessão do admin (o simulador roda no mesmo navegador em que o admin já
// está logado, então o cookie vai junto na requisição).
export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome_completo")
    .eq("ativo", true)
    .order("nome_completo", { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({
    clientes: (data ?? []).map((c) => ({ id: c.id, nome: c.nome_completo })),
  });
}
