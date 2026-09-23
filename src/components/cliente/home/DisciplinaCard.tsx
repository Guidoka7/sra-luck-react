import { useEffect, useState } from "react";
import { MarcaSraLuck } from "@/components/cliente/MarcaSraLuck";
import { apiJson } from "@/lib/api";
import { fraseDoDia, trechosDaFrase, FUSO_SRA_LUCK } from "@/lib/fraseDoDia";

type Frase = { texto: string; tema: string; data: string; dona?: string; origem?: string };

const CHAVE_CACHE = "sra-luck-frase-do-dia";

function dataPorExtenso(agora: Date) {
  const texto = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_SRA_LUCK, weekday: "long", day: "numeric", month: "long" }).format(agora);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// A frase traz o primeiro nome da cliente: o cache só vale para a mesma conta.
function lerCache(data: string, dona: string): Frase | null {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_CACHE) ?? "null") as Frase | null;
    return salvo && salvo.data === data && salvo.dona === dona && salvo.texto ? salvo : null;
  } catch { return null; }
}

function gravarCache(frase: Frase) {
  try { localStorage.setItem(CHAVE_CACHE, JSON.stringify(frase)); } catch { /* armazenamento indisponível: só perde o atalho */ }
}

/**
 * Cartão "Frase do dia" da Início. A frase personalizada vem do agente
 * (GET /api/cliente/frase-do-dia → worker/frase-do-dia.ts, Gemini). Enquanto
 * carrega, ou se o serviço falhar, mostra a frase do catálogo local
 * (src/lib/fraseDoDia.ts). Troca sozinho na virada do dia (horário de Brasília).
 */
export function DisciplinaCard({ nomeCliente = "" }: { nomeCliente?: string }) {
  const [agora, setAgora] = useState(() => new Date());
  const local = fraseDoDia(agora);
  const [frase, setFrase] = useState<Frase>(() => lerCache(local.data, nomeCliente) ?? local);

  useEffect(() => {
    const atualizar = () => setAgora((antes) => {
      const novo = new Date();
      return fraseDoDia(novo).data === fraseDoDia(antes).data ? antes : novo;
    });
    const timer = window.setInterval(atualizar, 60_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") atualizar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", aoVoltar); };
  }, []);

  useEffect(() => {
    let ativo = true;
    const hoje = fraseDoDia(agora);
    const emCache = lerCache(hoje.data, nomeCliente);
    setFrase(emCache ?? hoje);
    if (emCache) return;
    apiJson<Frase>("/api/cliente/frase-do-dia", { cache: "no-store" })
      .then((resposta) => {
        if (!ativo || !resposta?.texto || resposta.data !== hoje.data) return;
        const nova = { texto: resposta.texto, tema: resposta.tema || hoje.tema, data: resposta.data, dona: nomeCliente };
        // Só guarda a frase da IA; a de reserva é refeita no próximo acesso.
        if (resposta.origem === "ia") gravarCache(nova);
        setFrase(nova);
      })
      .catch(() => { /* mantém a frase do catálogo */ });
    return () => { ativo = false; };
  }, [agora, nomeCliente]);

  return (
    <section className="sl-frase" aria-label="Frase do dia">
      <div className="sl-frase-topo">
        <span className="sl-frase-rotulo">Frase do dia</span>
        <time className="sl-frase-data" dateTime={frase.data}>{dataPorExtenso(agora)}</time>
      </div>
      <p key={frase.texto} className="sl-frase-texto" aria-live="polite">
        {trechosDaFrase(frase.texto).map((t, i) => (t.destaque ? <em key={i}>{t.texto}</em> : <span key={i}>{t.texto}</span>))}
      </p>
      <div className="sl-frase-rodape">
        <span className="sl-frase-tema">{frase.tema}</span>
        <MarcaSraLuck className="sl-frase-marca" />
      </div>
    </section>
  );
}
