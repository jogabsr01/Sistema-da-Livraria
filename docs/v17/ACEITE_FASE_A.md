# Resultado e aceite — Fase A

## Entrega de código

- Auditoria e ADR da arquitetura, limites de Sheets/Apps Script, isolamento e sequência por aprovação.
- Modelo completo das 14 abas solicitadas, três tabelas auxiliares justificadas e campos aditivos para segurança.
- Provisionamento **somente DEV**, criação de pastas e schema, backup antes da migração, checagem de cabeçalhos/fingerprint e reexecução idempotente.
- Adaptador Node ↔ Apps Script com HMAC, tempo/nonce persistente, correlação de resposta, permissões e bindings de ambiente/instalação/recursos.
- API de metadados fechada por padrão e ainda sem identidade real. Liveness público não expõe configuração nem comprova Google readiness.
- Validação dry-run de importação exclusivamente de produtos/nichos DEV. Nenhuma importação/gravação de clientes ou vendas reais.
- Build allowlist em `dist/`, separando conteúdo público de backend/configuração. Protótipo inalterado. Netlify executa a suíte Node antes de publicar o build.
- Guias de autorização, instalação, API, segurança e recuperação.

## Verificação executada

| Verificação | Resultado e alcance |
| --- | --- |
| `npm test` e suíte no Node 22.23.4 | 26 testes backend/contrato, incluindo subcenários; sem falhas |
| Build no Node 22.23.4 | Passou; somente `index.html` e `teste-dev.txt` publicados |
| Build em Node 24 da máquina | Passou; Node 22 também foi instalado de artefato oficial com SHA-256 conferido |
| Regressão do HTML em `dist/` com Playwright/Chromium | 26 testes aprovados da base `dev`; PINs, capas, leitor, cadastro, estoque, venda fictícia, perfis, Relatórios, mobile e indicador |
| Byte comparison do frontend | `dist/index.html` idêntico ao `index.html` de `dev`; nenhum diff do fonte |
| Schema gerado | Igual ao JSON revisado; teste não regenera o arquivo para mascarar divergência |
| Integração HTTP local | Function com identidade de teste → adaptador assinado → emulador Apps Script → resposta assinada; não é integração Google real |
| Migrações | Criação, repetição sem duplicação, cópia antes da primeira escrita, retomada após falha, preservação de dados, conflito/hash/ambiente/sharing/lock recusados |
| Segurança do contrato | Sem autenticação falsa por PIN; papel inválido/atendente e MFA insuficiente recusados; assinatura adulterada, replay, expiração, ambiente/recursos errados e redirect inseguro recusados |
| Importação | Manifesto válido só produz contagens/hash; PII de clientes/vendas, duplicatas, ISBN inválido, referência ausente, fórmula e valores inválidos recusados |
| `git diff --check` e sintaxe | Aprovados |

Os testes backend usam doubles de Drive/Sheets/LockService em VM, identificados no código. Não provam IAM, persistência/quota Google ou interleaving de projetos Apps Script diferentes. O teste HTTP usa servidor local real, mas seu adaptador Google é emulado. Os testes de navegador usam bibliografia/falhas simuladas e câmera virtual conforme a documentação da suíte existente. Não se afirma uso de dados pessoais reais ou câmera física.

## Pendente de autorização/ambiente externo

- Criar o projeto/identidade e instalação Google DEV com o consentimento do proprietário, executar o provisionamento e repetir a inspeção no Google real.
- Validar IAM, ausência de acesso DEV a PROD, sharing nominal, backup e restauração reais, quotas/latência e comportamento de LockService/ContentService no ambiente contratado.
- Revisar/configurar variáveis privadas por contexto no Netlify, mantendo backend desativado até a identidade estar implementada. Nenhuma chave deve ser enviada ao chat ou ao GitHub.
- Validar a publicação Netlify após aprovação/merge; o endereço DEV vinha exigindo login (HTTP 401) e não foi usado como evidência de funcionamento desta fundação.

A variável genérica de credencial Google presente na máquina não foi assumida como identidade da livraria. Não existia binding declarado nem identificação dos recursos da instalação. Nenhum token foi extraído ou impresso para preencher essa lacuna.

## Não implementado nesta fase

Persistência compartilhada operacional, login real/convites/PIN/MFA/passkeys/sessões, SUPER_ADMIN, usuários/perfil/avatar, venda transacional/journal/projeções, sincronização, uploads Drive de negócios, auditoria funcional, notificações, escalas, nichos gerenciáveis, relatórios integrados e checkout anônimo. São os itens das fases B–E; o schema e plano não significam que eles já funcionam.

## Critério para avançar

Revisar e aprovar o PR exclusivo para `dev`. Nenhum merge automático. A execução Google DEV depende da autorização descrita no guia e é condição para declarar a fundação externamente instalada. Não avançar às fases B–E nem ativar operação real sem aprovação e testes próprios. PROD não será provisionada por esta entrega.
