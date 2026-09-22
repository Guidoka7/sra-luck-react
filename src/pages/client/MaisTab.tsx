import { useEffect, useState, type ReactNode } from "react";
import { ClubeScreen } from "@/components/cliente/clube/ClubeScreen";
import { ProfilePhotoPicker } from "@/components/cliente/ProfilePhotoPicker";
import { registrarErro } from "@/lib/monitoramento";
import { ConfiguracoesApp } from "@/pages/client/ConfiguracoesApp";

type SubTela = "clube" | "documentos" | "jornada" | "atendimento" | "faq" | "configuracoes" | "seguranca" | null;
export type MaisSubTelaInicial = Extract<SubTela, "clube" | "jornada" | "atendimento">;

interface MaisTabProps {
  nomeCliente: string;
  onSair: () => void;
  onIrParcelas: () => void;
  /** Subtela "Jornada", renderizada pela página com os dados do processo. */
  renderJornada: (onVoltar: () => void) => ReactNode;
  /** Entrada direta em uma subtela existente (CTA do carrossel da Home). */
  initialSubTela?: MaisSubTelaInicial | null;
  onInitialSubTelaConsumed?: () => void;
}

const FAQS = [
  { pergunta: "Como funciona a liberação da minha agenda?", resposta: "Ao atingir o percentual mínimo de parcelas pagas do seu plano, você pode solicitar a liberação financeira no app. Aprovado o levantamento e confirmado o custeio do saldo, você segue para os termos. Depois da assinatura e da quitação confirmada, a agenda da cirurgia é liberada em até 5 dias úteis, podendo ser antecipada pela nossa equipe." },
  { pergunta: "Onde vejo meus comprovantes enviados?", resposta: "Na aba Parcelas, cada parcela mostra o status do comprovante: em análise, confirmado ou rejeitado." },
  { pergunta: "Posso pagar uma parcela no cartão de crédito?", resposta: "Sim. Ao abrir o pagamento de uma parcela, a opção de cartão leva você para o checkout seguro do Mercado Pago." },
  { pergunta: "Como funcionam os pontos do Clube de Vantagens?", resposta: "Você acompanha o saldo, as movimentações, indicações e os benefícios disponíveis no Clube de vantagens." },
];

function IconeMenu({ tipo }: { tipo: "clube" | "documentos" | "jornada" | "atendimento" | "faq" | "configuracoes" | "seguranca" | "sair" }) {
  const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.45, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (tipo === "clube") return <svg {...base}><path d="M20 12v9H4v-9"/><path d="M2 7h20v5H2z"/><path d="M12 21V7"/><path d="M12 7H7.4a2.4 2.4 0 1 1 2.08-3.6L12 7Z"/><path d="M12 7h4.6a2.4 2.4 0 1 0-2.08-3.6L12 7Z"/></svg>;
  if (tipo === "documentos") return <svg {...base}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>;
  if (tipo === "jornada") return <svg {...base}><circle cx="6.5" cy="6.5" r="2.2"/><circle cx="17.5" cy="12" r="2.2"/><circle cx="8.7" cy="18.5" r="2.2"/><path d="M8.5 7.4c2.7.4 4.7 1.9 6.9 3.4M15.7 13.6c-1.5 2-3.1 3.3-5.1 4.1"/></svg>;
  if (tipo === "atendimento") return <svg {...base}><path d="M21 12a8.5 8.5 0 0 1-9 8.5 9.7 9.7 0 0 1-3.8-.8L3 21l1.4-4.6A8.5 8.5 0 1 1 21 12Z"/><path d="M8.5 11.8h.01M12 11.8h.01M15.5 11.8h.01"/></svg>;
  if (tipo === "faq") return <svg {...base}><circle cx="12" cy="12" r="9"/><path d="M9.8 9.2a2.45 2.45 0 0 1 4.7.9c0 1.8-2.5 2.1-2.5 3.6"/><path d="M12 17.2h.01"/></svg>;
  if (tipo === "configuracoes") return <svg {...base}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.08A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.08A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.08A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.36.38.69.65.97.28.28.62.49 1 .61H21v4h-.08a1.7 1.7 0 0 0-1.52.42Z"/></svg>;
  if (tipo === "seguranca") return <svg {...base}><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/></svg>;
  return <svg {...base}><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></svg>;
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return `${p[0]?.[0] ?? ""}${p.length > 1 ? p[p.length - 1][0] : ""}`.toUpperCase();
}

