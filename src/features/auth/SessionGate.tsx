import { useEffect, useState, type ReactNode } from "react";
import { requestJson } from "../../lib/http";

interface SessionGateProps {
  audience: "admin" | "cliente" | "equipe";
  children: ReactNode;
}

interface SessionResponse {
  autenticado?: boolean;
}

export function SessionGate({ audience, children }: SessionGateProps) {
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    let active = true;
    const endpoint = audience === "admin" ? "/api/admin/session" : audience === "equipe" ? "/api/equipe/session" : "/api/cliente/session";
    requestJson<SessionResponse>(endpoint, { cache: "no-store" }, { timeoutMs: 8_000, retries: 1 })
      .then((data) => {
        if (active) setState(data.autenticado === true ? "ok" : "denied");
      })
      .catch(() => {
        if (active) setState("denied");
      });
    return () => { active = false; };
  }, [audience]);

  useEffect(() => {
    if (state !== "denied") return;
    const login = audience === "admin" ? "/admin/login" : audience === "equipe" ? "/equipe/login" : "/login";
    window.location.replace(login);
  }, [audience, state]);

  if (state === "ok") return <>{children}</>;

  return (
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f7f3eb",fontFamily:"Inter,system-ui"}}>
      <div style={{textAlign:"center",color:"#755b39"}}>
        <img src="/brand/sra-luck-mark.png" alt="Sra. Luck" style={{width:48,height:48,objectFit:"contain",margin:"0 auto 12px"}} />
        <strong style={{display:"block",fontFamily:"Georgia,serif",fontSize:20}}>Validando seu acesso</strong>
        <span style={{fontSize:11,opacity:.65}}>Só um instante...</span>
      </div>
    </main>
  );
}
