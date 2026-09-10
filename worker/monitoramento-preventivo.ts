import { createServiceSupabaseClient, type Env } from "./supabase";

export async function executarMonitoramentoPreventivo(env: Env) {
  const db = createServiceSupabaseClient(env);
  const checks = [
    ["clientes", () => db.from("clientes").select("id", { count: "exact", head: true })],
    ["boletos", () => db.from("boletos").select("id", { count: "exact", head: true })],
    ["agendamentos", () => db.from("agendamentos").select("id", { count: "exact", head: true })],
    ["datas", () => db.from("datas").select("id", { count: "exact", head: true })],
    ["datas_liberacao_financeira", () => db.from("datas_liberacao_financeira").select("id", { count: "exact", head: true })],
    ["monitoramento_erros", () => db.from("monitoramento_erros").select("id", { count: "exact", head: true })],
  ] as const;
  const falhas: Array<{ nome: string; detalhe: string }> = [];
  for (const [nome, fn] of checks) {
    try {
      const result = await fn();
      if (result.error) falhas.push({ nome, detalhe: result.error.message });
    } catch (error) {
      falhas.push({ nome, detalhe: error instanceof Error ? error.message : "Falha desconhecida" });
    }
  }
  if (falhas.length) {
    await db.from("monitoramento_erros").insert(falhas.map((falha) => ({
      origem: "diagnostico", nivel: "critical", codigo: "PREVENTIVE_CHECK_FAILED",
      mensagem: `Check preventivo falhou: ${falha.nome}: ${falha.detalhe}`,
      rota: "/__diagnostico__/preventivo", metodo: "INTERNAL", detalhes: { check: falha.nome },
    })));
  }
  return { ok: falhas.length === 0, falhas };
}