function SubHeader({ titulo, onVoltar }: { titulo: string; onVoltar: () => void }) {
  return <div className="px-[18px] pt-[calc(max(env(safe-area-inset-top),0px)+18px)]">
    <button type="button" onClick={onVoltar} className="flex items-center gap-[7px] text-[12px] font-normal text-[#6B1F2E]"><svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.35"><path d="M9 3 5 7l4 4"/></svg>Mais</button>
    <div className="pt-[16px] font-heading text-[29px] font-semibold leading-[1.08] text-[#2E2422]">{titulo}</div>
  </div>;
}

function FaqItem({ pergunta, resposta }: { pergunta: string; resposta: string }) {
  const [aberto, setAberto] = useState(false);
  return <div className="overflow-hidden rounded-[16px] border border-[#ECE2DF] bg-white">
    <button type="button" onClick={() => setAberto((v) => !v)} className="flex w-full items-center justify-between gap-3 px-[14px] py-[13px] text-left"><span className="text-[12px] font-medium leading-[1.35] text-[#4B3936]">{pergunta}</span><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#B6AAA6" strokeWidth="1.2" className={`flex-none transition-transform ${aberto ? "rotate-180" : ""}`}><path d="M3.5 5.5 7 9l3.5-3.5"/></svg></button>
    {aberto && <div className="border-t border-[#F3EBE8] px-[14px] pb-[14px] pt-[10px] text-[10.7px] font-light leading-[1.55] text-[#7F6F6B]">{resposta}</div>}
  </div>;
}

function IconeBiometria() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round"><path d="M8.7 3.8A7.8 7.8 0 0 1 19.9 10"/><path d="M4.1 10a7.8 7.8 0 0 1 1.7-4.1"/><path d="M4 14.2c.3 2.4 1.3 4.5 3 6"/><path d="M8 11.2a4 4 0 0 1 7.9.8c0 3.9-1.1 7-3.2 9.2"/><path d="M8 15.1c.2 2.1.8 3.9 1.9 5.5"/><path d="M11.9 8a4 4 0 0 0-3.6 2.3"/></svg>;
}

