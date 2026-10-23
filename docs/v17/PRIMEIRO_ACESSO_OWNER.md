# Primeiro acesso e login verificado da conta proprietária — DEV

Incremento sobre o PR #12, integrado em dev no commit `3049072877f7c9aede7ac566796a8b140b62303e`. Este incremento tem implementação funcional local, em revisão; nenhuma flag, chave, permissão, conta ou implantação Google real foi alterada nesta entrega. Main e produção permanecem fora do trabalho.

## Comportamento entregue

`acesso-dev.html` oferece um fluxo separado do protótipo. Abre formulários exclusivamente no hostname DEV e HTTPS. O primeiro acesso confirma o e-mail por código aleatório de 256 bits, define/confirma um PIN de quatro números e registra uma passkey com confirmação do usuário. Só então a conta passa a ativada e recebe uma sessão persistente Secure/HttpOnly. Cada login posterior verifica PIN e assinatura WebAuthn antes de emitir outra sessão. Sair revoga a sessão no servidor. A tela confere o leitor de sessão após o commit; não usa uma mensagem otimista como prova de login.

O browser não escolhe usuário, perfil, versão, finalidade ou ceremonyId. O servidor obtém esses valores pelo fluxo privado e valida novamente no comando de conclusão. No primeiro acesso, cadastro de passkey só é permitido depois do e-mail e PIN; no login, só depois do PIN correto. Origem, JSON, CSRF vinculado a cookie e limites duráveis precedem operações sensíveis. Endereço IP vem exclusivamente de `context.ip` do Netlify, nunca de headers/corpo. Falta de contexto recusa a operação.

Escopo inicial deliberado: apenas o proprietário que preparou o Google DEV, com endereço em OWNER_EMAIL e perfil SUPER_ADMIN determinado no servidor. Cadastro de outros funcionários, CPF/login por CPF, edição de perfil e recuperação de conta ainda não estão liberados. Nenhuma informação pessoal fornecida no chat foi cadastrada; campos pessoais de Usuarios ficam vazios. O endereço de entrega permanece nas propriedades privadas já existentes do Google. A tela não transfere a identidade ao protótipo, nem liga seus dados locais aos módulos compartilhados.

## Preparação do proprietário

`prepareDevelopmentOwnerAccess` só executa no editor Google pelo proprietário configurado e em DEV. Não é uma ação HTTP. Cria UUID, versão de autorização e um único master pendente, sem PIN ou dados pessoais; não aceita argumentos do navegador. Reexecução retoma uma criação interrompida, preserva a identidade e recusa conta já ativada, usuário master concorrente ou mudança do endereço proprietário. Instalações com usuários prévios exigem um procedimento separado, não adoção automática.

Conhecimento do e-mail não ativa a conta. Ainda são necessários código recebido na caixa cadastrada, PIN escolhido privadamente e passkey. Uma confirmação fresca de e-mail pode revogar chaves de inscrições abandonadas enquanto a conta continua pendente; nunca redefine a conta ativada.

## Dados privados e recuperação de falhas

Schema de controles v3 adiciona `_Identity_Flows` e `_Pin_Verifiers`; os hashes históricos v1/v2 são fixos e conferidos antes da migração. Backup anterior e retomada preservam contadores/passkeys existentes. As 17 abas de negócio continuam com o mesmo schema v1.

