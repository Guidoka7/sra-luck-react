# DEV Builder — arquitetura do editor visual

O DEV Builder não salva CSS livre. A configuração versionada separa conteúdo, template, frame responsivo, layout interno, estilo, motion e data binding.

## Liberdade de composição

Cada componente possui frames independentes para desktop, tablet e mobile (`x`, `y`, `width`, `height`, `zIndex`). O editor permite mover e redimensionar diretamente no canvas, editar valores numericamente, alinhar ao canvas e usar snap configurável. Listas e containers possuem layout interno `free`, `stack` ou `grid`, com direção, gap, colunas, alinhamento e padding.

Isso permite alterar posição, tamanho e composição sem converter a interface em CSS arbitrário e sem desacoplar dados/regras do componente.

## Publicação Git -> branch develop

`POST /api/admin/dev-builder/publish` valida o documento e, quando o Worker possui `DEV_BUILDER_GITHUB_TOKEN`, usa a Contents API do GitHub para criar um commit diretamente na branch `develop`, atualizando apenas:

`src/features/dev-builder/generated/builder-config.json`

O token fica somente no Worker. O frontend nunca recebe a credencial. O endpoint exige sessão administrativa e, nesta fase, cargo `administrativo`.

Variáveis do Worker:

- `DEV_BUILDER_GITHUB_TOKEN` — secret com acesso restrito ao repositório;
- `DEV_BUILDER_REPOSITORY` — opcional, padrão `Guidoka7/sra-luck-react`;
- `DEV_BUILDER_CONFIG_PATH` — opcional, mantém o caminho acima.

A branch é deliberadamente fixa em `develop` nesta fase. Promoção para `main` continua fora do Builder e segue o fluxo de validação do repositório.

## Segurança

O backend rejeita documento excessivamente grande, IDs inválidos, payloads com chaves perigosas (`script`, `javascript`, `dangerouslySetInnerHTML`, `rawCss`) e publicação cross-site. O endpoint de status expõe apenas configuração não sensível.
