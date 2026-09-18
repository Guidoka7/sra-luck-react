import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo } from "./admin-auth";
import { ADMIN_COOKIE_NAME, getCookie, verificarTokenAdmin, type AdminSessionPayload } from "./session";

type Db = ReturnType<typeof createServiceSupabaseClient>;
type Json = Record<string, any>;

const TERM_TIMES = ["09:00","09:30","10:00","10:30","11:00","11:30","14:00","14:30","15:00","15:30","16:00","16:30"];
const SURGERY_TIMES = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","14:00","14:30","15:00","15:30","16:00"];
const MONTHLY_CAP = 100000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function body(request: Request): Promise<Json> {
  try { return await request.json(); } catch { return {}; }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

function isoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function monthKey(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return /^\d{4}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 7);
}

function monthBounds(month: string) {
  const parts = month.split("-").map(Number);
  const year = parts[0];
  const rawMonth = parts[1];
  const next = rawMonth === 12 ? String(year + 1) + "-01-01" : String(year) + "-" + String(rawMonth + 1).padStart(2, "0") + "-01";
  return { start: month + "-01", end: next };
}

function addDays(iso: string, days: number) {
  const parts = iso.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.toISOString().slice(0, 10);
}

function addMonths(month: string, delta: number) {
  const parts = month.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
  return String(date.getUTCFullYear()) + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function authContext(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const token = getCookie(request, ADMIN_COOKIE_NAME);
  const session: AdminSessionPayload | null = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  if (!session) return null;
  const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env);
  if (!colaborador) return null;
  return {
    authUserId: session.adminId,
    collaboratorId: colaborador.id,
    actor: "admin:" + session.adminId,
  };
}

type ClientRow = {
  id: string;
  nome_completo: string | null;
  cpf: string | null;
  valor_contrato: number | string | null;
  status_revisao_financeira: string | null;
  data_atingiu_percentual: string | null;
  financeiro_saldo_restante: number | string | null;
  financeiro_formas_custeio: string[] | null;
  financeiro_confirmado_em: string | null;
  financeiro_valor_total_calculado: number | string | null;
  financeiro_saldo_calculado: number | string | null;
  custeio_confirmado_em: string | null;
  status_financeiro: string | null;
  status_cirurgia: string | null;
};

type Appointment = {
  id: string;
  cliente_id: string;
  data_id: string;
  status: "confirmado" | "cancelado" | "realizado";
  horario_termos: string | null;
  termos_assinados_em: string | null;
  comparecimento_status: string | null;
  comparecimento_em: string | null;
  previsao_cirurgia: string | null;
  previsao_cirurgia_confirmada_em: string | null;
  quitacao_status: string | null;
  quitacao_em: string | null;
  quitacao_metodo: string | null;
  agenda_cirurgica_liberada_em: string | null;
  data_cirurgia: string | null;
  horario_cirurgia: string | null;
  cirurgia_escolhida_em: string | null;
  created_at: string;
  updated_at: string;
  datas?: { data?: string | null } | Array<{ data?: string | null }> | null;
};

type Choice = {
  id: string;
  cliente_id: string;
  agendamento_id: string | null;
  forma_custeio: string;
  saldo_restante: number | string;
  status: string;
  created_at: string;
  updated_at: string;
};