- Código bruto existe temporariamente no Node, envelope HTTPS assinado e chamada MailApp. Nunca é persistido em Sheets, exposto em JSON público/URL, ou escrito em log/auditoria. Essa entrega é a exceção explícita ao transporte apenas de hashes dos controles antigos: o provedor precisa do texto do código para enviar o e-mail.
- E-mail só é enviado para OWNER_EMAIL privado, sem destinatário controlado pelo pedido. Quota indisponível/falha MailApp revoga o fluxo e mantém a mesma resposta pública genérica. Solicitação não comprova entrega. Reenvio tem intervalo mínimo de 60 segundos, além dos limites de conta/origem. Um novo código substitui o anterior.
- Código vale dez minutos, é vinculado ao cookie do mesmo navegador e admite cinco erros. Confirmação muda o estado sob lock, não emite sessão. PIN vira um registro scrypt com salt individual e pepper privado; o texto puro não atravessa a bridge Google.
- A conclusão verifica cerimônia realmente concluída pelo verificador criptográfico, usuário/versão, finalidade e credencial atual. O intent COMMITTING é persistido antes de projetar PIN, ativação, sessão e auditoria. Sessões vinculadas ao fluxo só passam pelo leitor depois do marcador COMPLETE.
- Retentativa usa o mesmo hash de sessão derivado do cookie de pré-acesso e chave de sessão, com separação de finalidade. Não duplica sessão, PIN ou log. Perda de resposta permite conferir/concluir de novo. Se o cookie/fluxo expirou, um novo pedido pode recuperar o intent já comprovado; não devolve o cookie antigo e exige novo login com PIN/passkey.
- Logs de ativação/login contêm UUID, ação, horário, perfil e resultado, sem PIN, código, e-mail, token ou chave. Capacidade máxima é de 3.000 linhas por tabela privada e 5.000 nas tabelas de sessão/usuário/auditoria; excesso falha fechado. Ainda falta limpeza/arquivamento controlado.

Cookies: pré-acesso `__Host-livraria_access`, HttpOnly/Secure/SameSite=Strict, dez minutos; sessão `__Host-livraria_session`, HttpOnly/Secure/SameSite=Lax, até oito horas e inatividade limitada pelo leitor existente. JavaScript recebe somente CSRF e estado público. Nenhum dado de autenticação vai ao localStorage/sessionStorage. A página usa scripts/estilos próprios, CSP sem código inline, frame-ancestors none e no-referrer.

## Configuração real: lote posterior à revisão

Não executar esse lote antes de integrar/revisar o PR e combinar a homologação controlada. O código não tem acesso às suas configurações privadas Google/Netlify, e não automatizou os passos abaixo. Eles estão reunidos para evitar atualizar um arquivo a cada incremento.

1. No projeto **Livraria IPB — DEV** do Apps Script, atualizar `Código.gs` com Code.gs e os demais arquivos do diretório google-apps-script: Schema.gs, Sales.gs, SessionStore.gs, AuthControl.gs, PasskeyStore.gs, **OwnerAccess.gs**, appsscript.json. Preservar todas as propriedades privadas e a implantação existente.
2. No seletor de funções, executar `provisionDevelopmentAuthControls`. Isso prepara/migra a planilha privada, com backup anterior. Depois executar `prepareDevelopmentOwnerAccess`. Nenhuma dessas funções recebe CPF/PIN. A conta permanece pendente.
3. O manifesto adiciona somente a permissão de **enviar e-mail** (MailApp); será necessária nova autorização Google ao proprietário. Não pede leitura da caixa de entrada. Atualizar a implantação existente para a nova versão, preservando a URL /exec. Executar como proprietário, transporte protegido pela assinatura já configurada.
4. Gerar e guardar privadamente três chaves aleatórias **diferentes**, de 32 bytes/64 caracteres hexadecimais: WORKSPACE_SESSION_TOKEN_KEY, WORKSPACE_AUTH_GUARD_KEY e WORKSPACE_PIN_PEPPER. Devem ser diferentes da WORKSPACE_HMAC_SECRET e entre si. Não colar segredos no chat, repositório, console de navegador ou descrição de PR. Não reutilizar o PIN divulgado anteriormente.
5. No Netlify, cadastrar as três chaves somente no contexto **Branch deploys** que está limitado à branch dev. Preservar valores de produção/previews vazios; não usar “Same value for all deploy contexts”. Para secrets, Builds/Functions/Runtime já selecionados são suficientes; não precisa mudar de plano.
6. Na homologação controlada, Google exige IDENTITY_ACCESS_ENABLED, IDENTITY_GUARDS_ENABLED, IDENTITY_PASSKEYS_ENABLED e IDENTITY_SESSIONS_ENABLED=true. Netlify exige WORKSPACE_IDENTITY_ACCESS_ENABLED, WORKSPACE_IDENTITY_GUARDS_ENABLED, WORKSPACE_IDENTITY_PASSKEYS_ENABLED, WORKSPACE_IDENTITY_SESSIONS_ENABLED e WORKSPACE_BACKEND_ENABLED=true, além das chaves e vínculos existentes. APP_ENV continua dev; WORKSPACE_VERIFY_CONNECTION deve continuar false (o diagnóstico anterior exige backend desligado). Atualizar somente a implantação DEV e confirmar o build. Não usar **Publish deploy** para promover um branch deploy a produção.
7. Abrir `https://dev--merry-chimera-49a1f3.netlify.app/acesso-dev.html`, escolher **É meu primeiro acesso**, usar o e-mail Google proprietário já configurado, receber/copiar o código no mesmo navegador, definir um PIN novo e concluir a passkey. Confirmar sessão, sair e entrar novamente. Só esse procedimento privado ativará o master real.

