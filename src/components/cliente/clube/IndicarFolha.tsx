import { useEffect, useState } from "react";
import { CheckCircle2, Contact } from "lucide-react";
import { toast } from "sonner";
import { indicarAmiga } from "@/lib/clube";
import { Folha } from "./ClubeUi";
import { linkConviteWhatsApp, mascaraTelefone } from "./clubeRegras";

type ContatoSelecionado = { name?: string[]; tel?: string[] };
type NavegadorComContatos = Navigator & { contacts?: { select: (props: string[], opts?: { multiple?: boolean }) => Promise<ContatoSelecionado[]> } };

function contatosDisponiveis() {
  return typeof navigator !== "undefined" && "contacts" in navigator && typeof window !== "undefined" && "ContactsManager" in window;
}

function IconeWhatsApp() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.86 9.86 0 0 0 12.04 2Zm5.8 14.13c-.24.68-1.42 1.3-1.95 1.36-.5.06-1.13.09-1.82-.12-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.8-4.18-4.94-4.37-.14-.19-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.26-.29.57-.36.76-.36h.55c.17 0 .41-.07.64.49.24.57.81 1.98.88 2.12.07.14.12.31.02.5-.09.19-.14.31-.28.47-.14.17-.3.37-.42.5-.14.14-.29.29-.12.57.17.29.74 1.22 1.59 1.98 1.09.97 2.01 1.27 2.3 1.41.28.14.45.12.62-.07.17-.19.71-.83.9-1.12.19-.28.38-.24.64-.14.26.09 1.66.78 1.95.92.28.14.47.21.54.33.07.12.07.69-.17 1.37Z" /></svg>;
}

/** Indicar uma amiga: formulário simples, contatos do celular e convite pronto no WhatsApp. */
export function IndicarFolha({ aberta, onFechar, onEnviada, pontosPorIndicacao, nomeCliente }: {
  aberta: boolean; onFechar: () => void; onEnviada: () => void; pontosPorIndicacao: number; nomeCliente?: string;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [consentimento, setConsentimento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviada, setEnviada] = useState<{ nome: string; telefone: string } | null>(null);

  useEffect(() => {
    if (aberta) { setNome(""); setTelefone(""); setConsentimento(false); setErro(null); setEnviada(null); }
  }, [aberta]);

  const digitos = telefone.replace(/\D/g, "");
  const valido = nome.trim().length >= 2 && digitos.length >= 10 && consentimento;

  async function escolherContato() {
    try {
      const [contato] = await (navigator as NavegadorComContatos).contacts!.select(["name", "tel"], { multiple: false });
      if (!contato) return;
      if (contato.name?.[0]) setNome(contato.name[0]);
      if (contato.tel?.[0]) setTelefone(mascaraTelefone(contato.tel[0].replace(/^\+?55/, "")));
    } catch { /* cancelado pela cliente */ }
  }

  async function enviar() {
    if (!valido || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await indicarAmiga(nome.trim(), digitos, consentimento);
      setEnviada({ nome: nome.trim(), telefone: digitos });
      onEnviada();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar a indicação.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Folha aberta={aberta} onFechar={onFechar} titulo={enviada ? "Indicação enviada" : "Indicar uma amiga"}>
      {enviada ? (
        <div className="pb-1 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-[#3F7D5B]" strokeWidth={1.5} />
          <p className="m-0 pt-3 text-[14px] leading-[1.5] text-[#5E4A46]">
            Pronto! Nossa equipe vai falar com a <strong className="font-semibold text-[#2E2422]">{enviada.nome.split(" ")[0]}</strong>. Você acompanha tudo na aba Indicações.
          </p>
          <a
            href={linkConviteWhatsApp(enviada.nome, enviada.telefone, nomeCliente)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => toast.success("Abrindo o WhatsApp…")}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#1F9D55] px-4 py-[14px] text-[14px] font-semibold text-white shadow-[0_8px_18px_rgba(31,157,85,.25)]"
          >
            <IconeWhatsApp /> Avisar ela no WhatsApp
          </a>
          <button type="button" onClick={onFechar} className="mt-2 w-full rounded-[14px] px-4 py-3 text-[13.5px] font-semibold text-[#7D2434]">Concluir</button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} className="flex flex-col gap-3">
          <p className="m-0 rounded-[14px] bg-[#FBF4E7] px-4 py-3 text-[12.5px] leading-[1.5] text-[#6D5530]">
            Você ganha <strong className="font-semibold">{pontosPorIndicacao} pontos</strong> quando ela fechar contrato e pagar a 1ª parcela.
          </p>
          {contatosDisponiveis() && (
            <button type="button" onClick={() => void escolherContato()} className="flex items-center justify-center gap-2 rounded-[14px] border border-[#E6D3CF] bg-white px-4 py-3 text-[13.5px] font-semibold text-[#7D2434]">
              <Contact className="h-4 w-4" /> Escolher dos contatos
            </button>
          )}
          <label className="flex flex-col gap-[6px] text-[11px] font-medium uppercase tracking-[.1em] text-[#9A8C88]">
            Nome da amiga
            <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" placeholder="Ex.: Ana Paula" className="rounded-[14px] border border-[#E6DAD6] bg-white px-4 py-[14px] text-[16px] normal-case tracking-normal text-[#2E2422] outline-none focus:border-[#6B1F2E]" />
          </label>
          <label className="flex flex-col gap-[6px] text-[11px] font-medium uppercase tracking-[.1em] text-[#9A8C88]">
            WhatsApp com DDD
            <input value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} inputMode="tel" autoComplete="off" placeholder="(61) 99999-0000" className="rounded-[14px] border border-[#E6DAD6] bg-white px-4 py-[14px] text-[16px] normal-case tracking-normal text-[#2E2422] outline-none focus:border-[#6B1F2E]" />
          </label>
          <label className="flex items-start gap-3 rounded-[14px] border border-[#E6DAD6] bg-[#FAF7F6] px-4 py-3 text-[12.5px] leading-[1.45] text-[#5E4A46]">
            <input
              type="checkbox"
              checked={consentimento}
              onChange={(e) => setConsentimento(e.target.checked)}
              className="mt-[2px] h-4 w-4 shrink-0 accent-[#6B1F2E]"
            />
            <span>Confirmo que minha amiga autorizou o compartilhamento do WhatsApp dela para receber este contato da Sra. Luck.</span>
          </label>
          {erro && <div role="alert" className="rounded-[12px] border border-[#F0D3D1] bg-[#FBEBEA] px-4 py-3 text-[12.5px] text-[#8F2A25]">{erro}</div>}
          <button type="submit" disabled={!valido || enviando} className="mt-1 w-full rounded-[14px] bg-[#6B1F2E] px-4 py-[15px] text-[14.5px] font-semibold text-white disabled:opacity-45">
            {enviando ? "Enviando…" : "Enviar indicação"}
          </button>
          <p className="m-0 text-center text-[11.5px] font-light text-[#9A8C88]">Os dados dela são usados só para esse contato.</p>
        </form>
      )}
    </Folha>
  );
}