async function base(db: Db) {
  const [clientsRes, billsRes, appointmentsRes, choicesRes] = await Promise.all([
    db.from("clientes").select("id,nome_completo,cpf,valor_contrato,status_revisao_financeira,data_atingiu_percentual,financeiro_saldo_restante,financeiro_formas_custeio,financeiro_confirmado_em,financeiro_valor_total_calculado,financeiro_saldo_calculado,custeio_confirmado_em,status_financeiro,status_cirurgia").eq("ativo", true),
    db.from("boletos").select("id,cliente_id,numero_parcela,total_parcelas,valor,status,data_vencimento,suspensa").order("numero_parcela", { ascending: true }),
    db.from("agendamentos").select("id,cliente_id,data_id,status,horario_termos,termos_assinados_em,comparecimento_status,comparecimento_em,previsao_cirurgia,previsao_cirurgia_confirmada_em,quitacao_status,quitacao_em,quitacao_metodo,agenda_cirurgica_liberada_em,data_cirurgia,horario_cirurgia,cirurgia_escolhida_em,created_at,updated_at,datas(data)").order("created_at", { ascending: false }),
    db.from("solicitacoes_liberacao_financeira").select("id,cliente_id,agendamento_id,forma_custeio,saldo_restante,status,created_at,updated_at").order("created_at", { ascending: false }),
  ]);
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  if (billsRes.error) throw new Error(billsRes.error.message);
  if (appointmentsRes.error) throw new Error(appointmentsRes.error.message);
  if (choicesRes.error) throw new Error(choicesRes.error.message);

  const clients = (clientsRes.data ?? []) as unknown as ClientRow[];
  const bills = billsRes.data ?? [];
  const appointments = (appointmentsRes.data ?? []) as unknown as Appointment[];
  const choices = (choicesRes.data ?? []) as unknown as Choice[];

  const billsByClient = new Map<string, any[]>();
  for (const item of bills as any[]) {
    const list = billsByClient.get(item.cliente_id) ?? [];
    list.push(item);
    billsByClient.set(item.cliente_id, list);
  }

  const appointmentsByClient = new Map<string, Appointment[]>();
  for (const item of appointments) {
    const list = appointmentsByClient.get(item.cliente_id) ?? [];
    list.push(item);
    appointmentsByClient.set(item.cliente_id, list);
  }

  const choiceByClient = new Map<string, Choice>();
  for (const item of choices) if (!choiceByClient.has(item.cliente_id)) choiceByClient.set(item.cliente_id, item);

  return { clients, billsByClient, appointments, appointmentsByClient, choices, choiceByClient };
}

function termsDate(appointment: Appointment | null) {
  if (!appointment) return null;
  const d = relation<any>(appointment.datas);
  return d?.data ?? null;
}

function financialSummary(clientId: string, billsByClient: Map<string, any[]>) {
  const bills = billsByClient.get(clientId) ?? [];
  const paid = bills.filter((item) => item.status === "pago");
  const total = bills.reduce((sum, item) => sum + number(item.valor), 0);
  const open = bills.filter((item) => item.status !== "pago").reduce((sum, item) => sum + number(item.valor), 0);
  const paidCount = paid.length;
  const totalCount = bills.length;
  const percentage = totalCount ? Math.round((paidCount / totalCount) * 1000) / 10 : 0;
  return { total, open, paidCount, totalCount, percentage, eligible: totalCount > 0 && percentage >= 70 };
}

function latestCurrentAppointment(items: Appointment[]) {
  return items.find((item) => item.status === "confirmado" || item.status === "realizado") ?? null;
}

function latestCanceledAppointment(items: Appointment[]) {
  return items.find((item) => item.status === "cancelado") ?? null;
}

function stageFor(client: ClientRow, summary: ReturnType<typeof financialSummary>, choice: Choice | null, appointment: Appointment | null) {
  if (appointment?.data_cirurgia && appointment?.horario_cirurgia) return "cirurgia_agendada";
  if (appointment?.agenda_cirurgica_liberada_em) return "agenda_cirurgica_liberada";
  if (appointment && appointment.status !== "cancelado") return "termos_confirmados";
  if (choice && choice.status !== "recusada") return "etapa_4";
  if (client.status_revisao_financeira === "aprovada") return "etapa_3";
  if (summary.eligible) return "levantamento";
  return "formacao_saldo";
}