Ausência de qualquer flag/configuração mantém rotas fechadas. Reverter WORKSPACE_IDENTITY_ACCESS_ENABLED=false desliga novos acessos; WORKSPACE_BACKEND_ENABLED=false fecha também leitura/revogação do backend. A reversão de flags não apaga registros: para invalidar sessões, revogá-las/aumentar a versão de autorização por procedimento autorizado. Nunca editar manualmente um marcador de commit para simular conclusão.

## Evidências e limites

Resultado desta entrega: **117 testes backend aprovados em Node 22 e 24**, build aprovado e **39 cenários Playwright/Chromium aprovados** (6 de primeiro acesso/login, 7 de verificação WebAuthn e 26 de regressão do protótipo). `index.html`, o schema de negócio e Schema.gs permanecem idênticos à base dev. Não há alterações em main nem em dados compartilhados.

Testes Node exercitam o código Apps Script em contrato descartável, incluindo falhas antes/depois de intent, PIN, usuário, sessão, auditoria e marcador; retomada em nova instância; expiração/perda do cookie; recusa de origem, CSRF, papel injetado, chave reutilizada e configuração incompleta.

Playwright/Chromium exercita a interface publicada em dist, cookies do navegador, scrypt e assinaturas reais de um autenticador virtual, em desktop/celular. Testa ativação, login/saída, PIN incorreto, assinatura adulterada, recarga após falha, resposta final perdida e formulários fechados em PROD/configuração desabilitada. Aplica os headers CSP do netlify.toml. Google e MailApp são emulados explicitamente: **nenhum e-mail real, conta real, autenticador físico, autorização OAuth ou persistência Google real foi validado nesta entrega**.

Comandos: `npm test`, `npm run build`, `npm run test:access`, `npm run test:passkeys`, `ZXING_JS=<arquivo verificado> npm run test:browser`. As ferramentas de teste escutam somente localhost e são excluídas da publicação. Capturas locais sem dados pessoais: `/workspace/qa-v17-owner-access/acesso-desktop.png` e `acesso-celular.png`.

Acesso externo ao DEV nesta sessão recebeu HTTP 401, portanto o merge do PR #12 não é evidência de homologação visual do branch deploy. Verificar o deploy real pelo proprietário continua necessário. Ainda faltam: política de borda/quota antes de abrir acesso público amplo; retenção, recuperação e rotação; gestão de funcionários/perfis; CPF criptografado; cadastro/remoção de passkeys e recuperação de conta; integração compartilhada dos módulos B/D/E. Esta página não declara o V17 concluído.
