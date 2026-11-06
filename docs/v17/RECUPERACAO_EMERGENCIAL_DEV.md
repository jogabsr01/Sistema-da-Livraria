# Recuperação emergencial com códigos de reserva — DEV

Complementa a gestão de passkeys do PR #32: uma conta pode recuperar o acesso quando perder todas as chaves, **desde que tenha gerado e guardado códigos de reserva antes da perda e ainda consiga confirmar o e-mail cadastrado**. Sem esses dois recursos, a verificação administrativa de identidade continua pendente. E-mail sozinho não permite substituir passkeys.

## Preparar antes da perda

Em Minhas passkeys, escolher **Gerar códigos de recuperação** e confirmar com uma passkey existente. Somente o próprio ATENDENTE, ADMIN ou SUPER_ADMIN, com sessão forte recente e prova WebAuthn real, pode gerar uma lista. Funciona mesmo com cinco chaves ativas e não cadastra/remove uma chave por emitir códigos. Uma nova lista invalida a anterior e suas permissões de substituição ainda não concluídas.

São seis códigos de 128 bits cada, representados por oito grupos de quatro caracteres hexadecimais. São derivados no Node por HMAC-SHA256 com domínio separado, ambiente, instalação, usuário, comando e índice; o resultado é truncado para 128 bits. A chave é a chave de tokens de sessão existente. Isso permite repetir um resultado incerto com a mesma lista, sem guardar os valores em claro no Google. Não é um segredo escolhido pelo navegador nem derivado apenas de um UUID público.

A tela oferece download local em texto e ocultação explícita. O arquivo contém segredos de acesso e deve ser guardado fora do aparelho que pode ser perdido. Não é enviado por e-mail, WhatsApp, Drive ou outro provedor. O download não contém CPF/e-mail/telefone. A exibição dura até cinco minutos a partir do início do fluxo; a leitura de estado/atualização/recarga não revela códigos automaticamente. Conferência explícita no mesmo fluxo/sessão ainda válido pode reconstruir a mesma lista, inclusive após resposta perdida. Após o prazo ou troca de sessão/versão/fluxo, exige outra prova e emissão de lista nova.

A validade de uso dos códigos é diferente da exibição: os códigos guardados valem até serem reservados, substituídos por nova lista, invalidados por mudança de versão de autorização ou pela recuperação. Não têm uma expiração automática de cinco minutos.

## Recuperar sem a chave antiga

1. Na recuperação do PIN, informar CPF/e-mail já cadastrado e confirmar o código enviado ao endereço registrado. As respostas de solicitação continuam genéricas para contas desconhecidas/inativas/inelegíveis.
2. Selecionar **Usar um código de recuperação guardado**, validar um dos códigos e então definir o PIN novo.
3. Cadastrar uma passkey nova no navegador. O autenticador antigo não é necessário. RP/origem DEV, ES256, presença, user verification, challenge e atestação continuam sendo validados pela biblioteca SimpleWebAuthn instalada.
4. Somente após a confirmação durável, receber uma sessão nova. O papel, usuário/CPF e permissões da conta são preservados. Todas as passkeys e sessões antigas são revogadas; toda a lista antiga de códigos é invalidada. Gerar uma nova lista após voltar a entrar.

O código de reserva é consumido ao ser **reservado para uma tentativa**, não apenas ao concluir a recuperação. A reserva é uma escrita privada atômica, vinculada a usuário, versão, fluxo e hash do cookie de pré-acesso. Repetir o mesmo código no mesmo fluxo confirma a reserva sem consumir outro; outro fluxo não pode reutilizá-lo. Se abandonar/expirar a tentativa ou a cerimônia falhar antes da intenção durável, começar novamente com outro código. A aplicação mostra a quantidade restante no perfil autenticado.

O fluxo de pré-acesso mantém a validade existente de dez minutos e as cerimônias WebAuthn a de cinco. Código antes da confirmação de e-mail, de outra conta/ambiente/instalação, já usado, de lista antiga, de versão antiga ou sem formato válido não permite substituição. A tentativa de código tem orçamento persistente próprio, além do limite por origem já existente; até cinco falhas revogam a prova e geram bloqueio anônimo. Não desativam permanentemente a conta. Não se cobra outra tentativa de adivinhação para repetir um grant já concluído e preso ao mesmo cookie válido; uma tentativa ainda não concluída permanece limitada.

Recuperação normal do PIN com uma passkey existente continua disponível e não exige código de reserva. Código sozinho, e-mail sozinho, PIN sozinho, sinalizador verified/mfa ou JSON com papel/usuário alvo não concedem uma sessão. A troca de chave exige a atestação real da chave nova, além das duas confirmações anteriores.

## Persistência, auditoria e recuperação de falhas