function publicClient(client: ClientRow, summary: ReturnType<typeof financialSummary>, choice: Choice | null, appointment: Appointment | null) {
  return {
    clientId: client.id,
    name: client.nome_completo ?? "Cliente",
    cpf: client.cpf,
    creditLetter: number(client.valor_contrato),
    paidInstallments: summary.paidCount,
    totalInstallments: summary.totalCount,
    paidPercentage: summary.percentage,
    planTotal: summary.total,
    calculatedBalance: summary.open,
    settlementBalance: client.financeiro_saldo_restante == null ? summary.open : number(client.financeiro_saldo_restante),
    reviewStatus: client.status_revisao_financeira,
    reviewConfirmedAt: client.financeiro_confirmado_em,
    allowedMethods: Array.isArray(client.financeiro_formas_custeio) ? client.financeiro_formas_custeio : [],
    paymentChoice: choice?.forma_custeio ?? null,
    paymentChoiceStatus: choice?.status ?? null,
    stage: stageFor(client, summary, choice, appointment),
  };
}

async function calendarTerms(db: Db, month: string) {
  const bounds = monthBounds(month);
  const [daysRes, bookedRes] = await Promise.all([
    db.from("datas").select("id,data,vagas_totais,status,fechamento_manual").gte("data", bounds.start).lt("data", bounds.end).order("data"),
    db.from("agendamentos").select("id,data_id,status,cliente_id,horario_termos").in("status", ["confirmado","realizado"]),
  ]);
  if (daysRes.error) throw new Error(daysRes.error.message);
  if (bookedRes.error) throw new Error(bookedRes.error.message);
  const count = new Map<string, number>();
  for (const item of bookedRes.data ?? []) count.set(item.data_id, (count.get(item.data_id) ?? 0) + 1);
  return (daysRes.data ?? []).map((day: any) => {
    const used = count.get(day.id) ?? 0;
    const total = Number(day.vagas_totais ?? 0);
    const manualClosed = Boolean(day.fechamento_manual) || day.status === "bloqueado";
    const state = manualClosed ? "closed" : total <= 0 ? "neutral" : used >= total ? "full" : "available";
    return { id: day.id, date: day.data, total, used, remaining: Math.max(0, total - used), manualClosed, state };
  });
}

async function calendarSurgery(db: Db, month: string) {
  const bounds = monthBounds(month);
  const [daysRes, bookedRes] = await Promise.all([
    db.from("datas_liberacao_financeira").select("id,data,vagas_totais,status,fechamento_manual").gte("data", bounds.start).lt("data", bounds.end).order("data"),
    db.from("agendamentos").select("id,data_cirurgia,horario_cirurgia,status,cliente_id").in("status", ["confirmado","realizado"]).gte("data_cirurgia", bounds.start).lt("data_cirurgia", bounds.end),
  ]);
  if (daysRes.error) throw new Error(daysRes.error.message);
  if (bookedRes.error) throw new Error(bookedRes.error.message);
  const count = new Map<string, number>();
  for (const item of bookedRes.data ?? []) if (item.data_cirurgia) count.set(item.data_cirurgia, (count.get(item.data_cirurgia) ?? 0) + 1);
  return (daysRes.data ?? []).map((day: any) => {
    const used = count.get(day.data) ?? 0;
    const total = Number(day.vagas_totais ?? 0);
    const manualClosed = Boolean(day.fechamento_manual) || day.status === "bloqueado";
    const state = manualClosed ? "closed" : total <= 0 ? "neutral" : used >= total ? "full" : "available";
    return { id: day.id, date: day.data, total, used, remaining: Math.max(0, total - used), manualClosed, state };
  });
}

async function monthPlanner(db: Db, excludeClientId: string | null) {
  const current = new Date().toISOString().slice(0, 7);
  const months = [];
  for (let index = 0; index < 6; index += 1) {
    const month = addMonths(current, index);
    const { data, error } = await db.rpc("agenda_comprometimento_mes", {
      p_mes: month + "-01",
      p_excluir_cliente: excludeClientId,
    });
    if (error) throw new Error(error.message);
    months.push({ month, current: number(data), cap: MONTHLY_CAP });
  }
  return months;
}

function plannerWithClient(months: Array<{month:string;current:number;cap:number}>, creditLetter: number) {
  return months.map((item) => {
    const projected = item.current + creditLetter;
    const percent = item.cap > 0 ? projected / item.cap * 100 : 0;
    const classification = projected > item.cap ? "over" : percent >= 80 ? "attention" : "safe";
    return {
      ...item,
      creditLetter,
      projected,
      percent: Math.round(percent * 10) / 10,
      remaining: Math.max(0, item.cap - projected),
      classification,
    };
  });
}

