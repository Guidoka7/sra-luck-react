import { useEffect, useState } from "react";
import { MarcaSraLuck } from "@/components/cliente/MarcaSraLuck";
import { apiJson } from "@/lib/api";
import { fraseDoDia, trechosDaFrase, FUSO_SRA_LUCK } from "@/lib/fraseDoDia";

type Frase = { texto: string; tema: string; data: string; origem?: string };

const CHAVE_CACHE = "sra-luck-frase-do-dia";

function dataPorExtenso(agora: Date) {
  const texto = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_SRA_LUCK, weekday: "long", day: "numeric", month: "long" }).format(agora);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// A mensagem do dia é a mesma para todas as clientes: o cache vale só pela data.
function lerCache(data: string): Frase | null {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_CACHE) ?? "null") as Frase | null;
    return salvo && salvo.data === data && salvo.texto ? salvo : null;
  } catch { return null; }
}

function gravarCache(frase: Frase) {
  try { localStorage.setItem(CHAVE_CACHE, JSON.stringify(frase)); } catch { /* armazenamento indisponível: só perde o atalho */ }
}

/**
 * Cartão "Frase do dia" da Início. Mostra a mensagem do dia salva pela rotina
 * diária (GET /api/cliente/frase-do-dia → tabela mensagens_do_dia; o app nunca
 * chama o Gemini). Enquanto carrega, ou antes de a rotina rodar, mostra a frase
 * do catálogo local (src/lib/fraseDoDia.ts). Troca sozinho na virada do dia.
 */
export function DisciplinaCard() {
  const [agora, setAgora] = useState(() => new Date());
  const local = fraseDoDia(agora);
  const [frase, setFrase] = useState<Frase>(() => lerCache(local.data) ?? local);

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
    const emCache = lerCache(hoje.data);
    setFrase(emCache ?? hoje);
    // Mostra o cache na hora e confere em segundo plano: a equipe pode trocar a
    // mensagem de hoje pelo painel, e a troca precisa chegar a quem já abriu o app.
    apiJson<Frase>("/api/cliente/frase-do-dia", { cache: "no-store" })
      .then((resposta) => {
        if (!ativo || !resposta?.texto || resposta.data !== hoje.data) return;
        if (emCache && resposta.origem === "reserva") return;
        const nova = { texto: resposta.texto, tema: resposta.tema || hoje.tema, data: resposta.data };
        // Guarda só a mensagem já salva no banco; a reserva ("antes da rotina") é consultada de novo.
        if (resposta.origem !== "reserva") gravarCache(nova);
        if (!emCache || emCache.texto !== nova.texto) setFrase(nova);
      })
      .catch(() => { /* mantém a frase do catálogo */ });
    return () => { ativo = false; };
  }, [agora]);

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
