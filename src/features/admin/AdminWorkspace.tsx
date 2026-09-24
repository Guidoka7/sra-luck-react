"use client";

import { useEffect, useState } from "react";
import { Bell, Cable, CalendarDays, Gauge, LockKeyhole, Settings2, ShieldCheck, Users } from "lucide-react";
import { ADMIN_PERMISSIONS as P, FINANCE_PERMISSIONS, pode, type AdminAccessProfile } from "@/lib/adminAccess";
import "@/styles/admin-zip.css";
import styles from "./AdminWorkspace.module.css";
import { AdminSettingsPanel } from "./AdminSettingsPanel";
import { AdminSettingsOverview } from "./AdminSettingsOverview";
import AdminNotificacoes from "@/app/admin/(painel)/notificacoes/page";
import MonitoramentoPage from "@/app/admin/(painel)/configuracoes/monitoramento/page";
import EquipeAdminPage from "@/app/admin/(painel)/equipe/page";
import IntegracoesAdminPage from "@/app/admin/(painel)/integracoes/page";

type AbaWorkspace = "geral" | "agenda" | "elegibilidade" | "notificacoes" | "equipe" | "permissoes" | "integracoes" | "monitoramento";
const ABAS: Array<{ id:AbaWorkspace; label:string; icon:typeof Settings2; perms:string[] }> = [
  {id:"geral",label:"Gerais",icon:Settings2,perms:[P.CONFIGURACOES_GERENCIAR]},
  {id:"agenda",label:"Agenda",icon:CalendarDays,perms:[P.AGENDA_GERENCIAR,...FINANCE_PERMISSIONS]},
  {id:"elegibilidade",label:"Elegibilidade",icon:ShieldCheck,perms:[P.AGENDA_GERENCIAR,...FINANCE_PERMISSIONS]},
  {id:"notificacoes",label:"Notificações",icon:Bell,perms:[P.NOTIFICACOES_GERENCIAR]},
  {id:"equipe",label:"Equipe e responsáveis",icon:Users,perms:[P.EQUIPE_GERENCIAR]},
  {id:"permissoes",label:"Permissões",icon:LockKeyhole,perms:[P.EQUIPE_GERENCIAR]},
  {id:"integracoes",label:"Integrações",icon:Cable,perms:[P.INTEGRACOES_GERENCIAR_CREDENCIAIS]},
  {id:"monitoramento",label:"Monitoramento",icon:Gauge,perms:[P.MONITORAMENTO_VISUALIZAR]},
];
function abaDaUrl():AbaWorkspace{
  const path=window.location.pathname;
  if(path.startsWith("/admin/notificacoes"))return"notificacoes";
  if(path==="/admin/configuracoes/monitoramento")return"monitoramento";
  if(path.startsWith("/admin/equipe"))return"equipe";
  if(path.startsWith("/admin/integracoes"))return"integracoes";
  const aba=new URLSearchParams(window.location.search).get("aba");
  return ABAS.some(a=>a.id===aba)?aba as AbaWorkspace:"geral";
}
export function AdminWorkspace(){
  const [aba,setAba]=useState<AbaWorkspace>(abaDaUrl);
  const [acesso,setAcesso]=useState<AdminAccessProfile|null>(null);
  useEffect(()=>{
    const sincronizar=()=>setAba(abaDaUrl());
    window.addEventListener("popstate",sincronizar);
    let ativo=true;
    fetch("/api/admin/session",{cache:"no-store"}).then(r=>r.json()).then(d=>{
      if(!ativo||!d?.autenticado)return;
      setAcesso({cargo:d.cargo??null,permissoes:Array.isArray(d.permissoes)?d.permissoes.filter((p:unknown):p is string=>typeof p==="string"):[],acessoTotal:d.acessoTotal===true});
    }).catch(()=>{});
    return()=>{ativo=false;window.removeEventListener("popstate",sincronizar);};
  },[]);
  function navegar(nova:AbaWorkspace){
    setAba(nova);
    const destino="/admin/configuracoes?aba="+nova;
    if(window.location.pathname+window.location.search!==destino)window.history.pushState({}, "", destino);
    window.dispatchEvent(new Event("app:navigate"));
  }
  const abasPermitidas=ABAS.filter(item=>pode(acesso,...item.perms));
  const abaPermitida=!acesso||abasPermitidas.some(item=>item.id===aba);
  return <div className={["zip-admin",styles.page].join(" ")}>
    <header className={styles.hero}><div><div className={styles.eyebrow}>BEM-VINDA, ADMIN!</div><h1>Configurações</h1><p>Gerencie as regras, integrações e preferências do sistema.</p></div><div className={styles.quote}>Disciplina hoje,<br/>mais histórias amanhã.<span/></div></header>
    <div className={styles.workspace}>
      <nav className={styles.sideNav} aria-label="Seções de Configurações">{abasPermitidas.map(item=><button key={item.id} type="button" data-active={aba===item.id} onClick={()=>navegar(item.id)}><item.icon size={17}/><span>{item.label}</span></button>)}</nav>
      <main className={styles.content}>
        {!abaPermitida&&<div className={styles.eligibilityPanel}><div className={styles.eligibilityHeader}><span><LockKeyhole size={20}/></span><div><h2>Seção sem acesso</h2><p>Seu papel não possui permissão para consultar esta área. Escolha uma seção disponível no menu.</p></div></div></div>}
        {abaPermitida&&aba==="geral"&&<div className={styles.generalStack}>
          <AdminSettingsOverview onNavigate={navegar}/>
          <details className={styles.institutionalDetails}>
            <summary><span>Empresa, aparência e PIX</span><small>Preferências institucionais e de recebimento</small></summary>
            <div className={styles.institutionalBody}><AdminSettingsPanel/></div>
          </details>
        </div>}
        {abaPermitida&&aba==="agenda"&&<AgendaRulesPanel/>}
        {abaPermitida&&aba==="elegibilidade"&&<EligibilityPanel/>}
        {abaPermitida&&aba==="notificacoes"&&<AdminNotificacoes/>}
        {abaPermitida&&(aba==="equipe"||aba==="permissoes")&&<EquipeAdminPage/>}
        {abaPermitida&&aba==="integracoes"&&<IntegracoesAdminPage/>}
        {abaPermitida&&aba==="monitoramento"&&<MonitoramentoPage/>}
      </main>
    </div>
  </div>;
}
function AgendaRulesPanel(){
  const regras=[
    ["Condições para iniciar o prazo","Comparecimento confirmado e quitação paga são obrigatórios."],
    ["Prazo automático","5 dias úteis contados a partir da condição concluída por último."],
    ["Ajuste administrativo","+1, +3 ou +5 dias úteis, sempre auditado no histórico."],
    ["Liberação antecipada","Pode ser feita manualmente após comparecimento e quitação, com registro de quem liberou."],
    ["Teto mensal operacional","R$ 100.000 por mês, revalidado transacionalmente na previsão e na reserva da cirurgia."],
    ["Escolha da cirurgia","A cliente só agenda depois que a agenda cirúrgica estiver efetivamente liberada."],
  ];
  return <div className={styles.eligibilityPanel}>
    <div className={styles.eligibilityHeader}><span><CalendarDays size={20}/></span><div><h2>Agenda e liberação cirúrgica</h2><p>Regras V46 atualmente executadas pelo banco. Não há controles decorativos nesta seção.</p></div></div>
    <div className={styles.agendaRules}>{regras.map(([titulo,descricao])=><div key={titulo} className={styles.agendaRule}><div><strong>{titulo}</strong><p>{descricao}</p></div><span><LockKeyhole size={12}/> Regra ativa</span></div>)}</div>
  </div>;
}
function EligibilityPanel(){
  const regras=[["12x","60%"],["18x","60%"],["24x","60%"],["36x","70%"],["48x","80%"],["60x","80%"],["72x","80%"]];
  return <div className={styles.eligibilityPanel}><div className={styles.eligibilityHeader}><span><ShieldCheck size={20}/></span><div><h2>Regras de elegibilidade V46</h2><p>Regras protegidas pelo fluxo operacional. A elegibilidade considera parcelas pagas reais persistidas.</p></div></div><div className={styles.ruleGrid}>{regras.map(([parcelas,pct])=><div key={parcelas}><span>{parcelas}</span><strong>{pct}</strong><small>mínimo pago</small></div>)}</div><div className={styles.ruleNote}><LockKeyhole size={15}/><div><strong>Movimentação não é automática.</strong><p>Mesmo após atingir o percentual, a cliente permanece na etapa até solicitar a liberação financeira no aplicativo.</p></div></div></div>;
}
