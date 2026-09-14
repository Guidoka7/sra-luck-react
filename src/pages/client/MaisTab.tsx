import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, FileText, Gift, HelpCircle, LockKeyhole, LogOut, MessageCircle, Phone } from "lucide-react";
import { ClubeScreen } from "@/components/cliente/clube/ClubeScreen";
import { primeiroNome } from "@/lib/utils";

type SubTela = "clube" | "documentos" | "atendimento" | "faq" | "seguranca" | null;

interface MaisTabProps {
  nomeCliente: string;
  onSair: () => void;
  onIrParcelas: () => void;
}

const FAQS = [
  { pergunta: "Como funciona a liberação da minha agenda?", resposta: "Ao atingir o percentual mínimo de parcelas pagas do seu plano, iniciamos um levantamento financeiro de até 5 dias úteis. Aprovado, sua agenda é liberada para escolher a data da assinatura dos termos." },
  { pergunta: "Onde vejo meus comprovantes enviados?", resposta: "Na aba Parcelas, cada parcela mostra o status do comprovante (em análise, confirmado ou rejeitado)." },
  { pergunta: "Posso pagar uma parcela no cartão de crédito?", resposta: "Quando disponível para o seu contrato, a opção de cartão aparece ao abrir o pagamento de uma parcela, já com a taxa configurada pela equipe." },
  { pergunta: "Como funcionam os pontos do Clube de Vantagens?", resposta: "Você ganha pontos ao confirmar sua primeira parcela e ao indicar amigas que se tornarem clientes. Troque os pontos por benefícios no próprio app." },
];

