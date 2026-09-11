# Migration Map — PWA → React + Vite + Cloudflare Worker

Objetivo: impedir que a migração perca comportamento ou replique dívida sem necessidade.

## 1. Regra de migração

Cada funcionalidade deve passar por cinco estados:

1. **LEGADO IDENTIFICADO** — existe no PWA/Next;
2. **MAPEADO** — dependências e regra entendidas;
3. **PORTADO** — equivalente existe no React/Worker;
4. **VALIDADO** — fluxo real foi testado;
5. **LEGADO REMOVÍVEL** — equivalente comprovado e consumidores antigos inexistentes.

Não pular diretamente de 1 para 5.

## 2. Domínios

### Autenticação cliente

Baseline PWA:

- CPF + data de nascimento;
- cookie/sessão própria;
- redirecionamento para agenda.

Destino:

- React login;
- Worker auth/session;
- cookie HttpOnly;
- data de nascimento com seletor profissional;
- mensagens de erro claras.

Estado: **PORTADO/PRECISA VALIDAÇÃO E2E**.

### Autenticação admin

Baseline:

- Supabase Auth no Next.

Destino:

- login administrativo compatível com SPA/Worker;
- autorização explícita por papel/permissão;
- sessão protegida.

Estado: **PORTADO/PRECISA AUDITORIA DE AUTORIZAÇÃO**.

### Cliente — Minha Agenda

Baseline:

- design aprovado;
- termos;
- revisão financeira;
- calendário;
- remarcações;
- cirurgia/previsão histórica.

Destino:

- preservar UX/base visual;
- Worker real;
- jornada nova;
- substituir regra incompatível de 90 dias.

Estado: **MIGRAÇÃO EM ANDAMENTO**.

### Cliente — Meus Boletos

Baseline:

- carnê;
- status;
- boleto;
- PIX;
- upload de comprovante;
- progresso por parcelas.

Destino:

- equivalência visual/funcional;
- Worker;
- providers bancários;
- Mercado Pago;
- conciliação.

Estado: **MIGRAÇÃO EM ANDAMENTO**.

### Clientes/admin

Baseline:

- cadastro/edição;
- dados pessoais;
- valor base;
- taxa administrativa;
- quantidade de parcelas;
- ciclo/agenda.

Destino:

- React admin;
- API Worker;
- contratos/políticas mais explícitos;
- origem/campanha e responsáveis comerciais.

Estado: **PORTADO PARCIALMENTE**.

### Pagamentos/admin

Baseline:

- comprovantes;
- filtros;
- confirmar/rejeitar;
- operação por cliente.

Destino:

- financeiro diário;
- liquidados/vencidos/aguardando/divergências;
- banco + comprovante + Conta Azul.

Estado: **PORTADO PARCIALMENTE / EVOLUÇÃO PENDENTE**.

### Parcelas/admin

Baseline:

- gerar;
- editar abertas;
- suspender;
- reabrir;
- excluir quando permitido;
- histórico.

Destino:

- manter funções;
- integrar provider bancário;
- idempotência;
- trilha financeira consistente.

Estado: **PORTADO PARCIALMENTE / PRECISA TESTES**.

### Agenda admin

Baseline:

- calendário;
- vagas;
- termos;
- revisão financeira;
- previsão financeira;
- remarcações.

Destino:

- manter UX operacional;
- separar agenda de termos e agenda cirúrgica;
- aplicar regra nova de 5 dias úteis após termos + quitação.

Estado: **PORTADO PARCIALMENTE / REGRA NOVA PENDENTE DE CONSOLIDAÇÃO**.

### Configurações

Baseline:

- identidade;
- orçamento/meta;
- PIX/QR;
- desconto;
- contatos;
- agenda;
- tema.

Destino:

- preservar tudo;
- ampliar cores/tokens/políticas/configurações operacionais;
- persistência real.

Estado: **PORTADO PARCIALMENTE**.

### Notificações

Baseline:

- automação;
- templates;
- envio;
- logs;
- push.

Destino:

- Worker;
- eventos de domínio;
- templates configuráveis;
- canais e logs;
- push homologado.

Estado: **PORTADO PARCIALMENTE / PRECISA PROVA E2E**.

### RD Station

Baseline: inexistente como integração completa.

Destino:

- provider;
- webhook;
- deduplicação;
- campanha/origem;
- criação/conferência de contrato.

Estado: **NOVO**.

### Bancos

Baseline: operação histórica sem adapters completos padronizados.

Destino:

- interface comum;
- BRB, BB, Santander, Sicredi, Efí;
- webhook/liquidação;
- emissão/consulta/operações suportadas.

Estado: **NOVO/EM FUNDAÇÃO**.

### Conta Azul

Destino:

- sincronização de recebíveis/baixas;
- idempotência;
- identificadores externos;
- erro/retry/auditoria.

Estado: **NOVO**.

### Mercado Pago

Destino:

- cartão;
- webhook;
- associação exata à parcela/saldo;
- validação humana inicial.

Estado: **NOVO/EM FUNDAÇÃO**.

### Colaboradores

Destino:

- papéis;
- permissões;
- comissões;
- treinamentos;
- metas.

Estado: **NOVO/EM FUNDAÇÃO**.

### Clube de Vantagens

Destino:

- referrals;
- pontos;
- catálogo;
- resgates;
- histórico.

Estado: **NOVO/EM FUNDAÇÃO**.

## 3. SQL/migrations — regra de segurança

O diretório `supabase/` traz histórico herdado e migrations novas. Existem números repetidos em migrations históricas.

Não renomear arquivos antigos apenas para “organizar” porque eles podem ter sido aplicados em ambientes reais.

Para novas mudanças:

- usar sequência nova e inequívoca;
- registrar propósito;
- preferir `if exists`/`if not exists` quando apropriado;
- evitar alterações destrutivas sem plano;
- criar rollback quando o risco justificar;
- testar em ambiente de desenvolvimento antes de produção.

## 4. Dívidas que só podem ser removidas com evidência

- `src/app/` legado Next;
- `src/middleware.ts`;
- `next.config.js`;
- `netlify.toml` e docs Netlify antigas;
- `src/shims/`;
- adapters de Preview em `api/`;
- handlers antigos duplicados por jornada nova.

A presença desses arquivos é dívida, mas remoção precoce pode quebrar fluxo ainda não mapeado.

## 5. Regra para PR de migração

Toda PR que migra uma função do PWA deve descrever:

- origem no PWA;
- destino no React/Worker;
- comportamento preservado;
- regra alterada propositalmente;
- migrations/RPCs envolvidos;
- testes executados;
- como validar no Preview;
- qual legado passa a ser removível (se houver).

## 6. Meta

Ao final do MVP, o `sra-luck-react` deve ser a única fonte de verdade de runtime. O PWA permanecerá apenas como histórico de referência, não como dependência operacional.