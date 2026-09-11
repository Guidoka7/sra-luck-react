import { AgendaPage } from "../../pages/AgendaPage";

/**
 * Compatibilidade para imports antigos.
 *
 * A experiência oficial da cliente permanece a AgendaPage, que preserva o
 * design Sra. Luck, o fluxo de boletos/comprovantes e a tela Minha Agenda.
 * Novas regras de negócio devem ser incorporadas nessa experiência sem criar
 * um segundo aplicativo visual paralelo.
 */
export function ClientCreditApp() {
  return <AgendaPage />;
}