async function termsPayload(db: Db, month: string) {
  const all = await base(db);
  const calendar = await calendarTerms(db, month);
  const eligible: any[] = [];
  const confirmed: any[] = [];

  for (const client of all.clients) {
    const summary = financialSummary(client.id, all.billsByClient);
    const choice = all.choiceByClient.get(client.id) ?? null;
    const appointments = all.appointmentsByClient.get(client.id) ?? [];
    const appointment = latestCurrentAppointment(appointments);

    if (summary.eligible && !appointment) {
      const qualifiedMonth = String(client.data_atingiu_percentual ?? "").slice(0, 7);
      const canceled = latestCanceledAppointment(appointments);
      const returnToStage4 = Boolean(choice && canceled);
      if (qualifiedMonth === month || returnToStage4 || (!qualifiedMonth && month === new Date().toISOString().slice(0,7))) {
        eligible.push({
          ...publicClient(client, summary, choice, null),
          becameEligibleAt: client.data_atingiu_percentual,
          returnedToStage4: returnToStage4,
        });
      }
    }

    if (appointment && appointment.status === "confirmado" && choice && choice.status !== "recusada") {
      const date = termsDate(appointment);
      if (date?.slice(0,7) === month) {
        confirmed.push({
          ...publicClient(client, summary, choice, appointment),
          appointmentId: appointment.id,
          date,
          time: appointment.horario_termos ? String(appointment.horario_termos).slice(0,5) : null,
          attendanceStatus: appointment.comparecimento_status,
        });
      }
    }
  }

  return {
    month,
    minimumPaidPercentage: 70,
    times: TERM_TIMES,
    calendar,
    eligible,
    confirmed,
  };
}

async function releaseQueue(db: Db) {
  const all = await base(db);
  const rows: any[] = [];
  for (const client of all.clients) {
    const summary = financialSummary(client.id, all.billsByClient);
    const choice = all.choiceByClient.get(client.id) ?? null;
    const appointment = latestCurrentAppointment(all.appointmentsByClient.get(client.id) ?? []);
    if (!choice || choice.status === "recusada" || !appointment || appointment.data_cirurgia) continue;
    const date = termsDate(appointment);
    if (!date || !appointment.horario_termos) continue;

    rows.push({
      ...publicClient(client, summary, choice, appointment),
      appointmentId: appointment.id,
      termsDate: date,
      termsTime: String(appointment.horario_termos).slice(0,5),
      forecastDate: appointment.previsao_cirurgia,
      forecastConfirmedAt: appointment.previsao_cirurgia_confirmada_em,
      attendanceStatus: appointment.comparecimento_status ?? "pendente",
      attendanceAt: appointment.comparecimento_em,
      settlementStatus: appointment.quitacao_status ?? "pendente",
      settlementAt: appointment.quitacao_em,
      surgeryAgendaReleasedAt: appointment.agenda_cirurgica_liberada_em,
    });
  }
  rows.sort((a,b) => (a.termsDate + " " + a.termsTime).localeCompare(b.termsDate + " " + b.termsTime));
  return { rows };
}

function rowsForAllSurgeryMonth(
  clients: ClientRow[],
  appointmentsByClient: Map<string,Appointment[]>,
  choiceByClient: Map<string,Choice>,
  month: string,
) {
  const clientById = new Map(clients.map((item) => [item.id,item]));
  let sum = 0;
  for (const [clientId, appointments] of appointmentsByClient) {
    const client = clientById.get(clientId);
    const choice = choiceByClient.get(clientId) ?? null;
    const appointment = latestCurrentAppointment(appointments);
    if (!client || client.status_revisao_financeira !== "aprovada") continue;
    if (!choice || choice.status === "recusada") continue;
    if (!appointment?.data_cirurgia || appointment.data_cirurgia.slice(0,7) !== month) continue;
    if (
      !appointment.horario_cirurgia
      || !appointment.cirurgia_escolhida_em
      || !appointment.termos_assinados_em
      || !appointment.previsao_cirurgia_confirmada_em
      || !appointment.agenda_cirurgica_liberada_em
      || appointment.quitacao_status !== "paga"
      || appointment.comparecimento_status !== "compareceu"
    ) continue;
    sum += number(client.valor_contrato);
  }
  return Math.round(sum * 100) / 100;
}

