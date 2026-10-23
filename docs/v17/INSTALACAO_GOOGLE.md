# Instalação DEV e autorização Google

## Estado desta entrega

Nenhum recurso Google ou usuário de produção foi criado. Não há binding Google/Netlify da livraria declarado no ambiente desta tarefa nem IDs de planilha/pasta da instalação. A máquina possui uma variável de credencial Google genérica, mas ela não comprova autorização sobre recursos da livraria e não foi usada para criar/alterar arquivos.

Não enviar credenciais, tokens, PINs, senhas, JSON de conta de serviço ou chaves no chat, GitHub, planilha ou frontend. A autorização abaixo é feita pelo proprietário em interfaces privadas. Os nomes das variáveis estão em `.env.example`; os valores reais ficam no Netlify e em Script Properties.

## 1. Preparar a identidade DEV

Usar uma conta Google DEV dedicada, aprovada pelo responsável, **sem acesso de edição a recursos PROD**. Criar um projeto Apps Script separado. Não reaproveitar um projeto que já escreva na planilha oficial.

O manifest usa Sheets e DriveApp. DriveApp exige escopo amplo de Drive: revisar esse consentimento antes de autorizar e limitar o alcance pela identidade dedicada. Caso a política não permita esse consentimento ou web app acessível ao backend sem login interativo, parar essa instalação e avaliar a alternativa com identidade de serviço/Google APIs descrita na arquitetura. Não desabilitar controles do Workspace para contornar a política.

## 2. Copiar o código e registrar a configuração privada

Copiar em lote todos os arquivos atuais de `google-apps-script`: `Code.gs`, `Schema.gs`, `Sales.gs`, `Stock.gs`, `Notifications.gs`, `SessionStore.gs`, `AuthControl.gs`, `PasskeyStore.gs`, `OwnerAccess.gs`, `Catalog.gs`, `CoverPhotos.gs` e o manifest `appsscript.json`. Não misturar versões ou instalar somente os arquivos da fundação. O schema gerado deve acompanhar o JSON do mesmo commit; gerar com `npm run schema:generate` quando houver migração revisada. Homologação: [ESTOQUE_REPOSICAO_DEV.md](ESTOQUE_REPOSICAO_DEV.md) e [NOTIFICACOES_REPOSICAO_DEV.md](NOTIFICACOES_REPOSICAO_DEV.md).

Em Apps Script → Configurações do projeto → Propriedades do script, preencher:

| Propriedade | Valor/origem |
| --- | --- |
| `APP_ENV` | `dev` |
| `INSTALLATION_ID` | UUID v4 novo, exclusivo desta instalação |
| `OWNER_EMAIL` | E-mail da conta Google DEV que autorizará o script |
| `SIGNING_SECRET` | Chave aleatória de 32 bytes representada por 64 caracteres hexadecimais |

Gerar UUID e chave somente em terminal privado confiável, fora do Git e sem gravação em logs compartilhados. UUID não é segredo; a chave é. Não colar a chave no editor de código. Não usar os PINs demonstrativos como chave.

Deixar os IDs de pasta/planilha ausentes para a primeira instalação. **Não inserir IDs de PROD.** Um recurso existente sem o marcador correto é recusado; o script não irá renomeá-lo/reclassificá-lo silenciosamente.

## 3. Provisionar e verificar DEV

Executar `provisionDevelopment` pelo editor, revisar os escopos e autorizar usando a conta DEV prevista. A função:

1. Confirma ambiente DEV e conta proprietária.
2. Cria pasta DEV, planilha DEV e subpastas privadas `covers`, `profiles`, `documents`, `exports`, `backups`.
3. Registra IDs em Script Properties e marcadores de ambiente/instalação nos recursos.
4. Faz cópia de segurança antes da primeira alteração de schema.
5. Cria as 17 abas do schema, cabeçalhos e versão. Preserva abas desconhecidas em vez de apagá-las.

Executar novamente: deve reaproveitar recursos e versão, sem duplicar a migração. Executar `inspectDevelopmentSchema`: a saída segura no log deve indicar `environment: dev`, `schemaVersion: 1`, `tables: 17`. Não há PII nessa verificação. O código recusa acesso público/de domínio. Conferir também no Drive as permissões nominais e eventuais heranças indesejadas; esse exame de IAM não é substituído pelos testes locais.

