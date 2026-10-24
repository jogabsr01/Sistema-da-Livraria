# Eventos de segurança e alterações de livros — DEV

Este incremento amplia a trilha do v17 nos fluxos de acesso já implementados, na revogação de sessões e no catálogo. A consulta/exportação administrativa do PR #28 passa a mostrar esses eventos e seus detalhes autorizados. Não cria uma nova forma de autenticar nem muda os limites de tentativas existentes.

## Eventos de acesso

| Evento | Quando ocorre | Autor registrado |
| --- | --- | --- |
| IDENTITY_ACCESS_DENIED | Credenciais, código de e-mail, passkey ou estado de fluxo recusados depois de entrar no controlador de autenticação validado | SYSTEM_AUTH |
| IDENTITY_AUTH_BLOCKED | Início de um bloqueio temporário pelo limite persistente por identificador e/ou origem | SYSTEM_AUTH |
| IDENTITY_PROOF_BLOCKED | Quinta confirmação de e-mail incorreta revoga aquela prova | SYSTEM_AUTH |
| IDENTITY_LOGOUT | Revogação explícita da sessão atual | Usuário resolvido pelo servidor |
| IDENTITY_SESSIONS_REVOKED | Revogação das outras sessões do mesmo usuário | Usuário resolvido pelo servidor |

IDENTITY_ACTIVATE, IDENTITY_LOGIN, IDENTITY_PIN_RECOVER, PROFILE_UPDATE e IDENTITY_EMAIL_CHANGE continuam emitidos pelos respectivos fluxos já existentes. Alterações administrativas de perfil/status permanecem em STAFF_UPDATE. Desativar funcionário não se confunde com bloqueio temporário de tentativas.

Negativas são registradas com etapa e motivo padronizado. Não incluem identificador digitado, CPF/e-mail, PIN, código, IP, hash de limite, cookie, token, ID de credencial ou resposta WebAuthn. Mesmo uma conta existente com PIN incorreto aparece como Sistema de autenticação: uma tentativa que ainda não provou a identidade não é atribuída à pessoa indicada pelo solicitante. Conta desconhecida e PIN errado mantêm o mesmo resultado público e o mesmo tipo de registro. Falha de fluxo/expiração não é apresentada como assinatura inválida da passkey.

O limite por identificador é compartilhado com o primeiro acesso: uma solicitação anterior pode consumir parte do orçamento antes das tentativas de login. Requisições durante o mesmo bloqueio não prolongam a espera nem acrescentam novas transições. Bloqueios posteriores, depois do prazo, recebem evento próprio. A quinta prova incorreta bloqueia aquela prova, sem inventar desativação permanente de conta.

Não são logados por este controlador pacotes malformados, CSRF/origem rejeitados antes dele, inspeções passivas do estado, cancelamento local da janela da passkey ou falhas de transporte/provedor que não comprovem uma negativa de autenticação. Isso evita transformar erros de infraestrutura ou entrada bruta ilimitada em eventos falsos de identidade. A cobertura não representa todo evento de futuras rotas de credenciais ou proteções de tráfego.

## Persistência e recuperação

SecurityAudit.gs mantém, em Script Properties privadas, uma única intenção `IDENTITY_SECURITY_PENDING`, autenticada por HMAC com domínio próprio e chave de assinatura existente. Não há nova aba privada, migração, chave ou recurso. Essa propriedade é gerida pelo código, não é parâmetro de configuração manual.

Para bloqueios de limite, a intenção precede a gravação dos dois contadores privados e da auditoria. Para bloqueio da prova, precede a revogação da prova e a auditoria. Para logout/revogação de outras sessões, precede as revogações e o evento. A recuperação confere estado anterior/posterior, conclui o que falta e só então limpa a intenção. Intenção alterada/corrompida falha de forma fechada. Os leitores de sessão e controladores de acesso recuperam antes de prosseguir, inclusive se a flag específica de guardas estiver desligada.

Sessões são identificadas por conjunto, corte temporal e impressão dos IDs, em vez de uma lista de credenciais na propriedade. A intenção fica abaixo de 8.000 bytes e suporta o limite de 5.000 sessões (uma atual e 4.999 outras). O timestamp de revogação é exclusivo para não confundir sessões já revogadas com uma projeção parcial. Sessão de outra pessoa e sessão atual, ao revogar as demais, são preservadas.

