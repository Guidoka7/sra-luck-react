# Princípios de produto e experiência — Sra. Luck

Este documento define o que a nova versão precisa transmitir e como avaliar decisões de frontend e fluxo.

## 1. O que o produto deve transmitir

A Sra. Luck deve parecer:

- profissional;
- confiável;
- inteligente;
- organizada;
- acolhedora;
- premium sem ser exagerada;
- simples de usar;
- segura para decisões financeiras;
- clara sobre o próximo passo.

A interface não pode parecer:

- template genérico;
- protótipo de IA;
- app de clínica;
- dashboard cheio de cards sem função;
- sistema confuso de banco tradicional;
- painel bonito mas vazio;
- produto com botões decorativos.

## 2. Intuitivo não significa superficial

A experiência deve simplificar a operação sem esconder o que importa.

Para a cliente, cada tela deve responder rapidamente:

- onde estou na minha jornada?
- o que já foi concluído?
- o que falta?
- existe algo que eu preciso fazer agora?
- existe algo que depende da Sra. Luck?
- qual é o próximo passo?

Para o admin/equipe, cada tela deve responder:

- o que exige atenção?
- qual ação preciso executar?
- quais clientes/parcelas estão afetadas?
- qual é o impacto financeiro/operacional?
- qual histórico preciso consultar?

## 3. Padrão visual

A base visual aprovada do PWA é referência.

Direção:

- identidade Sra. Luck preservada;
- tons claros/creme/branco com burgundy e dourado usados com intenção;
- modo claro e escuro;
- hierarquia tipográfica forte;
- espaçamento consistente;
- bordas, sombras e radius com sobriedade;
- animações discretas e úteis;
- componentes consistentes;
- estados visuais claros para sucesso, atenção, erro, bloqueio e pendência.

Evitar:

- excesso de gradientes;
- excesso de glassmorphism;
- dezenas de badges coloridos;
- cards para qualquer informação;
- ícones sem significado;
- efeitos que diminuam legibilidade;
- redesign que elimine funções aprovadas.

## 4. App da cliente

Mobile-first.

A experiência deve parecer pessoal, simples e guiada.

### Estrutura de referência

- Minha Agenda;
- Meus Boletos;
- jornada/progresso quando fizer sentido;
- notificações;
- Clube de Vantagens conforme evolutivo.

### Boletos

A cliente precisa entender rapidamente:

- qual parcela é;
- valor;
- vencimento;
- status;
- como pagar;
- se enviou comprovante;
- se está em análise;
- se foi confirmado/rejeitado.

Integrações novas não devem tornar esse fluxo mais difícil.

### Agenda

A experiência anterior aprovada é referência visual e de usabilidade.

Agenda deve mostrar apenas opções realmente disponíveis e explicar bloqueios/etapas sem confundir.

## 5. Admin

Desktop-first, responsivo e orientado à operação.

Admin não é uma vitrine. É uma ferramenta de trabalho.

Priorizar:

- busca rápida;
- tabelas legíveis;
- filtros úteis;
- agrupamentos coerentes;
- ações próximas do contexto;
- datas/calendários profissionais;
- drawers/modais somente quando ajudam;
- KPIs que levem a ações reais;
- histórico e auditoria acessíveis;
- densidade adequada de informação.

## 6. Inteligência do produto

"Inteligente" significa reduzir decisão manual e retrabalho com regras confiáveis.

Exemplos:

- detectar automaticamente percentual atingido;
- prever clientes que chegarão à liberação;
- identificar divergências financeiras;
- conciliar webhook e comprovante sem duplicar baixa;
- sugerir próxima ação;
- destacar prioridade real;
- evitar cadastro duplicado;
- conectar dados de campanha ao resultado financeiro;
- mostrar informação contextual, não excesso de informação.

Inteligência não significa inventar informação ou esconder regra em automação opaca.

## 7. Uma ação precisa ter fundamento

Antes de criar CTA/botão/fluxo, definir:

```text
Ação da pessoa
   ↓
Validação
   ↓
API
   ↓
Autorização
   ↓
Regra de negócio
   ↓
Persistência / integração
   ↓
Auditoria/evento
   ↓
Resposta
   ↓
Estado atualizado na tela
```

Se o caminho não existir, a função não está implementada.

## 8. Estados obrigatórios de interface

Toda experiência que carrega dados deve considerar:

- loading;
- sucesso;
- vazio;
- erro;
- sem permissão;
- indisponibilidade temporária quando aplicável.

Toda ação mutável precisa impedir clique repetido/efeito duplicado quando pertinente.

## 9. Linguagem

Usar linguagem clara e humana.

Evitar termos excessivamente técnicos para clientes.

No admin, usar termos operacionais reais da Sra. Luck, sem transformar o negócio em terminologia de clínica.

Mensagens de erro devem dizer o que aconteceu e, quando possível, o que fazer a seguir.

## 10. Maleabilidade

Visual e fluxo devem ser fáceis de modificar sem quebrar todo o sistema.

Para isso:

- tokens centralizados;
- componentes reutilizáveis;
- configurações onde a política muda;
- regras de domínio fora da UI;
- contratos de API claros;
- textos/templates centralizados quando fizer sentido.

## 11. Critério de qualidade visual

Antes de aprovar uma tela:

- parece parte da Sra. Luck?
- é imediatamente compreensível?
- mantém funções da versão anterior que ainda são válidas?
- existe excesso visual sem função?
- a próxima ação é clara?
- funciona bem no dispositivo alvo?
- os estados de erro/vazio/loading são profissionais?
- cada ação visível funciona de ponta a ponta?

## 12. Princípio final

A nova versão deve ser percebida como uma evolução muito superior do sistema que já funcionava — não como outro produto desconectado da Sra. Luck.

O objetivo é unir **beleza, simplicidade, inteligência operacional e engenharia real**.