async function surgeriesPayload(db: Db, month: string) {
  const all = await base(db);
  const calendar = await calendarSurgery(db, month);
  const rows: any[] = [];
  for (const client of all.clients) {
    const summary = financialSummary(client.id, all.billsByClient);
    const choice = all.choiceByClient.get(client.id) ?? null;
    const appointment = latestCurrentAppointment(all.appointmentsByClient.get(client.id) ?? []);
    if (!appointment?.data_cirurgia || appointment.data_cirurgia.slice(0,7) !== month) continue;
    if (!choice || choice.status === "recusada") continue;
    if (
      client.status_revisao_financeira !== "aprovada"
      || !appointment.termos_assinados_em
      || appointment.comparecimento_status !== "compareceu"
      || appointment.quitacao_status !== "paga"
      || !appointment.previsao_cirurgia_confirmada_em
      || !appointment.agenda_cirurgica_liberada_em
      || !appointment.cirurgia_escolhida_em
      || !appointment.horario_cirurgia
    ) continue;

    rows.push({
      ...publicClient(client, summary, choice, appointment),
      appointmentId: appointment.id,
      date: appointment.data_cirurgia,
      time: String(appointment.horario_cirurgia).slice(0,5),
      status: client.status_cirurgia === "realizada" ? "Realizada" : "Cirurgia agendada",
    });
  }
  rows.sort((a,b) => (a.date + " " + a.time).localeCompare(b.date + " " + b.time));

  const year = Number(month.split("-")[0]);
  const chart = [];
  for (let m = 1; m <= 12; m += 1) {
    const key = String(year) + "-" + String(m).padStart(2,"0");
    const value = rowsForAllSurgeryMonth(all.clients, all.appointmentsByClient, all.choiceByClient, key);
    chart.push({ month: key, value, cap: MONTHLY_CAP, percent: Math.round((value / MONTHLY_CAP) * 1000) / 10 });
  }

  return { month, calendar, rows, chart, monthlyCap: MONTHLY_CAP, times: SURGERY_TIMES };
}

async function agendaFlow(db: Db, clientId: string) {
  const all = await base(db);
  const client = all.clients.find((item) => item.id === clientId);
  if (!client) return null;
  const summary = financialSummary(client.id, all.billsByClient);
  const choice = all.choiceByClient.get(client.id) ?? null;
  const appointment = latestCurrentAppointment(all.appointmentsByClient.get(client.id) ?? []);
  const canceled = latestCanceledAppointment(all.appointmentsByClient.get(client.id) ?? []);
  const date = termsDate(appointment);
  const planner = plannerWithClient(await monthPlanner(db, client.id), number(client.valor_contrato));
  const suggested = date ? addDays(date, 90) : null;

  return {
    client: publicClient(client, summary, choice, appointment),
    appointment: appointment ? {
      id: appointment.id,
      status: appointment.status,
      termsDate: date,
      termsTime: appointment.horario_termos ? String(appointment.horario_termos).slice(0,5) : null,
      termsSignedAt: appointment.termos_assinados_em,
      attendanceStatus: appointment.comparecimento_status ?? "pendente",
      attendanceAt: appointment.comparecimento_em,
      forecastDate: appointment.previsao_cirurgia,
      forecastConfirmedAt: appointment.previsao_cirurgia_confirmada_em,
      forecastSuggestedDate: suggested,
      settlementStatus: appointment.quitacao_status ?? "pendente",
      settlementAt: appointment.quitacao_em,
      settlementMethod: appointment.quitacao_metodo ?? choice?.forma_custeio ?? null,
      surgeryAgendaReleasedAt: appointment.agenda_cirurgica_liberada_em,
      surgeryDate: appointment.data_cirurgia,
      surgeryTime: appointment.horario_cirurgia ? String(appointment.horario_cirurgia).slice(0,5) : null,
      surgeryChosenAt: appointment.cirurgia_escolhida_em,
    } : null,
    previousCanceledAppointment: canceled ? {
      id: canceled.id,
      termsDate: termsDate(canceled),
      termsTime: canceled.horario_termos ? String(canceled.horario_termos).slice(0,5) : null,
      attendanceStatus: canceled.comparecimento_status,
      settlementStatus: canceled.quitacao_status,
      canceledAt: canceled.updated_at,
    } : null,
    planner,
    monthlyCap: MONTHLY_CAP,
  };
}