function FaqItem({ pergunta, resposta }: { pergunta: string; resposta: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="rounded-xl border border-rose/12 bg-white/80">
      <button type="button" onClick={() => setAberto((v) => !v)} className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left">
        <span className="text-[0.8rem] font-semibold text-burgundy">{pergunta}</span>
        <ChevronDown className={`h-4 w-4 flex-none text-clay/40 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && <p className="border-t border-rose/10 px-3.5 pb-3.5 pt-2.5 text-[0.75rem] leading-relaxed text-clay/60">{resposta}</p>}
    </div>
  );
}

function SubHeader({ titulo, onVoltar }: { titulo: string; onVoltar: () => void }) {
  return (
    <button type="button" onClick={onVoltar} className="mb-3 flex items-center gap-1.5 text-[0.72rem] font-semibold text-burgundy">
      <ArrowLeft className="h-4 w-4" /> {titulo}
    </button>
  );
}

export function MaisTab({ nomeCliente, onSair, onIrParcelas }: MaisTabProps) {
  const [sub, setSub] = useState<SubTela>(null);
  const [contato, setContato] = useState<{ whatsapp: string | null; telefone: string | null }>({ whatsapp: null, telefone: null });

  useEffect(() => {
    fetch("/api/cliente/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((dados) => {
        if (dados) setContato({ whatsapp: dados.whatsappContato ?? null, telefone: dados.telefoneContato ?? null });
      })
      .catch(() => {});
  }, []);

  if (sub === "clube") return <ClubeScreen onVoltar={() => setSub(null)} onIrParcelas={onIrParcelas} />;

  if (sub === "documentos") {
    return (
      <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
        <SubHeader titulo="Mais" onVoltar={() => setSub(null)} />
        <h1 className="font-heading text-xl font-semibold text-burgundy">Meus documentos</h1>
        <p className="mt-3 text-[0.8rem] leading-relaxed text-clay/60">
          Para solicitar uma cópia do seu contrato, comprovantes ou qualquer outro documento, fale com a nossa equipe
          pelo Atendimento — enviamos tudo diretamente para você.
        </p>
        <button type="button" onClick={() => setSub("atendimento")} className="mt-4 rounded-full bg-burgundy px-4 py-2.5 text-xs font-bold uppercase tracking-label text-pearl">
          Ir para Atendimento
        </button>
      </div>
    );
  }

  if (sub === "atendimento") {
    return (
      <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
        <SubHeader titulo="Mais" onVoltar={() => setSub(null)} />
        <h1 className="font-heading text-xl font-semibold text-burgundy">Atendimento</h1>
        <div className="mt-4 flex flex-col gap-2.5">
          {contato.whatsapp && (
            <a href={`https://wa.me/${contato.whatsapp}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-burgundy px-4 py-3.5 text-pearl">
              <MessageCircle className="h-5 w-5" />
              <div><p className="text-sm font-semibold">WhatsApp</p><p className="text-[0.68rem] text-pearl/75">Fale agora com a equipe</p></div>
            </a>
          )}
          {contato.telefone && (
            <a href={`tel:${contato.telefone}`} className="flex items-center gap-3 rounded-2xl border border-rose/15 bg-white/85 px-4 py-3.5">
              <Phone className="h-5 w-5 text-burgundy" />
              <div><p className="text-sm font-semibold text-burgundy">Ligar para a equipe</p><p className="text-[0.68rem] text-clay/55">{contato.telefone}</p></div>
            </a>
          )}
          {!contato.whatsapp && !contato.telefone && (
            <p className="text-sm text-clay/50">Os canais de atendimento ainda não foram configurados pela equipe.</p>
          )}
        </div>
      </div>
    );
  }

  if (sub === "faq") {
    return (
      <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
        <SubHeader titulo="Mais" onVoltar={() => setSub(null)} />
        <h1 className="font-heading text-xl font-semibold text-burgundy">Dúvidas frequentes</h1>
        <div className="mt-4 flex flex-col gap-2">
          {FAQS.map((item) => <FaqItem key={item.pergunta} {...item} />)}
        </div>
      </div>
    );
  }

  if (sub === "seguranca") {
    return (
      <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
        <SubHeader titulo="Mais" onVoltar={() => setSub(null)} />
        <h1 className="font-heading text-xl font-semibold text-burgundy">Segurança</h1>
        <p className="mt-3 text-[0.8rem] leading-relaxed text-clay/60">
          Seus dados são acessados apenas com o seu CPF e data de nascimento. Nunca pedimos sua senha ou dados
          bancários por telefone, WhatsApp ou e-mail fora do aplicativo.
        </p>
        <button type="button" onClick={onSair} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-alert/20 bg-alert/8 px-4 py-3 text-xs font-bold uppercase tracking-label text-alert">
          <LogOut className="h-3.5 w-3.5" /> Encerrar acesso com segurança
        </button>
      </div>
    );
  }

  const itens = [
    { id: "clube" as const, icone: Gift, nome: "Clube de vantagens", sub: "Pontos, indicações e prêmios" },
    { id: "documentos" as const, icone: FileText, nome: "Meus documentos", sub: "Contrato e comprovantes" },
    { id: "atendimento" as const, icone: MessageCircle, nome: "Atendimento", sub: "Fale com a nossa equipe" },
    { id: "faq" as const, icone: HelpCircle, nome: "Dúvidas frequentes", sub: "Perguntas mais comuns" },
    { id: "seguranca" as const, icone: LockKeyhole, nome: "Segurança", sub: "Como protegemos seus dados" },
  ];

  return (
    <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
      <h1 className="font-heading text-xl font-semibold text-burgundy">Mais</h1>
      <p className="mt-0.5 text-[0.75rem] text-clay/55">Olá, {primeiroNome(nomeCliente)}.</p>

      <div className="mt-4 flex flex-col gap-2">
        {itens.map(({ id, icone: Icone, nome, sub: subtitulo }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSub(id)}
            className="flex items-center gap-3 rounded-2xl border border-rose/12 bg-white/85 px-4 py-3.5 text-left shadow-card"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-rose/10 text-rose">
              <Icone className="h-4 w-4" strokeWidth={1.6} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-clay">{nome}</p>
              <p className="text-[0.7rem] text-clay/50">{subtitulo}</p>
            </div>
          </button>
        ))}

        <button
          type="button"
          onClick={onSair}
          className="mt-2 flex items-center gap-3 rounded-2xl border border-alert/15 bg-alert/5 px-4 py-3.5 text-left"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-alert/10 text-alert">
            <LogOut className="h-4 w-4" strokeWidth={1.6} />
          </span>
          <div>
            <p className="text-sm font-semibold text-alert">Sair</p>
            <p className="text-[0.7rem] text-alert/60">Encerrar acesso com segurança</p>
          </div>
        </button>
      </div>

      <div className="mt-8 flex flex-col items-center gap-1 pb-4 opacity-60">
        <img src="/brand/sra-luck-mark.png" alt="" className="h-6 w-6 object-contain" />
        <p className="text-[0.6rem] text-clay/40">versão 2.0</p>
      </div>
    </div>
  );
}
