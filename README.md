# Sra. Luck — Cirurgia Programada

Sistema de agendamento para a Sra. Luck: a cliente entra com **CPF + data de
nascimento** e escolhe, dentre as datas liberadas pela clínica, o dia da sua
cirurgia — sem links, sem senha para lembrar. O admin cadastra as clientes,
libera as datas com as vagas de cada dia e acompanha o orçamento do mês
(meta de R$ 100.000, que fica vermelha se for ultrapassada).

## 1. Pré-requisitos
- Node.js 18 ou superior
- Uma conta gratuita em https://supabase.com

## 2. Configurar o Supabase
1. Crie um projeto novo no Supabase.
2. Vá em **SQL Editor > New query**, cole todo o conteúdo de
   `supabase/schema.sql` e clique em **Run**.
3. Vá em **Authentication > Users > Add user** e crie o usuário do admin
   (o e-mail/senha que a equipe vai usar para entrar em `/admin/login`).
4. Vá em **Project Settings > API** e copie:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role key` → `SUPABASE_SERVICE_ROLE_KEY` (nunca exponha essa
     chave no navegador — ela só é usada nas rotas de servidor)

## 3. Configurar o projeto
1. Copie `.env.local.example` para `.env.local` e preencha os valores acima.
2. Em `CLIENTE_SESSION_SECRET`, gere uma string aleatória longa (por
   exemplo, rode `openssl rand -hex 32` no terminal) — ela assina a sessão
   de login da cliente.

## 4. Rodar localmente
```bash
npm install
npm run dev
```
Acesse:
- `http://localhost:3000` — página inicial
- `http://localhost:3000/login` — acesso da cliente (CPF + nascimento)
- `http://localhost:3000/admin/login` — acesso da equipe

## 5. Fluxo de uso
1. No painel admin, cadastre a cliente em **Clientes**: nome completo, CPF,
   data de nascimento e o valor do contrato dela.
2. Em **Agenda**, clique num dia do calendário para liberá-lo e definir
   quantas vagas ele tem.
3. A cliente entra em `/login` com CPF + data de nascimento e escolhe uma
   das datas liberadas — ao confirmar, ela vê uma tela de celebração com a
   data escolhida.
4. No **Painel**, acompanhe a barra de orçamento do mês: soma o valor de
   contrato de cada cliente agendada e fica vermelha se passar de
   R$ 100.000 (ela nunca bloqueia o agendamento, é só um alerta visual).

## Estrutura
- `src/app/admin` — painel administrativo (protegido por Supabase Auth)
- `src/app/agenda` e `src/app/login` — área da cliente (sessão própria por
  CPF + nascimento, sem usar o Supabase Auth)
- `src/app/api` — rotas de servidor que fazem todo o acesso ao banco
- `supabase/schema.sql` — schema completo do banco de dados

## Automação de notificações

A automação de parcelas atrasadas foi integrada ao painel em **Notificações → Automação**.

1. Execute `supabase/migration_013_notificacoes_automaticas.sql` no SQL Editor do Supabase.
2. Configure `NOTIFICACOES_APP_URL=http://localhost:3000` e `NOTIFICACOES_CRON_SECRET=<segredo-forte>` no ambiente.
3. Com o Next.js rodando, inicie o worker com `npm run notificacoes`.
4. O worker verifica a cada 30 minutos; o intervalo definido no painel é aplicado por parcela, evitando reenvios antes da hora.
5. Os envios ficam registrados em `notificacao_logs`, com cliente, data, tipo e status.

O botão **Verificar atrasos agora** permite executar a mesma rotina manualmente pelo painel.

### Desempenho
- Execute `supabase/migration_014_performance.sql` no Supabase para aplicar os índices de desempenho.

## Notificações do sistema no celular (Web Push)

A área da cliente agora pode pedir permissão para notificações do sistema e registrar o dispositivo para receber Web Push mesmo com o app em segundo plano/fechado.

### Configuração no PC que roda o servidor

1. Instale a nova dependência:
   `npm install`
2. Gere as chaves VAPID:
   `npm run gerar-vapid`
3. Coloque no `.env.local`:
   - `WEB_PUSH_VAPID_SUBJECT=mailto:seu-email@empresa.com`
   - `WEB_PUSH_VAPID_PUBLIC_KEY=...`
   - `WEB_PUSH_VAPID_PRIVATE_KEY=...`
4. Execute a migration `supabase/migration_015_web_push.sql` no Supabase.
5. Reinicie o Next.js.

### Requisitos do celular

Web Push exige contexto seguro. Para teste pela rede Wi-Fi usando `http://192.168.x.x:3000`, o site pode abrir normalmente, mas o navegador normalmente **não permite Push/Notificações do sistema nesse endereço HTTP**. Para receber notificações com o app fechado, use HTTPS ou um ambiente de desenvolvimento considerado seguro pelo navegador. No iPhone/iPad, o Web Push funciona para o app web instalado na Tela de Início (iOS/iPadOS 16.4+).

A permissão é solicitada por um botão dentro da área da cliente. Depois de autorizada, a assinatura fica vinculada à cliente e ao dispositivo. Os envios manuais, automáticos de parcelas atrasadas e de previsão de liberação usam essa assinatura.

## UI

O painel administrativo e a área da cliente foram ajustados para uma apresentação mais compacta e organizada, com redução agressiva de espaçamentos e elementos visuais. O resumo **Orçamento das próximas liberações** foi removido da Agenda de Liberação.

<!-- deploy trigger: 2026-08-20 -->