async function setTermsCapacity(db: Db, date: string, payload: Json) {
  const action = String(payload.action ?? "open");
  const parsedTotal = Number(payload.total ?? payload.vagasTotais ?? 0);
  const total = Math.max(0, Math.min(99, Math.floor(Number.isFinite(parsedTotal) ? parsedTotal : 0)));
  const { data: existing } = await db.from("datas").select("id,data,vagas_totais,status,fechamento_manual").eq("data", date).maybeSingle();
  const countRes = existing
    ? await db.from("agendamentos").select("id", { count: "exact", head: true }).eq("data_id", existing.id).in("status", ["confirmado","realizado"])
    : { count: 0 };
  const used = countRes.count ?? 0;
  if (total < used && action !== "close") return { error: "O total não pode ser menor que " + used + " vaga(s) já ocupada(s).", status: 409 };

  if (!existing) {
    const { data, error } = await db.from("datas").insert({
      data: date,
      vagas_totais: action === "close" ? total : Math.max(total,1),
      status: action === "close" ? "bloqueado" : "disponivel",
      fechamento_manual: action === "close",
    }).select("*").single();
    if (error) return { error: error.message, status: 400 };
    return { data };
  }

  const patch: Json = {};
  if (action === "close") { patch.status = "bloqueado"; patch.fechamento_manual = true; }
  else {
    patch.status = "disponivel";
    patch.fechamento_manual = false;
    patch.vagas_totais = Math.max(total,used);
  }
  const { data, error } = await db.from("datas").update(patch).eq("id", existing.id).select("*").single();
  if (error) return { error: error.message, status: 400 };
  return { data };
}

async function setSurgeryCapacity(db: Db, date: string, payload: Json) {
  const action = String(payload.action ?? "open");
  const parsedTotal = Number(payload.total ?? payload.vagasTotais ?? 0);
  const total = Math.max(0, Math.min(99, Math.floor(Number.isFinite(parsedTotal) ? parsedTotal : 0)));
  const { data: existing } = await db.from("datas_liberacao_financeira").select("id,data,vagas_totais,status,fechamento_manual").eq("data", date).maybeSingle();
  const countRes = await db.from("agendamentos").select("id", { count: "exact", head: true }).eq("data_cirurgia", date).in("status", ["confirmado","realizado"]);
  const used = countRes.count ?? 0;
  if (total < used && action !== "close") return { error: "O total não pode ser menor que " + used + " cirurgia(s) já agendada(s).", status: 409 };

  if (!existing) {
    const { data, error } = await db.from("datas_liberacao_financeira").insert({
      data: date,
      vagas_totais: action === "close" ? total : Math.max(total,1),
      status: action === "close" ? "bloqueado" : "disponivel",
      fechamento_manual: action === "close",
    }).select("*").single();
    if (error) return { error: error.message, status: 400 };
    return { data };
  }

  const patch: Json = {};
  if (action === "close") { patch.status = "bloqueado"; patch.fechamento_manual = true; }
  else {
    patch.status = "disponivel";
    patch.fechamento_manual = false;
    patch.vagas_totais = Math.max(total,used);
  }
  const { data, error } = await db.from("datas_liberacao_financeira").update(patch).eq("id", existing.id).select("*").single();
  if (error) return { error: error.message, status: 400 };
  return { data };
}

