"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bell, CalendarDays, Cable, Check, ChevronRight, LockKeyhole, RotateCcw, Save, ShieldCheck, Smartphone, Users } from "lucide-react";
import styles from "./AdminWorkspace.module.css";
import { useRegrasApp } from "@/lib/regrasOperacionais";

type WorkspaceTab = "geral" | "agenda" | "elegibilidade" | "notificacoes" | "equipe" | "permissoes";
type Config = { meta_orcamento_mensal?: number };
type Colaborador = { id:string; nome:string; email:string; cargo:string; ativo:boolean; permissoes?:string[] };
type Integracao = { id:string; nome:string; detalhes:string; conexaoLiveVerificada:boolean; estado:string };
type NotifConfig = { atraso_habilitado?:boolean; frequencia_atraso_horas?:number; max_tentativas?:number };

export function AdminSettingsOverview({ onNavigate }: { onNavigate: (tab: WorkspaceTab) => void }) {
  const [config,setConfig]=useState<Config>({});
  const [original,setOriginal]=useState<Config>({});
  const [staff,setStaff]=useState<Colaborador[]>([]);
  const [integracoes,setIntegracoes]=useState<Integracao[]>([]);
  const [notif,setNotif]=useState<NotifConfig>({});
  const [salvando,setSalvando]=useState(false);
  const [configDisponivel,setConfigDisponivel]=useState(false);
  const [feedback,setFeedback]=useState<string|null>(null);
  // Regras protegidas (regras_operacionais): o Admin só vê; somente o Dev altera, pelo Dev Console.
  const regras=useRegrasApp(true);
  const pct=(v:number)=>`${Number(v).toLocaleString("pt-BR",{maximumFractionDigits:2})}%`;

  useEffect(()=>{
    let ativo=true;
    const ler=async(url:string)=>{
      const r=await fetch(url,{cache:"no-store"});
      const body=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(body?.erro||"Não foi possível carregar este módulo.");
      return body;
    };
    Promise.allSettled([
      ler("/api/admin/configuracoes"),
      ler("/api/admin/staff"),
      ler("/api/admin/integrations/status"),
      ler("/api/admin/notificacoes/automacao"),
    ]).then(resultados=>{
      if(!ativo)return;
      if(resultados[0].status==="fulfilled"){
        const cfg=resultados[0].value?.configuracoes ?? {};
        setConfig(cfg);setOriginal(cfg);setConfigDisponivel(true);
      }else{
        setConfigDisponivel(false);
      }
      if(resultados[1].status==="fulfilled")setStaff(resultados[1].value?.colaboradores ?? []);
      if(resultados[2].status==="fulfilled")setIntegracoes(resultados[2].value?.integracoes ?? []);
      if(resultados[3].status==="fulfilled")setNotif(resultados[3].value?.config ?? {});
      const falhas=resultados.filter(r=>r.status==="rejected").length;
      if(falhas)setFeedback(falhas===4?"Não foi possível carregar as configurações agora.":`${falhas} módulo(s) não puderam ser carregados; os demais dados continuam disponíveis.`);
    });
    return()=>{ativo=false};
  },[]);

  async function salvar(){
    if(!configDisponivel){setFeedback("Recarregue a página antes de salvar: a configuração principal não foi carregada.");return;}
    setSalvando(true);setFeedback(null);
    try{
      const r=await fetch("/api/admin/configuracoes",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        metaOrcamentoMensal:Number(config.meta_orcamento_mensal ?? 0),
      })});
      const body=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(body?.erro||"Não foi possível salvar.");
      const next=body.configuracoes ?? config;
      setConfig(next);setOriginal(next);setFeedback("Alterações salvas.");
    }catch(e){setFeedback(e instanceof Error?e.message:"Não foi possível salvar.");}
    finally{setSalvando(false);}
  }

  function restaurarPadrao(){setConfig(v=>({...v,meta_orcamento_mensal:100000}));setFeedback("Padrão carregado. Salve para aplicar.");}

  const webPush=integracoes.find(i=>i.id==="web_push");
  const ativos=staff.filter(s=>s.ativo);
  const integracoesVisiveis=integracoes.slice(0,4);
  const sujo=Number(config.meta_orcamento_mensal??0)!==Number(original.meta_orcamento_mensal??0);

  return <div className={styles.overview}>
    <div className={styles.overviewActions}>
      <div>{feedback&&<span className={styles.feedback}>{feedback}</span>}</div>
      <div className={styles.actionButtons}>
        <button type="button" onClick={restaurarPadrao}><RotateCcw size={15}/>Restaurar padrão</button>
        <button type="button" className={styles.saveButton} disabled={salvando||!sujo||!configDisponivel} onClick={()=>void salvar()}><Save size={15}/>{salvando?"Salvando…":"Salvar alterações"}</button>
      </div>
    </div>

    <div className={styles.settingsGrid}>
      <section className={styles.settingsCard}>
        <div className={styles.cardTitle}><span><CalendarDays size={20}/></span><div><h2>Agenda e operação</h2><p>Configure parâmetros reais do planejamento e da liberação.</p></div></div>
        <SettingRow title="Referência mensal de orçamento" desc="Valor usado nos painéis de previsão e planejamento."><div className={styles.moneyInput}><span>R$</span><input type="number" min={0} value={Number(config.meta_orcamento_mensal??0)} onChange={e=>setConfig(v=>({...v,meta_orcamento_mensal:Number(e.target.value)||0}))}/></div></SettingRow>
        <SettingRow title="Prazo automático após comparecimento + quitação" desc="Regra operacional protegida no fluxo cirúrgico."><Travado><span className={styles.fixedValue}>{regras.prazoLiberacaoDiasUteis} {regras.prazoLiberacaoDiasUteis===1?"dia útil":"dias úteis"} <LockKeyhole size={12}/></span></Travado></SettingRow>
        <SettingRow title="Teto mensal operacional" desc="Protegido transacionalmente na confirmação e na reserva da cirurgia."><Travado><span className={styles.fixedValue}>{Number(regras.tetoMensalOperacional??100000).toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0})} <LockKeyhole size={12}/></span></Travado></SettingRow>
      </section>

      <section className={styles.settingsCard}>
        <div className={styles.cardTitle}><span><ShieldCheck size={20}/></span><div><h2>Regras de elegibilidade</h2><p>Critérios V46 usados para liberar a próxima etapa.</p></div></div>
        <SettingRow title="12x, 18x e 24x" desc="Percentual mínimo de parcelas pagas."><Travado><span className={styles.rulePill}>{pct(regras.percentual12a24x)} <LockKeyhole size={11}/></span></Travado></SettingRow>
        <SettingRow title="36x" desc="Percentual mínimo de parcelas pagas."><Travado><span className={styles.rulePill}>{pct(regras.percentual36x)} <LockKeyhole size={11}/></span></Travado></SettingRow>
        <SettingRow title="48x, 60x e 72x" desc="Percentual mínimo de parcelas pagas."><Travado><span className={styles.rulePill}>{pct(regras.percentual48a72x)} <LockKeyhole size={11}/></span></Travado></SettingRow>
        <SettingRow title="Solicitação da cliente obrigatória" desc="Atingir o percentual não move a cliente automaticamente."><Travado estrutural><Switch checked readOnly/></Travado></SettingRow>
      </section>

      <section className={styles.settingsCard}>
        <div className={styles.cardTitle}><span><Smartphone size={20}/></span><div><h2>Acesso ao app da cliente</h2><p>Requisitos reais para liberar o acesso ao aplicativo.</p></div></div>
        <SettingRow title="CPF válido e data de nascimento" desc="Dados obrigatórios antes da liberação do app."><Travado estrutural><Switch checked readOnly/></Travado></SettingRow>
        <SettingRow title="Ao menos 1 parcela persistida" desc="O financeiro precisa existir para liberar o acesso."><Travado><Switch checked={regras.appExigeParcela!==false} readOnly/></Travado></SettingRow>
        <SettingRow title={regras.appExigeProcedimento?"Procedimento é requisito":"Procedimento não é requisito"} desc={regras.appExigeProcedimento?"O acesso só é liberado depois de definir o procedimento.":"O acesso pode ser liberado mesmo antes de definir o procedimento."}><Travado><Switch checked readOnly/></Travado></SettingRow>
        <SettingRow title="Liberação controlada pelo Admin" desc="O botão de liberação continua disponível no Perfil da cliente."><Travado estrutural><Switch checked readOnly/></Travado></SettingRow>
      </section>

      <section className={styles.settingsCard}>
        <div className={styles.cardTitle}><span><Bell size={20}/></span><div><h2>Notificações e mensagens</h2><p>Estado atual da automação e do canal Web Push.</p></div></div>
        <SettingRow title="Web Push" desc={webPush?.detalhes||"Canal de notificações do aplicativo."}><Switch checked={Boolean(webPush?.conexaoLiveVerificada)} readOnly/></SettingRow>
        <SettingRow title="Automação de parcelas" desc="Lembretes de vencimento e atraso."><Switch checked={Boolean(notif.atraso_habilitado)} readOnly/></SettingRow>
        <SettingRow title="Frequência de atraso" desc="Intervalo configurado entre novas tentativas."><span className={styles.fixedValue}>{Number(notif.frequencia_atraso_horas??24)}h</span></SettingRow>
        <button type="button" className={styles.manageLink} onClick={()=>onNavigate("notificacoes")}>Gerenciar mensagens <ChevronRight size={14}/></button>
      </section>
    </div>

    <div className={styles.summaryGrid}>
      <section className={styles.summaryCard}>
        <div className={styles.summaryHead}><div className={styles.cardTitle}><span><Users size={20}/></span><div><h2>Equipe e responsáveis</h2><p>Gerencie membros da equipe e suas funções.</p></div></div><button type="button" onClick={()=>onNavigate("equipe")}>Ver todos <ChevronRight size={13}/></button></div>
        <div className={styles.miniTable}>
          <div className={styles.tableHead}><span>Nome</span><span>Função</span><span>Acesso</span><span>Status</span></div>
          {ativos.slice(0,4).map(s=><button type="button" key={s.id} className={styles.tableRow} onClick={()=>onNavigate("equipe")}><span><i>{s.nome.split(/\s+/).slice(0,2).map(p=>p[0]).join("").toUpperCase()}</i>{s.nome}</span><span>{s.cargo}</span><span className={styles.accessPill}>{s.permissoes?.length?"Personalizado":"Padrão"}</span><span className={styles.online}>● Ativo</span></button>)}
        </div>
      </section>

      <section className={styles.summaryCard}>
        <div className={styles.summaryHead}><div className={styles.cardTitle}><span><Cable size={20}/></span><div><h2>Integrações</h2><p>Status das conexões com serviços externos.</p></div></div><span className={styles.fixedValue} title="Chaves e configurações das integrações são gerenciadas pelo Dev.">Status <LockKeyhole size={11}/></span></div>
        <div className={styles.integrationList}>
          {integracoesVisiveis.map(i=><div key={i.id} className={styles.integrationRow}><span className={styles.integrationIcon}>{i.nome.slice(0,2).toUpperCase()}</span><span><strong>{i.nome}</strong><small>{i.detalhes}</small></span><em data-on={i.conexaoLiveVerificada}>{i.conexaoLiveVerificada?"Conectado":"Não conectado"}</em></div>)}
        </div>
      </section>
    </div>
  </div>;
}
/** Valor protegido: o Admin vê, mas só o Dev altera (Dev Console). Estrutural = regra fixa do sistema. */
function Travado({children,estrutural=false}:{children:ReactNode;estrutural?:boolean}){return <span title={estrutural?"Regra estrutural do sistema.":"Valor protegido."} style={{display:"inline-flex",cursor:"help"}}>{children}</span>;}
function SettingRow({title,desc,children}:{title:string;desc:string;children:ReactNode}){return <div className={styles.settingRow}><div><strong>{title}</strong><small>{desc}</small></div><div>{children}</div></div>;}
function Switch({checked,onClick,readOnly=false}:{checked:boolean;onClick?:()=>void;readOnly?:boolean}){return <button type="button" aria-pressed={checked} disabled={readOnly} className={styles.switch} data-on={checked} onClick={onClick}><span>{checked&&readOnly?<Check size={11}/>:null}</span></button>;}
