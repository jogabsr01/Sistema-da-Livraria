# Alteração verificada de e-mail — DEV

O perfil permite alterar o e-mail de acesso após uma sessão forte (passkey/MFA) autenticada há até cinco minutos e código de uso único entregue ao novo endereço. Até confirmar, o endereço anterior continua sendo o oficial. CPF, papel, nome de funcionários, PIN e passkeys não são alterados por esse formulário.

## Fluxo

1. Abrir Meu perfil, informar o novo e-mail e solicitar código. O servidor deriva a conta da sessão, valida revisão e contato autoritativos e reserva a tentativa antes do envio.
2. Colar o código completo no mesmo navegador/sessão. Código vale cinco minutos, é ligado à conta/comando/sessão/versão e tem no máximo cinco erros. A exigência de autenticação recente continua valendo durante a confirmação; se vencer, entrar novamente e solicitar outro código.
3. Confirmar. Só então o contato cifrado/índice é atualizado, a revisão incrementada, outras sessões encerradas e fluxos incompletos de primeiro acesso/login/recuperação invalidados. A sessão atual e as passkeys cadastradas permanecem válidas. Login e recuperação passam a usar o endereço confirmado.

É possível cancelar antes de concluir. Solicitar outro código invalida o anterior; mínimo de 60 segundos entre emissões e máximo de cinco por hora por conta, inclusive tentativas canceladas/falhas. O limite diário MailApp também é respeitado. E-mails duplicados, inclusive contas inativas, são recusados com mensagem genérica de indisponibilidade. A confirmação verifica novamente duplicidade/revisão: edição administrativa ou do perfil durante a espera exige nova solicitação.

Aceita um único endereço ASCII convencional, incluindo subdomínios e tags `+`. Não aceita lista de destinatários, nomes de exibição, cabeçalhos ou endereços internacionais que precisem de SMTPUTF8. Não é um formulário de envio de mensagens promocionais.

## Conta principal e propriedade Google

`OWNER_EMAIL` e `IDENTITY_OWNER_EMAIL_BINDING` continuam identificando o proprietário técnico da instalação Google. O endereço verificado de login do proprietário é separado, em `IDENTITY_OWNER_LOGIN_EMAIL`, nas propriedades privadas Apps Script. Alterá-lo não transfere propriedade Drive, não muda a conta que executa o script, IAM ou os recursos vinculados. Sem a nova propriedade, o login continua usando o endereço original, preservando instalações existentes.

O endereço técnico original e o login atual do proprietário permanecem reservados contra cadastro por funcionários. O proprietário também não pode tomar o endereço indexado de outro usuário. Desligar a flag da funcionalidade não desfaz um e-mail confirmado nem impede o login pelo endereço já alterado.

## Persistência e recuperação

`IDENTITY_EMAIL_CHANGE_<id>` é um journal privado com um fluxo por conta. Código puro nunca é persistido; guarda-se HMAC ligado à instalação/conta/comando. O novo endereço de entrega fica nas propriedades privadas necessárias ao MailApp; não fica em texto puro na planilha comum. Para funcionários, contato completo continua AES-GCM em `Usuarios.Nome` e índice HMAC em `Email_Indice`. O proprietário mantém o bootstrap de nome vazio. Auditoria `IDENTITY_EMAIL_CHANGE` contém revisão/resultado, sem endereços, código, PIN ou token.

Após verificar o código, a intenção COMMITTING precede todas as projeções. Um ponteiro privado por instalação é escrito antes da intenção, permitindo recuperar sem varrer journals de todas as contas a cada sessão. Se só o ponteiro tiver sido salvo, o endereço ainda não foi alterado e uma repetição segura pode concluir. Se a intenção já foi salva, novas leituras de sessão/fluxos concluem as projeções antes de aceitar acesso, mesmo com flags de perfil/equipe/troca de e-mail desligadas. Se a recuperação falhar, o acesso falha fechado. Reenvio da mesma confirmação não duplica auditoria nem renova sessão.

Limites deliberados: registro privado até 8.000 bytes e orçamento de propriedades até 400.000 bytes, abaixo das cotas Google; operações recusam antes de ultrapassá-los. Apenas o fluxo mais recente por conta é mantido; auditoria permanece na planilha. Retenção/compactação e restauração consistente de propriedades, planilha comum e controle privado precisam da homologação posterior. Não excluir o ponteiro ou journals manualmente para contornar uma falha.

O envio MailApp não é transacional. Resposta perdida ao solicitar código repete o comando sem reenviar mensagem. Se a gravação foi reconhecida de forma incerta antes do envio, ou o provedor entregou sem confirmar, pode ser necessário solicitar outro código após o intervalo. O sistema não promete entrega exatamente uma vez nem altera o endereço sem prova. A confirmação perdida é recuperável consultando o estado no recarregamento.

## Interface e implantação

Requisições exigem origem DEV exata, sessão HttpOnly, CSRF e payload limitado a 2 KiB. O formulário não recebe papel, CPF, ID de outra conta, contato cifrado ou índice escolhidos pelo navegador. Comandos incertos são mantidos somente em memória e repetidos com a mesma carga; controles ficam bloqueados enquanto o resultado estiver incerto. Nenhum endereço/código vai para localStorage/IndexedDB. Recarregar consulta o fluxo ligado à sessão, sem preencher novamente dados pessoais. Respostas antigas de consulta não apagam código digitado nem sobrescrevem mensagens de confirmação/erro.

Flags independentes `WORKSPACE_EMAIL_CHANGE_ENABLED` (Netlify DEV) e `EMAIL_CHANGE_ENABLED` (Apps Script), desligadas por padrão. Também requer perfil/sessões habilitados e autenticação forte já provisionada. Atualizar o lote inteiro de `.gs`, incluindo `EmailChange.gs`: as rotinas de sessão/acesso recuperam suas intenções. Sem nova aba, migração de schema ou escopo OAuth. O kit inclui o novo arquivo e este guia.

Este incremento não configura Google, flags ou contatos reais. Home dos perfis e instalação Google continuam na etapa posterior combinada. Não implementa recuperação após perda de todas as passkeys nem gestão completa de credenciais. Evidências e limites em [QA_EMAIL_VERIFICADO.md](QA_EMAIL_VERIFICADO.md).
