import "./App.css"

function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">SL</div>
          <div>
            <strong>Sra. Luck</strong>
            <span>Gestão e Agenda</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button aria-label="Notificações">🔔</button>
          <div className="user-avatar">G</div>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <nav>
            <button className="nav-item active">Visão geral</button>
            <button className="nav-item">Agenda</button>
            <button className="nav-item">Clientes</button>
            <button className="nav-item">Financeiro</button>
            <button className="nav-item">Parcelas</button>
            <button className="nav-item">Relatórios</button>
            <button className="nav-item">Notificações</button>
            <button className="nav-item">Configurações</button>
          </nav>
        </aside>

        <main className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">PAINEL ADMINISTRATIVO</span>
              <h1>Visão geral</h1>
              <p>Acompanhe a operação da Sra. Luck em um único ambiente.</p>
            </div>
          </div>

          <section className="dashboard-grid">
            <article className="dashboard-card">
              <span>Financeiro</span>
              <strong>Central financeira</strong>
              <p>Parcelas, pagamentos e pendências.</p>
            </article>

            <article className="dashboard-card">
              <span>Agenda</span>
              <strong>Próximos agendamentos</strong>
              <p>Datas liberadas e solicitações.</p>
            </article>

            <article className="dashboard-card">
              <span>Clientes</span>
              <strong>Acompanhamento</strong>
              <p>Clientes e jornada digital.</p>
            </article>

            <article className="dashboard-card">
              <span>Operação</span>
              <strong>Notificações</strong>
              <p>Eventos e comunicações do sistema.</p>
            </article>
          </section>
        </main>
      </div>
    </div>
  )
}

export default App