`EmergencyRecovery.gs` usa os registros existentes, sem nova aba, migração de schema, escopo, dependência ou segredo de configuração. O propósito continua RECOVER; a sessão resultante usa versão de autorização anterior + 1, como a recuperação normal. Os PINs continuam com scrypt e pepper; o novo PIN não é guardado em claro.

`IDENTITY_RESCUE_CODES_<UUID>` contém apenas hashes SHA-256 dos códigos com domínio/ambiente/instalação/usuário, referências de reserva e metadados; o registro inteiro tem HMAC com a chave de assinatura existente. Não contém os códigos nem um e-mail. O servidor Node pode reconstruir a lista durante o fluxo autorizado usando sua chave; não afirmar que esses valores são irreconstituíveis por um servidor comprometido. A reserva fica no ledger privado assinado; não expõe hashes nos logs públicos.

A emissão usa a intenção existente de gestão de chaves, modo CODES: prova da chave antiga, contador, publicação do lote e auditoria convergem antes de retornar códigos. A reserva para uso é uma única escrita em Script Properties. Para a substituição, `IDENTITY_RESCUE_PENDING` guarda uma intenção HMAC de ambiente/instalação, fluxo/usuário/versão/papel, hash de cookie e da futura sessão, hash scrypt do PIN e chave pública já verificada. A intenção precede as alterações de conta.

Projeção idempotente: marcador COMMITTING, invalidação da lista, versão de autorização, PIN, revogação de chaves antigas, chave nova, marcador da cerimônia, invalidação de outros fluxos, revogação das sessões antigas, último acesso, sessão nova, auditoria e marcador COMPLETE. A intenção é limpa por último. Leitores de sessão/acesso/passkey/estabilização recuperam uma intenção antes de continuar, mesmo com novas recuperações desligadas. Não reaplicam um PIN enviado posteriormente nem criam outra sessão/chave por reenvio.

Uma falha antes de gravar a intenção pode deixar a passkey criada apenas no autenticador e o código reservado, com a conta antiga intacta; usar outra tentativa/código, sem anunciar sucesso com base apenas na janela do navegador. Depois da intenção, a recuperação termina seus efeitos. Se o cookie de pré-acesso expirar antes de coletar a resposta, o login normal com PIN e passkey novos já confirmados é o caminho de volta; a expiração não permite coletar uma sessão pelo cookie antigo. O replay durável não restaura as sessões antigas.

Intenção ou ledger adulterado/fora de escopo é recusado. Não editar/apagar propriedades para contornar uma falha e não rotacionar SIGNING_SECRET com intenção pendente. Rotação planejada também precisa migrar os ledgers assinados; permanece parte das pendências de chaves da instalação. Mudança da chave de sessão invalida cookies existentes e impede reconstruir uma lista antiga naquele fluxo; códigos previamente guardados continuam comparáveis aos hashes enquanto o ledger/versão forem válidos.

Eventos IDENTITY_RECOVERY_CODES_ISSUED e IDENTITY_PASSKEY_RECOVERED mostram ator/papel, contagem ou mudança de versão e revogação de sessões. Não contêm códigos, hashes dos códigos, e-mail, CPF, PIN, token, atestação ou chave pública. Negativas e bloqueios usam os eventos anônimos existentes, com fase RECOVER. A proteção da quinta prova de e-mail mantém compatibilidade com intenções antigas sem campo de etapa.

## Limites, tela e ativação posterior

Mantém 3.000 registros por tabela privada de escrita, 5.000 sessões/auditorias main, 8.000 bytes por propriedade e orçamento de 400.000 bytes em Script Properties. Capacidade e próxima versão inteira segura são conferidas antes da intenção de substituição. Não truncar nem apagar histórico para abrir espaço. Retenção/compactação ainda é pendente.

Página de passkeys usa diálogo explícito antes de substituir a lista, passos de confirmação, download local, ocultação e timer para remover os códigos do DOM. Sem localStorage/sessionStorage/IndexedDB. Perda/troca de conta/papel e pagehide/bfcache limpam dados e revogam URLs temporários. A página de acesso apaga o código de reserva após a tentativa e ao sair, e retoma a confirmação pelo cookie HttpOnly. As respostas continuam no-store, origem/CSRF exatos e CSP existente, sem provedor novo.

Flag nova `WORKSPACE_EMERGENCY_RECOVERY_ENABLED` no Netlify DEV e `EMERGENCY_RECOVERY_ENABLED` no Apps Script DEV, fechadas por padrão. Emissão exige a gestão de passkeys, sessões/passkeys e RECOVERY existentes; utilização exige acesso/guardas/sessões/passkeys e RECOVERY. Atualizar o lote completo com EmergencyRecovery.gs, PasskeyManagement.gs, OwnerAccess.gs, Recovery.gs, SessionStore.gs, PasskeyStore.gs e SecurityAudit.gs. Não instalar só o arquivo novo. Nenhuma flag privada ou configuração real Google foi ativada. Home de perfis e Google real permanecem para a etapa posterior; o v17 ainda não terminou.
