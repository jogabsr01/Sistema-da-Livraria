# Administração Google DEV

A autenticação `clasp login` no Mac não conecta o chat ao Google. A ponte é o workflow `Google DEV administration`, executado somente na branch `dev` deste repositório. Nenhuma publicação em main/produção, RPC de negócio, bootstrap, mudança de propriedades ou leitura de contatos/PINs é realizada.

O segredo privado de repositório `GOOGLE_DEV_ADMIN` contém os identificadores do projeto DEV e somente `client_id`, `client_secret`, `refresh_token` da credencial OAuth própria. Nunca publicar `.clasprc.json`, o JSON OAuth ou o segredo no código, artefatos, logs ou chat. O Google OAuth em modo de testes pode expirar o refresh token em sete dias; se ocorrer `OAUTH_REFRESH_FAILED`, reautorizar localmente e atualizar o segredo. O segredo é revogável pela conta Google e removível no GitHub. A autorização OAuth é da conta e pode abranger outros projetos dela; os hashes no controlador previnem troca de alvo por engano, mas não substituem a proteção do segredo e de quem pode editar workflows.

## Inspeção inicial

`ops/google-dev-request.json` começa com `mode=inspect`. Se não houver segredo, o resultado é `CONFIGURATION_REQUIRED`, não sucesso de conexão. Depois de cadastrar o segredo, executar novamente o workflow na branch `dev` ou incrementar `revision` nesse arquivo e integrar em DEV. O controlador lê código e implantação existentes, confirma os identificadores por hashes fixos e informa hashes do editor, da versão publicada e do candidato, além do número de versão. Nunca imprime fontes, configuração, respostas do Google, credenciais ou mensagens de exceção.

Os registros são uma amostra de até 50 entradas `rpc.duration` da última hora, no projeto Cloud dedicado. Somente cinco campos numéricos de tempo passam pelo filtro. `UNAVAILABLE` não é ausência de lentidão: conferir API Cloud Logging, autorização `logging.read`, IAM, associação do Apps Script ao projeto Cloud e execução recente. A associação do Apps Script ao projeto Cloud não ocorre automaticamente por criar o cliente OAuth. Migrar essa associação exige verificar os consentimentos e autorizar novamente antes de retomar o acesso ao aplicativo. Não alterar URL da implantação. Esta automação não altera essa associação.

## Publicação explícita

Após inspecionar, trocar a solicitação por `{ "mode":"deploy", "revision":2, "expectedEditorHash":"<hash da inspeção>", "expectedDeploymentVersion":1, "candidateHash":"<hash candidato da inspeção>" }`, preenchendo a versão real. O arquivo é revisado com a alteração de código antes de integrar em DEV. Uma mudança de fonte, editor ou versão invalida a solicitação. O layout precisa continuar sendo exatamente um arquivo servidor e o manifesto. O nome do arquivo e o manifesto remotos são preservados.

Antes de modificar o editor, criar e verificar uma versão imutável de backup no próprio Google. Após a escrita, reler e verificar o conteúdo, criar e verificar a versão de publicação e atualizar a implantação existente preservando sua configuração. A URL não é recriada. A confirmação de publicação não confirma tempos reais nem autenticação física. A cópia local do Mac e as versões imutáveis são cópias do código, não backup dos dados/propriedades/planilhas.

Não editar manualmente o Apps Script durante o workflow. A API Google não oferece compare-and-swap: a checagem imediatamente anterior à escrita e a exclusão mútua do workflow reduzem, mas não eliminam, corrida com outro editor externo. Não há repetição automática de requisições, gravações ou falhas de transporte. `WRITE_UNCONFIRMED_INSPECT_BEFORE_RETRY` exige uma nova inspeção; a escrita pode ter ocorrido. A versão anterior da implantação permanece disponível para recuperação manual. Não afirmar que houve rollback automático.

## Configuração pelo proprietário

O proprietário já autenticou seu próprio cliente para computador com `clasp` e baixou uma cópia local de dois arquivos. A próxima etapa é construir localmente o envelope com os três identificadores DEV e os três campos de credencial, copiar diretamente para a área de transferência e colar em Settings → Secrets and variables → Actions → New repository secret, nome `GOOGLE_DEV_ADMIN`. Nunca enviar esse conteúdo ao assistente. O comando local de preparação deve validar os campos e não imprimir os valores. Não incluir access_token/id_token nem outras contas do arquivo clasp. O arquivo OAuth de Downloads sozinho não contém refresh_token e não é o segredo correto.

## Ativação explícita da Drive API após troca de projeto Cloud

A migração do vínculo Cloud pode gerar “Permissão negada ao ativar APIs: drive” mesmo com OAuth administrativo funcionando. A solicitação estrita `{ "mode":"enable-drive", "revision":4 }` verifica o estado e, somente se desativada, habilita `drive.googleapis.com` no projeto DEV de número fixo `590183543759`, correspondente ao identificador Cloud já validado por hash. Não permite escolher outro serviço/projeto, alterar IAM/faturamento/manifesto ou executar função de migração. A habilitação não altera documentos nem suas permissões de compartilhamento. Consulta o estado até cinco vezes após um único POST; retorno pendente/erro não é sucesso. Não repete a habilitação após falha de transporte. Se a API já está habilitada, não faz POST. Depois, restaurar a solicitação para `inspect` para as consultas de diagnóstico seguintes.

O registro enviado pelo proprietário em 28/10 mostrou que foi selecionada `migrateDevelopmentSchema`, não a função pedida `inspectDevelopmentSchema`. Não repetir a migração. Depois da ativação confirmada, selecionar explicitamente `inspectDevelopmentSchema`, autorizar serviços se o Google solicitar e executar somente a inspeção.