A intenção de segurança é independente dos journals anteriores, que são recuperados antes de reservar nova auditoria. Não apagar `IDENTITY_SECURITY_PENDING`, alterar suas partes ou trocar a chave de assinatura enquanto houver pendência. Não remover uma linha de auditoria para fazer a recuperação passar. Recuperação legítima depende das vinculações e do acesso privado aos recursos originais.

Negativas isoladas usam uma gravação de auditoria com UUID do servidor, idempotente por comando/fase/motivo; não há endpoint público que aceite usuário/perfil para esse registro. Se o registro da negativa falhar, o controlador não concede acesso. A ponte interna `identity.security.record` é assinada, limitada a códigos/etapas permitidos e habilitada somente no contexto DEV de identidade existente.

## Saída da conta com resposta perdida

Logout mantém origem exata, JSON, cookie host-only e CSRF vinculado ao cookie. A autoridade sobre o token continua no Apps Script. O Node pode repetir a revogação sem exigir que uma sessão já revogada volte a autenticar: o servidor só devolve o reconhecimento do logout original daquela sessão, sem conceder leitura, nova sessão ou permissões. A requisição nunca recebe uma identidade escolhida pelo navegador.

A página de acesso repete com o mesmo cookie/CSRF se perder a resposta. O menu da conta, ao receber 401 na consulta seguinte, reconhece que a sessão já não está ativa e volta à entrada. Repetir não duplica o evento. Revogar outras sessões sem novos alvos é uma confirmação sem novo evento; se outras sessões surgirem depois, uma nova operação efetiva pode gerar novo evento.

No limite de 5.000 eventos, nenhuma linha é apagada. Negativas/bloqueios não prosseguem com um novo registro sem capacidade. Uma revogação de sessão já solicitada prioriza retirar acesso: a intenção permanece, as sessões são revogadas e a confirmação falha se faltar espaço para auditar. Leituras seguintes ficam recusadas enquanto a intenção não puder terminar. Retenção/compactação com preservação de evidências continua pendente do v17; não contornar o limite apagando histórico. Falha antes de persistir a intenção também não confirma logout.

## Histórico detalhado de livros

Novas intenções de catálogo incluem `auditVersion:2` no snapshot posterior incluído no hash de integridade do journal. O log mantém PRODUCT_CREATE/PRODUCT_UPDATE e registra antes/depois de título, autor, editora, edição, ISBN/código interno, fornecedor, categoria, preço em centavos, estoque mínimo, ano/páginas, ativação e IDs dos nichos. Mantém versão e saldo do momento. Desativação/reativação ficam explícitas pelo campo Ativo; novas associações de nichos ficam nos conjuntos anteriores/posteriores.

Capas são representadas por presença/tipo e indicador de alteração; sinopse só por indicador de mudança. URLs, IDs privados do Drive, foto e texto da sinopse não são copiados para a auditoria. Os snapshots operacionais existentes permanecem no journal para recuperação. A consulta e o Excel liberam os novos campos apenas para eventos de produto; não abrem a divulgação de texto livre de outras entidades.

Intenções legadas sem versão continuam com o formato antigo de auditoria de versão/revisão. Uma intenção antiga interrompida termina com seu contrato original, sem conflitar com um log já projetado. Registros históricos não são reescritos para simular informações que não foram auditadas. Novas falhas de projeção preservam seu formato detalhado e a mesma referência, sem duplicar o evento ou alterar o saldo durante a edição.

## Instalação e limites do aceite

Atualizar o lote completo, incluindo SecurityAudit.gs, AuthControl.gs, OwnerAccess.gs, SessionStore.gs, Catalog.gs e Audit.gs. O novo helper é chamado pelos leitores existentes; não publicar somente parte do lote. Mantêm-se todas as flags existentes, fechadas por padrão. A captura usa os controles de identidade/catálogo; a consulta continua dependendo de WORKSPACE_AUDIT_ENABLED/AUDIT_ENABLED. Desligar a consulta não elimina a trilha nem suas recuperações.

Nenhuma propriedade/flag real foi alterada. A configuração Google continua para depois das melhorias originais, conforme solicitado. [QA](QA_EVENTOS_AUDITORIA.md), [consulta](AUDITORIA_DEV.md) e [pendências](STATUS_V17.md).