export function MaisTab({ nomeCliente, onSair, onIrParcelas, renderJornada, initialSubTela = null, onInitialSubTelaConsumed }: MaisTabProps) {
  const [sub, setSub] = useState<SubTela>(initialSubTela);
  const [contato, setContato] = useState<{ whatsapp: string | null; telefone: string | null }>({ whatsapp: null, telefone: null });
  const [contatoFalhou, setContatoFalhou] = useState(false);
  const [biometriaSuportada, setBiometriaSuportada] = useState<boolean | null>(null);
  const [biometriaAtiva, setBiometriaAtiva] = useState(false);
  const [biometriaProcessando, setBiometriaProcessando] = useState(false);
  const [biometriaMensagem, setBiometriaMensagem] = useState<string | null>(null);

  useEffect(() => {
    if (!initialSubTela) return;
    setSub(initialSubTela);
    onInitialSubTelaConsumed?.();
  }, [initialSubTela, onInitialSubTelaConsumed]);

  useEffect(() => {
    fetch("/api/cliente/config", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          registrarErro({ mensagem: `Configuração de contato respondeu HTTP ${r.status}`, nivel: "warn", codigo: "CLIENT_CONFIG_HTTP_FAILED", action: "client.config.read", status_http: r.status, request_id: r.headers.get("x-request-id") || undefined });
          setContatoFalhou(true);
          return null;
        }
        return r.json();
      })
      .then((dados) => { if (dados) setContato({ whatsapp: dados.whatsappContato ?? null, telefone: dados.telefoneContato ?? null }); })
      .catch((error) => {
        setContatoFalhou(true);
        registrarErro({ mensagem: error instanceof Error ? error.message : "Falha ao carregar canais de atendimento", nivel: "warn", codigo: "CLIENT_CONFIG_LOAD_FAILED", action: "client.config.read" });
      });
  }, []);

  useEffect(() => {
    try { setBiometriaAtiva(localStorage.getItem("sra-luck-biometria-ativa") === "true"); } catch {}
    if (!window.isSecureContext || !("PublicKeyCredential" in window) || typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
      setBiometriaSuportada(false);
      return;
    }
    void PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then(setBiometriaSuportada)
      .catch(() => setBiometriaSuportada(false));
  }, []);

  async function ativarBiometria() {
    if (!biometriaSuportada || biometriaProcessando) return;
    setBiometriaProcessando(true);
    setBiometriaMensagem(null);
    try {
      const challenge = new Uint8Array(32);
      const userId = new Uint8Array(16);
      crypto.getRandomValues(challenge);
      crypto.getRandomValues(userId);
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Sra. Luck" },
          user: { id: userId, name: `cliente-local-${Date.now()}`, displayName: "Cliente Sra. Luck" },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
          timeout: 60000,
          attestation: "none",
        },
      });
      if (!(credential instanceof PublicKeyCredential)) throw new Error("Não foi possível registrar a biometria neste aparelho.");
      try {
        localStorage.setItem("sra-luck-biometria-ativa", "true");
        localStorage.setItem("sra-luck-biometria-credential-id", credential.id);
      } catch {}
      setBiometriaAtiva(true);
      setBiometriaMensagem("Biometria ativada neste dispositivo.");
    } catch (error) {
      const cancelada = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
      setBiometriaMensagem(cancelada ? "Ativação cancelada." : "Não foi possível ativar a biometria neste dispositivo.");
      if (!cancelada) registrarErro({ mensagem: error instanceof Error ? error.message : "Falha ao ativar biometria", nivel: "warn", codigo: "CLIENT_BIOMETRIC_ENABLE_FAILED", action: "client.security.biometric.enable" });
    } finally {
      setBiometriaProcessando(false);
    }
  }

  function desativarBiometria() {
    try {
      localStorage.removeItem("sra-luck-biometria-ativa");
      localStorage.removeItem("sra-luck-biometria-credential-id");
    } catch {}
    setBiometriaAtiva(false);
    setBiometriaMensagem("Biometria desativada neste dispositivo.");
  }

  if (sub === "clube") return <ClubeScreen onVoltar={() => setSub(null)} onIrParcelas={onIrParcelas} />;
  if (sub === "documentos") return <div className="sl-tab pb-6"><SubHeader titulo="Meus documentos" onVoltar={() => setSub(null)} /><div className="px-[18px] pt-4"><div className="rounded-[18px] border border-[#ECE2DF] bg-white p-4"><div className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E9D9D5] bg-[#FFF9F8] text-[#B86575]"><IconeMenu tipo="documentos"/></div><div className="pt-3 font-heading text-[19px] font-semibold text-[#43322F]">Documentos da sua jornada</div><p className="pt-1 text-[10.8px] font-light leading-[1.55] text-[#8D7D79]">Para solicitar uma cópia do contrato, comprovantes ou outro documento, fale com a equipe pelo Atendimento.</p><button type="button" onClick={() => setSub("atendimento")} className="mt-4 w-full rounded-[11px] bg-[#6B1F2E] px-3 py-[10px] text-[10.5px] font-semibold text-white">Ir para Atendimento</button></div></div></div>;
  if (sub === "jornada") return <>{renderJornada(() => setSub(null))}</>;
  if (sub === "atendimento") return <div className="sl-tab pb-6"><SubHeader titulo="Atendimento" onVoltar={() => setSub(null)} /><div className="grid gap-[9px] px-[18px] pt-4">{contato.whatsapp && <a href={`https://wa.me/${contato.whatsapp}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-[17px] border border-[#E5D5D1] bg-white p-[14px]"><span className="sl-more-icon"><IconeMenu tipo="atendimento"/></span><span><span className="block text-[12.5px] font-medium text-[#4B3936]">WhatsApp</span><span className="block pt-[2px] text-[10px] font-light text-[#9A8A86]">Fale agora com a equipe</span></span></a>}{contato.telefone && <a href={`tel:${contato.telefone}`} className="flex items-center gap-3 rounded-[17px] border border-[#E5D5D1] bg-white p-[14px]"><span className="sl-more-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45"><path d="M7.5 3.5 10 8 8 9.5c1.4 2.8 3.7 5.1 6.5 6.5l1.5-2 4.5 2.5c-.4 2.5-2.2 4-4.5 4C9.1 20.5 3.5 14.9 3.5 8c0-2.3 1.5-4.1 4-4.5Z"/></svg></span><span><span className="block text-[12.5px] font-medium text-[#4B3936]">Ligar para a equipe</span><span className="block pt-[2px] text-[10px] font-light text-[#9A8A86]">{contato.telefone}</span></span></a>}{!contato.whatsapp && !contato.telefone && <div className="rounded-[17px] border border-[#ECE2DF] bg-white p-4 text-[10.8px] font-light text-[#8D7D79]">{contatoFalhou ? "Não foi possível carregar os canais de atendimento agora. Tente novamente em instantes." : "Os canais de atendimento ainda não foram configurados pela equipe."}</div>}</div></div>;
  if (sub === "faq") return <div className="sl-tab pb-6"><SubHeader titulo="Dúvidas frequentes" onVoltar={() => setSub(null)} /><div className="grid gap-2 px-[18px] pt-4">{FAQS.map((item) => <FaqItem key={item.pergunta} {...item}/>)}</div></div>;
  if (sub === "configuracoes") return <ConfiguracoesApp onVoltar={() => setSub(null)} />;
  if (sub === "seguranca") return <div className="sl-tab pb-6"><SubHeader titulo="Segurança" onVoltar={() => setSub(null)} /><div className="grid gap-[10px] px-[18px] pt-4"><div className="rounded-[18px] border border-[#ECE2DF] bg-white p-4"><div className="sl-more-icon"><IconeMenu tipo="seguranca"/></div><p className="pt-3 text-[10.8px] font-light leading-[1.55] text-[#7F6F6B]">Seu acesso é feito por CPF e data de nascimento. Nunca compartilhe dados bancários fora dos canais oficiais da Sra. Luck.</p></div><div className="rounded-[18px] border border-[#E7D8D4] bg-white p-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 flex-none items-center justify-center rounded-[13px] bg-[#F7EFED] text-[#7D2434]"><IconeBiometria/></span><div className="min-w-0 flex-1"><div className="text-[12.5px] font-semibold text-[#3F302D]">Ativar biometria</div><div className="pt-[2px] text-[10px] font-light leading-[1.45] text-[#8D7D79]">Use a biometria ou o bloqueio de tela deste aparelho para adicionar uma camada extra de proteção.</div></div></div><button type="button" disabled={biometriaSuportada !== true || biometriaProcessando} onClick={() => { if (biometriaAtiva) desativarBiometria(); else void ativarBiometria(); }} className={`mt-4 w-full rounded-[11px] px-3 py-[10px] text-[10.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${biometriaAtiva ? "border border-[#D8E7DC] bg-[#F1F7F2] text-[#3F7D5B]" : "bg-[#6B1F2E] text-white"}`}>{biometriaProcessando ? "Aguardando biometria…" : biometriaAtiva ? "Biometria ativada · Desativar" : biometriaSuportada === false ? "Biometria indisponível" : biometriaSuportada === null ? "Verificando dispositivo…" : "Ativar biometria"}</button>{biometriaMensagem && <div className={`pt-2 text-[9.8px] font-medium ${biometriaAtiva ? "text-[#4E7B5D]" : "text-[#9A6B64]"}`}>{biometriaMensagem}</div>}</div><button type="button" onClick={onSair} className="w-full rounded-[11px] border border-[#EAD0CF] bg-[#FBF0EF] px-3 py-[10px] text-[10.5px] font-semibold text-[#8F2A25]">Encerrar acesso com segurança</button></div></div>;

  const itens = [
    { id: "clube" as const, nome: "Clube de vantagens", subtitulo: "Presentes e experiências para sua jornada" },
    { id: "documentos" as const, nome: "Meus documentos", subtitulo: "Contrato e documentos da sua jornada" },
    { id: "jornada" as const, nome: "Jornada", subtitulo: "Do contrato à sua cirurgia, passo a passo" },
    { id: "atendimento" as const, nome: "Atendimento", subtitulo: "Fale com a equipe Sra. Luck" },
    { id: "faq" as const, nome: "Dúvidas frequentes", subtitulo: "Respostas rápidas para as perguntas mais comuns" },
    { id: "configuracoes" as const, nome: "Configurações", subtitulo: "Aplicativo e notificações deste celular" },
    { id: "seguranca" as const, nome: "Segurança", subtitulo: "Acesso, privacidade e proteção dos seus dados" },
  ];

  return <div className="sl-tab pb-5"><div className="px-5 pt-[calc(max(env(safe-area-inset-top),0px)+18px)]"><img src="/brand/sra-luck-logo.png" alt="Sra. Luck" className="mb-[13px] w-[91px] object-contain" /><div className="font-heading text-[29px] font-semibold leading-[1.1] text-[#2E2422]">Mais</div><div className="pt-1 text-[13px] font-light text-[#8A7B77]">Tudo o que você precisa, em um só lugar.</div></div><div className="sl-more-profile"><ProfilePhotoPicker fallback={iniciais(nomeCliente)} avatarClassName="sl-more-avatar relative flex items-center justify-center overflow-hidden" cameraClassName="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#6B1F2E] text-[#FBF7F5] shadow-sm" imageAlt="Foto de perfil" /><div className="min-w-0"><div className="truncate font-heading text-[21px] font-semibold leading-[1.15] text-[#2E2422]">{nomeCliente}</div><div className="sl-active-pill"><span className="h-[5px] w-[5px] rounded-full bg-[#3F7D5B]"/>Plano ativo</div></div></div><div className="sl-more-menu">{itens.map((item) => <button key={item.id} type="button" onClick={() => setSub(item.id)} className="sl-more-item"><span className="flex min-w-0 items-center gap-3"><span className="sl-more-icon"><IconeMenu tipo={item.id}/></span><span className="min-w-0"><span className="sl-more-name block">{item.nome}</span><span className="sl-more-sub block truncate">{item.subtitulo}</span></span></span><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#C8B9B5" strokeWidth="1.15"><path d="M5 3l4 4-4 4"/></svg></button>)}<button type="button" onClick={onSair} className="sl-more-item border-b-0"><span className="flex items-center gap-3"><span className="sl-more-icon"><IconeMenu tipo="sair"/></span><span><span className="sl-more-name block">Sair</span><span className="sl-more-sub block">Encerrar acesso com segurança</span></span></span><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#C8B9B5" strokeWidth="1.15"><path d="M5 3l4 4-4 4"/></svg></button></div></div>;
}
