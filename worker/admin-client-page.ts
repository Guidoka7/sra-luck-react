import { createServiceSupabaseClient, type Env } from "./supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUNIS = new Set(["aguardando", "cadastradas", "canceladas"]);
const STATUS = new Set(["ativo", "suspenso", "negativado", "cancelado"]);
const SORT = new Set(["recent", "old", "az", "za"]);

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function cursorValido(value: string | null): [string | null, string | null] | null {
  if (!value) return [null, null];
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const [key, id] = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof key !== "string" || key.length > 128 || typeof id !== "string" || !UUID.test(id)) return null;
    return [key, id];
  } catch { return null; }
}

export async function adminClientPage(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;
  if (!["/api/admin/clientes/pagina", "/api/admin/clientes/totais", "/api/admin/clientes/bancos"].includes(url.pathname)) return null;
  const db = createServiceSupabaseClient(env, request);
  if (url.pathname.endsWith("/totais")) {
    const { data, error } = await db.rpc("loadtest_admin_clientes_totais");
    return error ? json({ erro: "Não foi possível carregar os totais." }, 500) : json(data ?? {});
  }
  if (url.pathname.endsWith("/bancos")) {
    const { data, error } = await db.rpc("loadtest_admin_clientes_bancos");
    return error ? json({ erro: "Não foi possível carregar os bancos." }, 500) : json({ bancos: data ?? [] });
  }

  const funil = url.searchParams.get("funil") ?? "cadastradas";
  const status = url.searchParams.get("status");
  const sort = url.searchParams.get("ordem") ?? "recent";
  const cursor = cursorValido(url.searchParams.get("cursor"));
  const periodo = url.searchParams.get("desde");
  if (!FUNIS.has(funil) || !SORT.has(sort) || (status && !STATUS.has(status)) || !cursor
    || (cursor[0] && (sort === "recent" || sort === "old") && !Number.isFinite(Date.parse(cursor[0])))
    || (periodo && (periodo.length > 40 || !Number.isFinite(Date.parse(periodo))))) {
    return json({ erro: "Filtro de clientes inválido." }, 400);
  }
  const rawLimit = url.searchParams.get("limite") ?? "50";
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1) return json({ erro: "Limite inválido." }, 400);
  const limit = Math.min(50, Number(rawLimit));
  const busca = url.searchParams.get("busca")?.trim().slice(0, 80) || null;
  const banco = url.searchParams.get("banco")?.trim().slice(0, 80) || null;
  const { data, error } = await db.rpc(sort === "recent" ? "loadtest_admin_clientes_pagina_recent" : "loadtest_admin_clientes_pagina", {
    p_limite: limit,
    p_cursor_created: sort === "recent" || sort === "old" ? cursor[0] : null,
    p_cursor_id: cursor[1],
    p_busca: busca,
    p_funil: funil,
    p_status: status || null,
    p_periodo_inicio: periodo || null,
    p_banco: banco,
    p_sort: sort,
    p_cursor_name: sort === "az" || sort === "za" ? cursor[0] : null,
  });
  if (error) return json({ erro: "Não foi possível carregar a página de clientes." }, 500);
  const rows = Array.isArray(data) ? data : [];
  const page = rows.slice(0, limit);
  const last = page.at(-1) as { created_at?: string; nome_completo?: string; id?: string } | undefined;
  const key = sort === "az" || sort === "za" ? (last?.nome_completo ?? "").toLowerCase() : last?.created_at;
  const cursorBytes = key !== undefined && last?.id ? new TextEncoder().encode(JSON.stringify([key, last.id])) : null;
  const nextCursor = rows.length > limit && key !== undefined && last?.id
    ? btoa(Array.from(cursorBytes ?? [], (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
    : null;
  return json({ clientes: page, nextCursor, limite: limit });
}
