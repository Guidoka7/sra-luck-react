import { useEffect, useMemo, useState, type ReactNode } from "react";

interface SessionGateProps {
  audience: "admin" | "cliente";
  children: ReactNode;
}

export function SessionGate({ audience, children }: SessionGateProps) {
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");
  const preview = useMemo(() => new URLSearchParams(window.location.search).get("preview") === "1", []);

  useEffect(() => {
    if (preview) {
      setState("ok");
      return;
    }
    const endpoint = audience === "admin" ? "/api/admin/session" : "/api/cliente/session";
    fetch(endpoint, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return false;
        const data = await response.json().catch(() => ({})) as { autenticado?: boolean };
        return data.autenticado === true;
      })
      .then((ok) => setState(ok ? "ok" : "denied"))
      .catch(() => setState("denied"));
  }, [audience, preview]);

  useEffect(() => {
    if (state !== "denied") return;
    window.location.replace(audience === "admin" ? "/admin/login" : "/login");
  }, [audience, state]);

  if (state === "ok") {
    return <>{preview && <div style={{position:"fixed",right:10,bottom:84,zIndex:9999,background:"#7f6038",color:"white",fontSize:10,padding:"6px 9px",borderRadius:999}}>Modo preview</div>}{children}</>;
  }

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
