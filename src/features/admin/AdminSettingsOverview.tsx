"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bell, CalendarDays, Cable, Check, ChevronRight, LockKeyhole, RotateCcw, Save, ShieldCheck, Smartphone, Users } from "lucide-react";
import styles from "./AdminWorkspace.module.css";

type WorkspaceTab = "geral" | "agenda" | "elegibilidade" | "notificacoes" | "equipe" | "permissoes" | "integracoes" | "monitoramento";
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
  const [feedback,setFeedback]=useState<string|null>(null);

  useEffect(()=>{
    let ativo=true;
    Promise.allSettled([
      fetch("/api/admin/configuracoes",{cache:"no-store"}).then(r=>r.json()),
      fetch("/api/admin/staff",{cache:"no-store"}).then(r=>r.json()),
      fetch("/api/admin/integrations/status",{cache:"no-store"}).then(r=>r.json()),
      fetch("/api/admin/notificacoes/automacao",{cache:"no-store"}).then(r=>r.json()),
    ]).then(resultados=>{
      if(!ativo)return;
      const cfg=resultados[0].status==="fulfilled" ? resultados[0].value?.configuracoes ?? {} : {};
      setConfig(cfg);setOriginal(cfg);
      if(resultados[1].status==="fulfilled")setStaff(resultados[1].value?.colaboradores ?? []);
      if(resultados[2].status==="fulfilled")setIntegracoes(resultados[2].value?.integracoes ?? []);
      if(resultados[3].status==="fulfilled")setNotif(resultados[3].value?.config ?? {});
    });
    return()=>{ativo=false};
  },[]);

  async function salvar(){
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
        <button type="button" className={styles.saveButton} disabled={salvando||!sujo} onClick={()=>void salvar()}><Save size={15}/>{salvando?"Salvando…":"Salvar alterações"}</button>
      </div>
    </div>

    <div className={styles.settingsGrid}>
      <section className={styles.settingsCard}>
        <div className={styles.cardTitle}><span><CalendarDays size={20}/></span><div><h2>Agenda e operação</h2><p>Configure parâmetros reais do planejamento e da liberação.</p></div></div>
        <SettingRow title="Referência mensal de orçamento" desc="Valor usado nos painéis de previsão e planejamento."><div className={styles.moneyInput}><span>R$</span><input type="number" min={0} value={Number(config.meta_orcamento_mensal??0)} onChange={e=>setConfig(v=>({...v,meta_orcamento_mensal:Number(e.target.value)||0}))}/></div></SettingRow>
        <SettingRow title="Prazo automático após comparecimento + quitação" desc="Regra operacional protegida no fluxo cirúrgico."><span className={styles.fixedValue}>5 dias úteis <LockKeyhole size={12}/></span></SettingRow>
        <SettingRow title="Teto mensal operacional" desc="Protegido transacionalmente na confirmação e na reserva da cirurgia."><span className={styles.fixedValue}>R$ 100.000 <LockKeyhole size={12}/></span></SettingRow>
      </section>

      <section className={styles.settingsCard}>
        <div className={styles.cardTitle}><span><ShieldCheck size={20}/></span><div><h2>Regras de elegibilidade</h2><p>Critérios V46 usados para liberar a próxima etapa.</p></div></div>
        <SettingRow title="12x, 18x e 24x" desc="Percentual mínimo de parcelas pagas."><span className={styles.rulePill}>60% <LockKeyhole size={11}/></span></SettingRow>
        <SettingRow title="36x" desc="Percentual mínimo de parcelas pagas."><span className={styles.rulePill}>70% <LockKeyhole size={11}/></span></SettingRow>
        <SettingRow title="48x, 60x e 72x" desc="Percentual mínimo de parcelas pagas."><span className={styles.rulePill}>80% <LockKeyhole size={11}/></span></SettingRow>
        <SettingRow title="Solicitação da cliente obrigatória" desc="Atingir o percentual não move a cliente automaticamente."><Switch checked readOnly/></SettingRow>
      </section>

      <section className={styles.settingsCard}>
        <div className={styles.cardTitle}><span><Smartphone size={20}/></span><div><h2>Acesso ao app da cliente</h2><p>Requisitos reais para liberar o acesso ao aplicativo.</p></div></div>
        <SettingRow title="CPF válido e data de nascimento" desc="Dados obrigatórios antes da liberação do app."><Switch checked readOnly/></SettingRow>
        <SettingRow title="Ao menos 1 parcela persistida" desc="O financeiro precisa existir para liberar o acesso."><Switch checked readOnly/></SettingRow>
        <SettingRow title="Procedimento não é requisito" desc="O acesso pode ser liberado mesmo antes de definir o procedimento."><Switch checked readOnly/></SettingRow>
        <SettingRow title="Liberação controlada pelo Admin" desc="O botão de liberação continua disponível no Perfil da cliente."><Switch checked readOnly/></SettingRow>
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
        <div className={styles.summaryHead}><div className={styles.cardTitle}><span><Cable size={20}/></span><div><h2>Integrações</h2><p>Conecte o sistema com serviços externos.</p></div></div><button type="button" onClick={()=>onNavigate("integracoes")}>Gerenciar <ChevronRight size={13}/></button></div>
        <div className={styles.integrationList}>
          {integracoesVisiveis.map(i=><button type="button" key={i.id} className={styles.integrationRow} onClick={()=>onNavigate("integracoes")}><span className={styles.integrationIcon}>{i.nome.slice(0,2).toUpperCase()}</span><span><strong>{i.nome}</strong><small>{i.detalhes}</small></span><em data-on={i.conexaoLiveVerificada}>{i.conexaoLiveVerificada?"Conectado":"Configurar"}</em><span>•••</span></button>)}
        </div>
      </section>
    </div>
  </div>;
}
function SettingRow({title,desc,children}:{title:string;desc:string;children:ReactNode}){return <div className={styles.settingRow}><div><strong>{title}</strong><small>{desc}</small></div><div>{children}</div></div>;}
function Switch({checked,onClick,readOnly=false}:{checked:boolean;onClick?:()=>void;readOnly?:boolean}){return <button type="button" aria-pressed={checked} disabled={readOnly} className={styles.switch} data-on={checked} onClick={onClick}><span>{checked&&readOnly?<Check size={11}/>:null}</span></button>;}