Em falha parcial, não trocar IDs manualmente nem apontar para arquivos oficiais. Consultar o guia de recuperação. O retorno do provisionamento e Script Properties permitem localizar IDs; não contêm a chave em logs.

## 4. Implantar o web app de DEV

Criar uma implantação versionada de Apps Script, executando como a identidade DEV. O backend precisa conseguir chamar `/exec` sem sessão de browser; a autenticação da aplicação é o envelope criptográfico. Se o Workspace permitir acesso ao URL por qualquer chamador, mantê-lo protegido pela assinatura, nonce, tempo, bindings e allowlist de operação implementados no código. Se a política não permitir esse tipo de implantação, não tentar bypass de login/CORS: a arquitetura deverá ser ajustada antes da ativação.

O web app só aceita a inspeção assinada do schema. `provisionDevelopment`, migração e comandos de venda não estão disponíveis por `doPost`; GET não expõe dados. O URL de implantação não é uma senha.

## 5. Configurar Netlify por contexto, sem ativar operação real

Na interface privada de variáveis do Netlify, no contexto **da branch dev** e escopo Functions, registrar:

| Variável | Origem |
| --- | --- |
| `APP_ENV` | `dev` |
| `WORKSPACE_INSTALLATION_ID` | `INSTALLATION_ID` do projeto DEV |
| `WORKSPACE_SCRIPT_URL` | URL `/macros/s/.../exec` da implantação DEV |
| `WORKSPACE_SPREADSHEET_ID` | `SPREADSHEET_ID` criado pelo provisionamento |
| `WORKSPACE_DRIVE_ROOT_ID` | `DRIVE_ROOT_ID` criado pelo provisionamento |
| `WORKSPACE_HMAC_SECRET` | Mesma chave privada `SIGNING_SECRET`, cadastrada como valor secreto |
| `WORKSPACE_BACKEND_ENABLED` | Manter `false` nesta fase |

Não colocar esses valores em `netlify.toml`, Git ou arquivos servidos. Netlify fornece `CONTEXT`, `BRANCH`, `DEPLOY_PRIME_URL`; não substituir essas evidências de ambiente por headers do cliente.

As chaves de HMAC precisam estar disponíveis em memória **no servidor Netlify e no Apps Script** para realizar a assinatura; um placeholder de proxy de segredos de outro ambiente não substitui a chave para esse cálculo. Não inserir chaves no frontend nem em valores públicos de build.

O build `npm run build` publica `dist/`; os fontes privados ficam fora dele. A API administrativa continuará fechada, inclusive se alguém ativar o flag prematuramente, porque a identidade real ainda não está implementada. Só habilitar o modo real após os critérios das fases B/C e aprovação explícita.

## PROD

Não executar provisionamento de PROD nesta fase. A função existente recusa esse ambiente. A instalação oficial exigirá outro projeto/identidade, UUID, planilha, pastas e segredos, com revisão de permissões e homologação. O contexto de produção nunca deve receber os valores DEV, e vice-versa.

## Rede

O runtime Netlify precisará alcançar `script.google.com` e `script.googleusercontent.com`; Apps Script usa seus serviços autorizados de Drive/Sheets. Credenciais Google não passam pelo navegador. A execução local desta tarefa não tinha instalação autorizada e não alterou uma allowlist externa para simular integração real.

## Diagnóstico assinado sem ativar as funcionalidades

Após atualizar a implantação Apps Script com a operação de diagnóstico e integrar o código correspondente em dev mediante aprovação, seguir [TESTE_CONEXAO_DEV.md](TESTE_CONEXAO_DEV.md). O build da branch dev pode verificar a conexão com `WORKSPACE_VERIFY_CONNECTION=true`, mantendo `WORKSPACE_BACKEND_ENABLED=false`. O teste não substitui identidade/autorização real nem conclui as fases B–E.

A entrega de sessões está em revisão e desativada. Não adicionar flags/chaves de identidade nem criar usuários manualmente: consultar [SESSOES_E_PERMISSOES.md](SESSOES_E_PERMISSOES.md). A conexão de serviço já confirmada não substitui a homologação de login.
