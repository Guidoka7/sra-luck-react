"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function aplicarPagamentos() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>("div.overflow-hidden.rounded-2xl"));

  for (const card of cards) {
    if (card.dataset.compactPagamentos === "1") continue;

    const children = Array.from(card.children) as HTMLElement[];
    const header = children[0];
    const parcelas = children.find((el) => el.className.includes("divide-y"));
    if (!header || !parcelas) continue;

    const nome = header.querySelector("p.text-sm.font-semibold")?.textContent?.trim();
    if (!nome) continue;

    card.dataset.compactPagamentos = "1";
    card.dataset.aberto = "0";
    parcelas.style.display = "none";
    parcelas.style.borderTop = "0";

    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", "false");
    header.classList.add("cursor-pointer", "transition-colors", "hover:bg-white/[0.035]");

    const indicador = document.createElement("span");
    indicador.dataset.compactIndicator = "1";
    indicador.className = "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-burgundy/10 bg-white/55 px-2 py-1 text-[0.56rem] font-semibold text-burgundy/65";
    indicador.textContent = "Ver parcelas ↓";
    header.appendChild(indicador);

    const alternar = () => {
      const aberto = card.dataset.aberto === "1";
      card.dataset.aberto = aberto ? "0" : "1";
      parcelas.style.display = aberto ? "none" : "";
      header.setAttribute("aria-expanded", aberto ? "false" : "true");
      indicador.textContent = aberto ? "Ver parcelas ↓" : "Ocultar parcelas ↑";
    };

    header.addEventListener("click", alternar);
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        alternar();
      }
    });
  }
}

function montarListaClientes(select: HTMLSelectElement) {
  if (select.dataset.compactClientes === "1") return;

  const container = select.parentElement;
  if (!container) return;

  const lista = document.createElement("div");
  lista.dataset.compactClientList = "1";
  lista.className = "mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3";

  const atualizar = () => {
    lista.innerHTML = "";
    const opcoes = Array.from(select.options).filter((option) => option.value);

    if (!opcoes.length) {
      const vazio = document.createElement("div");
      vazio.className = "col-span-full rounded-xl border border-dashed border-rose/15 bg-blush/10 px-3 py-4 text-center text-[0.68rem] text-clay/45";
      vazio.textContent = "Nenhuma cliente encontrada.";
      lista.appendChild(vazio);
      return;
    }

    for (const option of opcoes) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "flex min-w-0 items-center justify-between gap-2 rounded-xl border border-rose/10 bg-white/55 px-3 py-2 text-left transition-all hover:border-burgundy/20 hover:bg-blush/25";

      const texto = document.createElement("span");
      texto.className = "min-w-0 truncate text-[0.72rem] font-semibold text-burgundy";
      texto.textContent = option.textContent ?? "Cliente";

      const seta = document.createElement("span");
      seta.className = "shrink-0 text-[0.62rem] text-burgundy/45";
      seta.textContent = "Abrir →";

      botao.append(texto, seta);
      botao.addEventListener("click", () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        lista.querySelectorAll("button").forEach((item) => item.classList.remove("border-burgundy/35", "bg-blush/45"));
        botao.classList.add("border-burgundy/35", "bg-blush/45");
      });
      lista.appendChild(botao);
    }
  };

  select.style.display = "none";
  select.dataset.compactClientes = "1";
  container.appendChild(lista);
  atualizar();

  const observer = new MutationObserver(atualizar);
  observer.observe(select, { childList: true, subtree: true });
  (select as HTMLSelectElement & { __compactObserver?: MutationObserver }).__compactObserver = observer;
}

function aplicarParcelas() {
  const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((item) =>
    Array.from(item.options).some((option) => option.textContent?.trim() === "Selecione uma cliente")
  );
  if (select) montarListaClientes(select);
}

export function AdminCompactLists() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/admin/pagamentos" && pathname !== "/admin/parcelas") return;

    let cancelado = false;
    const aplicar = () => {
      if (cancelado) return;
      if (pathname === "/admin/pagamentos") aplicarPagamentos();
      if (pathname === "/admin/parcelas") aplicarParcelas();
    };

    aplicar();
    const observer = new MutationObserver(() => aplicar());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelado = true;
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
