# Gestão própria de passkeys — DEV

A página `minhas-chaves-dev.html`, ligada ao Meu perfil, permite cadastrar uma passkey adicional e remover uma passkey antiga. O cadastro inicial, login com PIN + passkey e recuperação do PIN por e-mail + passkey existente continuam nos fluxos anteriores. Este incremento não recupera uma conta que perdeu todas as passkeys nem permite que um administrador substitua a chave de outra pessoa.

## Fluxo e garantias

ATENDENTE, ADMIN e SUPER_ADMIN gerenciam somente as próprias chaves. Mutações e retomada de fluxo exigem sessão forte recente (até cinco minutos), origem DEV exata e CSRF. Sessão só com PIN não autoriza a gestão. Papel, versão de autorização, usuário e sessão são resolvidos no servidor e vinculados ao fluxo; o JSON não aceita usuário/perfil/verified/mfa como autorização.

A lista mostra até cinco chaves ativas, data de cadastro e de última utilização/atualização, com uma referência opaca derivada por HMAC de ambiente, instalação, usuário e credential ID. Não retorna chave pública, credential ID bruto, contador, cookie ou hash de sessão. Os IDs brutos aparecem apenas nas opções WebAuthn necessárias à seleção/exclusão pelo navegador, como no login existente. Datas/transports não provam qual aparelho físico está em uso; não se inventa um nome de dispositivo.

**Adicionar:** primeiro confirmar com uma passkey ativa da conta; só depois criar outra passkey em outro aparelho, chave física ou gerenciador. Opções excluem as credenciais já cadastradas. O navegador pode rejeitar uma tentativa no mesmo autenticador. Uma passkey sincronizada pode existir em vários aparelhos sem constituir uma credencial diferente; a aplicação não garante independência física. O limite de cinco é revalidado no commit.

**Remover:** escolher uma chave e confirmar explicitamente. A prova aceita somente outra passkey ativa da mesma conta. A chave alvo fica fora de allowCredentials e é novamente recusada no servidor se usada como prova. A última passkey não pode ser removida. O registro é revogado logicamente, preservando a linha privada e auditoria, e todas as outras sessões não revogadas da conta até o corte da operação são encerradas. Esta sessão é preservada; não há como identificar com certeza quais sessões foram abertas pela chave retirada. Outros usuários e suas chaves/sessões permanecem fora do alvo.

WebAuthn continua usando SimpleWebAuthn instalado, ES256, attestation none, RP e origem DEV exatos, presença e user verification obrigatórias. A biblioteca valida assinaturas, RP/origem, challenge, userHandle e contadores. PIN ou biometria local são tratados pelo autenticador; a aplicação não recebe dados biométricos. Não há rota pública de armazenamento direto de chave ou de confirmação de um sinalizador fornecido pelo navegador.

## Estado e repetição

Um fluxo por usuário, vinculado à sessão, modo, alvo e versão, com validade total de cinco minutos. Challenges de autenticação e registro são distintos, persistidos e de uso único; opções são reconstruídas com os mesmos bytes após recarga/repetição. `AUTH` aguarda prova antiga; `REGISTER` aguarda criação da nova chave; `COMPLETE` é o resultado confirmado e `CANCELLED` impede próximas etapas. O cancelamento não remove a chave antiga nem desfaz a utilização legítima do contador na prova já validada.

Resposta incerta mantém o mesmo commandId e a mesma resposta WebAuthn apenas em memória para repetir. Se a confirmação já está durável, o controlador retoma o estágio autorizado sem executar outra assinatura nem cadastrar/remover outra chave. Repetição de início com o mesmo comando exige o mesmo modo/alvo e vínculo. Uma resposta diferente enviada após a conclusão não concede nova operação: o escopo já está fechado no comando original. Não se cria outra credencial por repetir complete.

