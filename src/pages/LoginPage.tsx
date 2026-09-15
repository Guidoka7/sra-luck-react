import { FormEvent, useState } from "react";
import { apiJson } from "../lib/api";

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
function formatData(value:string){const d=value.replace(/\D/g,"").slice(0,8);if(d.length<=2)return d;if(d.length<=4)return `${d.slice(0,2)}/${d.slice(2)}`;return `${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`}
function paraIso(value:string){const m=value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!m)return null;const dd=Number(m[1]),mm=Number(m[2]),yyyy=Number(m[3]);const dt=new Date(yyyy,mm-1,dd,12);if(dt.getFullYear()!==yyyy||dt.getMonth()!==mm-1||dt.getDate()!==dd||dt>new Date())return null;return `${m[3]}-${m[2]}-${m[1]}`}

export function LoginPage() {
  const[cpf,setCpf]=useState("");const[nascimento,setNascimento]=useState("");const[loading,setLoading]=useState(false);const[erro,setErro]=useState<string|null>(null);
  async function submit(event:FormEvent){event.preventDefault();if(loading)return;const iso=paraIso(nascimento);if(cpf.replace(/\D/g,"").length<11||!iso){setErro("Confira o CPF e a data de nascimento e tente novamente.");return}setErro(null);setLoading(true);try{await apiJson("/api/cliente/auth",{method:"POST",body:JSON.stringify({cpf,dataNascimento:iso})});window.history.pushState({},"","/agenda");window.dispatchEvent(new Event("app:navigate"))}catch(error){setErro(error instanceof Error?error.message:"Não foi possível confirmar seus dados.")}finally{setLoading(false)}}

  return <main className="client-app min-h-[100dvh]">
    <div className="mobile-app-frame">
      <form onSubmit={submit} className="relative flex min-h-[100dvh] flex-col justify-between bg-[#FBF7F5] px-7 pb-[30px] pt-16">
        <div className="pointer-events-none absolute -right-[50px] -top-10 h-[220px] w-[220px] rounded-full bg-[#F7E9E7] opacity-85" />
        <div className="relative"><div className="flex flex-col items-center gap-3"><img src="/brand/sra-luck-logo.png" alt="Sra. Luck — Cirurgia Programada" className="h-auto w-[188px] max-w-[72vw] object-contain"/><div className="text-[11px] font-normal uppercase tracking-[.16em] text-[#9A8C88]">Seu sonho, sua jornada.</div></div></div>

        <div className="relative flex flex-col gap-[14px]">
          <label className="flex flex-col gap-[7px]"><span className="text-[11px] uppercase tracking-[.1em] text-[#9A8C88]">CPF</span><input value={cpf} onChange={e=>setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" autoComplete="username" className="w-full rounded-[14px] border border-[#E6DAD6] bg-white px-4 py-[15px] text-[16px] text-[#2E2422] outline-none focus:border-[#6B1F2E]" required/></label>
          <label className="flex flex-col gap-[7px]"><span className="text-[11px] uppercase tracking-[.1em] text-[#9A8C88]">Data de nascimento</span><input value={nascimento} onChange={e=>setNascimento(formatData(e.target.value))} placeholder="DD/MM/AAAA" inputMode="numeric" autoComplete="bday" className="w-full rounded-[14px] border border-[#E6DAD6] bg-white px-4 py-[15px] text-[16px] text-[#2E2422] outline-none focus:border-[#6B1F2E]" required/></label>
          {erro&&<div role="alert" className="flex items-start gap-[9px] rounded-[12px] border border-[#F0D3D1] bg-[#FBEBEA] px-[14px] py-3"><span className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-[#B3342E]"/><div><div className="text-[13px] font-medium text-[#8F2A25]">Dados inválidos</div><div className="text-[12px] font-light leading-[1.45] text-[#A4635F]">{erro}</div></div></div>}
          <button disabled={loading} type="submit" className="mt-[6px] w-full rounded-[14px] border-0 bg-[#6B1F2E] p-4 text-[15px] font-medium tracking-[.04em] text-[#FBF7F5] transition active:scale-[.99] disabled:opacity-50">{loading?"Entrando…":"Acessar minha área"}</button>
          <div className="pt-[2px] text-center text-[12.5px] font-light text-[#9A8C88]">Precisa de ajuda para acessar?</div>
        </div>

        <div className="flex items-center justify-center gap-2 text-[11px] font-light tracking-[.06em] text-[#B3A6A2]"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>Seus dados protegidos com segurança.</div>
      </form>
    </div>
  </main>;
}
