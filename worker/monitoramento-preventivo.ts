import { createServiceSupabaseClient, type Env } from "./supabase";
import { createLogger } from "./logger";

export async function executarMonitoramentoPreventivo(env: Env) {
  const db = createServiceSupabaseClient(env);
  const log = createLogger({ actorType: "system", action: "monitoring.preventive.run", route: "/__diagnostico__/preventivo", method: "INTERNAL" });
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
      if (result.error) {
        falhas.push({ nome, detalhe: "Falha no serviço" });
        log.error("Check preventivo retornou erro", { eventCode: "PREVENTIVE_CHECK_FAILED", check: nome, error: result.error });
      }
    } catch (error) {
      const detalhe = "Falha no serviço";
      falhas.push({ nome, detalhe });
      log.error("Check preventivo lançou exceção", { eventCode: "PREVENTIVE_CHECK_EXCEPTION", check: nome, error });
    }
  }
  if (falhas.length) {
    const { error } = await db.from("monitoramento_erros").insert(falhas.map((falha) => ({
      origem: "diagnostico", nivel: "error", codigo: "PREVENTIVE_CHECK_FAILED",
      mensagem: `Check preventivo falhou: ${falha.nome}`,
      rota: "/__diagnostico__/preventivo", metodo: "INTERNAL", detalhes: { check: falha.nome },
    })));
    if (error) log.fatal("Monitor preventivo não conseguiu persistir as próprias falhas", { eventCode: "PREVENTIVE_PERSIST_FAILED", error });
  } else {
    log.info("Monitor preventivo concluído sem falhas", { eventCode: "PREVENTIVE_CHECK_OK", checks: checks.length });
  }
  return { ok: falhas.length === 0, falhas };
}