Se houver falha depois que uma cerimônia foi consumida, mas antes de persistir a intenção de alteração, a chave antiga é preservada e pode ser necessário cancelar e começar nova confirmação. O autenticador pode ter criado uma credencial local que ainda não foi aceita pelo servidor; somente a lista e o resultado confirmado indicam cadastro efetivo. Não anunciar sucesso com base apenas na janela do navegador. Saída/perda de sessão após resultado incerto exige conferir lista/auditoria ao voltar; não implica desfazer uma operação já confirmada.

Dez inícios novos por usuário em cinco minutos, preservando a janela entre sessões; reenvio do mesmo início não consome outro início. A lista não cria cerimônias. Limites existentes das tabelas privadas de escrita são 3.000 linhas e da auditoria/main 5.000; o início reserva espaço para as duas cerimônias, mesmo na remoção. Capacidade é conferida antes da intenção/efeitos. Não excluir histórico para contornar capacidade; retenção/compactação permanece pendente.

## Recuperação e auditoria

Novo `PasskeyManagement.gs`, sem nova tabela, migração, escopo ou chave de configuração. `IDENTITY_KEYS_<UUID do usuário>` guarda o fluxo privado com HMAC de domínio passkey.management, ambiente e instalação. `IDENTITY_KEYS_PENDING` aponta a única intenção em projeção sob o lock da instalação. Cada valor fica abaixo de 8.000 bytes e o orçamento de Script Properties abaixo de 400.000 bytes; excesso é recusado antes de efeitos.

Antes de mudar contador/cerimônia/chave/sessões, a intenção `PROVING` ou `COMMITTING` é persistida e assinada. A projeção idempotente conclui contador, marcador da cerimônia, cadastro/revogação, sessões, auditoria e marcador final. Remoção usa corte temporal e hash/contagem dos IDs de sessão, não uma lista de milhares de tokens na propriedade. Timestamp de revogação é exclusivo entre sessões para tornar a reconciliação inequívoca. Até 4.999 outras sessões foram testadas dentro do limite de tamanho.

A recuperação é chamada também pelos leitores de sessão, acesso, passkey e rotina de estabilização, mesmo com a flag de novas operações desligada. Uma intenção corrompida ou impossível de reconciliar bloqueia o acesso até diagnóstico; não se ignora assinatura inválida nem se restaura a chave removida. Não editar/apagar `IDENTITY_KEYS_PENDING` ou os fluxos para contornar falha. Não rotacionar SIGNING_SECRET com intenção pendente. Rotação planejada da chave de assinatura também precisa tratar os fluxos HMAC já concluídos; essa migração não faz parte deste incremento.

IDENTITY_PASSKEY_ADDED e IDENTITY_PASSKEY_REMOVED registram usuário/papel resolvidos, data, resultado, contagem de chaves e sessões revogadas. Sem ID/chave pública de credencial, assinatura, challenge, PIN, prova, cookie ou token nos logs. A lista é própria e não cria um evento por atualização. Não adiciona um envio de e-mail ou serviço externo. Falha após intenção pode deixar a operação pendente e recuperável; só se retorna confirmação após completar seus efeitos e auditoria.

## Tela e ativação posterior

Página responsiva, diálogo explícito de remoção, instruções separadas para provar e criar, estado recuperado após recarga, repetição de resultado incerto sem nova operação, limpeza de memória/DOM no pagehide/bfcache ou mudança/perda de conta/papel. Sem localStorage/sessionStorage/IndexedDB. Respostas e página no-store, CSP restrita. Nenhuma imagem ou documento privado ganha link externo.

Flags novas `WORKSPACE_KEY_MANAGEMENT_ENABLED` (Netlify DEV) e `KEY_MANAGEMENT_ENABLED` (Apps Script DEV), fechadas por padrão. Exigem identidade/sessões/passkeys existentes em DEV. Atualizar o lote completo, incluindo PasskeyManagement.gs, PasskeyStore.gs, SessionStore.gs, OwnerAccess.gs e SecurityAudit.gs; não instalar só o arquivo novo. Home dos perfis e configuração Google real continuam para depois das melhorias originais. Nada privado foi ativado, produção não foi alterada e o v17 ainda não está concluído.