function rpcStatus(message: string) {
  if (/NAO_ENCONTR|não encontr/i.test(message)) return 404;
  if (/PERCENTUAL|LEVANTAMENTO|FORMA_QUITACAO|PREVISAO_NAO|ANTES_DA_PREVISAO|AGENDA_CIRURGICA|DATA_PASSADA|QUITACAO_JA|VAGAS|HORARIO_OCUPADO|TETO_MENSAL/i.test(message)) return 409;
  if (/INVALID|OBRIGATOR|HORARIO_INVALIDO|PREVISAO_INVALIDA/i.test(message)) return 400;
  return 500;
}

export async function adminAgenda(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const managed = path.startsWith("/api/admin/agenda/")
    || /^\/api\/admin\/clientes\/[^/]+\/(agenda-flow|levantamento-financeiro|previsao-cirurgia|comparecimento-termos|quitacao-saldo)$/.test(path);
  if (!managed) return null;

  const auth = await authContext(request, env);
  if (!auth) return json({ erro: "Sessão administrativa expirada ou sem autorização." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return json({ erro: "Origem da requisição não autorizada." }, 403);
  const db = createServiceSupabaseClient(env);

  try {
    if (path === "/api/admin/agenda/termos" && request.method === "GET") {
      return json(await termsPayload(db, monthKey(url.searchParams.get("month"))));
    }

    if (path === "/api/admin/agenda/liberacao-financeira" && request.method === "GET") {
      return json(await releaseQueue(db));
    }

    if (path === "/api/admin/agenda/cirurgias" && request.method === "GET") {
      return json(await surgeriesPayload(db, monthKey(url.searchParams.get("month"))));
    }

    if (path === "/api/admin/agenda/cirurgias/capacidade-financeira" && request.method === "GET") {
      const clientId = url.searchParams.get("excludeClientId");
      const all = clientId ? await base(db) : null;
      const client = clientId ? all?.clients.find((item) => item.id === clientId) ?? null : null;
      const months = await monthPlanner(db, clientId);
      return json({
        monthlyCap: MONTHLY_CAP,
        rows: plannerWithClient(months, number(client?.valor_contrato)),
      });
    }

    const termsCapacity = path.match(/^\/api\/admin\/agenda\/termos\/(\d{4}-\d{2}-\d{2})\/capacity$/);
    if (termsCapacity && request.method === "PUT") {
      const payload = await body(request);
      const result = await setTermsCapacity(db, termsCapacity[1], payload);
      if ("error" in result) return json({ erro: result.error }, result.status);
      await db.from("logs_alteracoes").insert({ usuario: auth.actor, acao: "configurou_capacidade_termos", entidade: "datas", entidade_id: result.data.id, detalhes: { data: termsCapacity[1], ...payload } });
      return json({ data: result.data });
    }

    const surgeryCapacity = path.match(/^\/api\/admin\/agenda\/cirurgias\/(\d{4}-\d{2}-\d{2})\/capacity$/);
    if (surgeryCapacity && request.method === "PUT") {
      const payload = await body(request);
      const result = await setSurgeryCapacity(db, surgeryCapacity[1], payload);
      if ("error" in result) return json({ erro: result.error }, result.status);
      await db.from("logs_alteracoes").insert({ usuario: auth.actor, acao: "configurou_capacidade_cirurgia", entidade: "datas_liberacao_financeira", entidade_id: result.data.id, detalhes: { data: surgeryCapacity[1], ...payload } });
      return json({ data: result.data });
    }

    const flowMatch = path.match(/^\/api\/admin\/clientes\/([^/]+)\/agenda-flow$/);
    if (flowMatch && request.method === "GET") {
      const data = await agendaFlow(db, decodeURIComponent(flowMatch[1]));
      return data ? json(data) : json({ erro: "Cliente não encontrada." }, 404);
    }

    const reviewMatch = path.match(/^\/api\/admin\/clientes\/([^/]+)\/levantamento-financeiro$/);
    if (reviewMatch && request.method === "POST") {
      const payload = await body(request);
      const forms = Array.isArray(payload.formasQuitacao) ? payload.formasQuitacao.filter((item): item is string => typeof item === "string") : [];
      const result = await db.rpc("agenda_confirmar_levantamento", {
        p_cliente_id: decodeURIComponent(reviewMatch[1]),
        p_saldo_final: Number(payload.saldoFinal),
        p_formas: forms,
        p_usuario: auth.actor,
      });
      if (result.error) return json({ erro: result.error.message }, rpcStatus(result.error.message));
      return json({ cliente: result.data });
    }

    const forecastMatch = path.match(/^\/api\/admin\/clientes\/([^/]+)\/previsao-cirurgia$/);
    if (forecastMatch && request.method === "POST") {
      const payload = await body(request);
      if (!isoDate(payload.data)) return json({ erro: "Informe uma previsão válida." }, 400);
      const clientId = decodeURIComponent(forecastMatch[1]);
      const flow = await agendaFlow(db, clientId);
      if (!flow?.appointment?.id) return json({ erro: "A cliente ainda não possui agendamento de termos ativo." }, 409);
      const result = await db.rpc("agenda_confirmar_previsao", {
        p_agendamento_id: flow.appointment.id,
        p_previsao: payload.data,
        p_usuario: auth.actor,
      });
      if (result.error) return json({ erro: result.error.message }, rpcStatus(result.error.message));
      return json({ agendamento: result.data, flow: await agendaFlow(db, clientId) });
    }

    const attendanceMatch = path.match(/^\/api\/admin\/clientes\/([^/]+)\/comparecimento-termos$/);
    if (attendanceMatch && request.method === "POST") {
      const payload = await body(request);
      if (typeof payload.compareceu !== "boolean") return json({ erro: "Informe a ocorrência do atendimento." }, 400);
      const clientId = decodeURIComponent(attendanceMatch[1]);
      const flow = await agendaFlow(db, clientId);
      if (!flow?.appointment?.id) return json({ erro: "A cliente não possui agendamento de termos ativo." }, 409);
      const result = await db.rpc("agenda_registrar_comparecimento", {
        p_agendamento_id: flow.appointment.id,
        p_compareceu: payload.compareceu,
        p_usuario: auth.actor,
      });
      if (result.error) return json({ erro: result.error.message }, rpcStatus(result.error.message));
      return json({ agendamento: result.data, returnedToStage4: payload.compareceu === false, flow: await agendaFlow(db, clientId) });
    }

    const settlementMatch = path.match(/^\/api\/admin\/clientes\/([^/]+)\/quitacao-saldo$/);
    if (settlementMatch && request.method === "POST") {
      const payload = await body(request);
      if (typeof payload.recebido !== "boolean") return json({ erro: "Informe o resultado do pagamento." }, 400);
      const clientId = decodeURIComponent(settlementMatch[1]);
      const flow = await agendaFlow(db, clientId);
      if (!flow?.appointment?.id) return json({ erro: "A cliente não possui agendamento de termos ativo." }, 409);
      const idempotency = typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim()
        ? payload.idempotencyKey.trim().slice(0,120)
        : crypto.randomUUID();
      const result = await db.rpc("agenda_registrar_quitacao", {
        p_agendamento_id: flow.appointment.id,
        p_recebido: payload.recebido,
        p_usuario: auth.actor,
        p_idempotency_key: idempotency,
      });
      if (result.error) return json({ erro: result.error.message }, rpcStatus(result.error.message));
      return json({ agendamento: result.data, returnedToStage4: payload.recebido === false, flow: await agendaFlow(db, clientId) });
    }

    return json({ erro: "Rota da Agenda não encontrada." }, 404);
  } catch (error) {
    console.error("Falha na Agenda administrativa:", error);
    return json({ erro: error instanceof Error ? error.message : "Falha inesperada na Agenda." }, 500);
  }
}
