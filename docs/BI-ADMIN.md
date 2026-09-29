# BI no Admin — primeiro incremento

Classificação NOVO. Rota `/admin/bi`; menu Gestão → Inteligência de negócio.

Implementado:
- Seis áreas: visão geral, marketing, SDR, comercial, financeiro e qualidade.
- Endpoint somente leitura `/api/admin/bi/overview?periodo=AAAA-MM`.
- Sessão administrativa, colaborador ativo e permissão `relatorios.visualizar` exigidos no servidor; mesma permissão na navegação.
- Contagens exatas (`head:true,count:exact`) de cadastros no mês, fila local aguardando cadastro, clientes sem `vendedora_id` e quatro status contratuais. Nenhuma leitura paginada truncada usada como total.
- Filtro mensal aplica somente a cadastros; demais contagens são posição atual, com legenda explícita.
- Consultas independentes: erro é `null`/Indisponível, nunca zero. Não expõe registros pessoais nem mensagens internas do banco.
- Interface com modo claro/escuro pelos tokens do Admin, navegação por área preservada na URL, atualização e link para relatórios operacionais existentes.

Não implementado neste incremento:
- Coleta completa RD, Conta Azul, agentes ou n8n.
- Indicadores financeiros externos, atribuição de marketing ou rankings por vendedora/SDR.
- Drill-down e fila de correção do BI.

Essas áreas exibem indisponibilidade explícita, sem números fictícios. Não usar contagens locais como universo completo da empresa. A especificação está no Console: `docs/bi/ARQUITETURA.md`, PR #6.

Sem migração, escrita de dados reais, alterações na importação de clientes ou credenciais.

Validação: TypeScript frontend/worker, build e testes de autorização, mês inválido, recusa de escrita, contagem acima de 1000 registros e falha parcial. Conferência visual por navegador bloqueada neste ambiente (`ERR_BLOCKED_BY_CLIENT` no localhost); não declarar QA visual aprovado. Fixture exclusivamente local e descartável, nunca incluída no runtime.

Base de código: produção atual (main 852b85e), numa branch própria. A develop histórica diverge em telas antigas e produziu conflitos fora do BI; a tentativa de mesclá-la foi abortada. Nenhum commit histórico ou arquivo de produção foi substituído para resolver isso.

Rollback: reverter o commit deste incremento. Não há schema novo.
