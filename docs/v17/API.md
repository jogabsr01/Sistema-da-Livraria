# API incremental do V17

URL base: mesmo domínio do frontend, `/api/v1`. Não usar chamadas diretas do browser ao Apps Script ou à planilha.

| Endpoint | Estado | Acesso | Resultado |
| --- | --- | --- | --- |
| `GET /api/v1/health` | Implementado | Público | `{ "ok": true }`, liveness do handler, sem IDs/configuração |
| `GET /api/v1/schema` | Implementado, ativação fechada | Sessão persistente ADMIN/SUPER_ADMIN com MFA/passkey recente, revalidada no lock GAS | `data.schemaVersion`, nomes das abas e ID de correlação |
| `GET /api/v1/session` | Implementado, ativação fechada | Cookie de sessão validado no servidor | ID do usuário atual, perfil, nível, expiração e token CSRF; sem PII |
| `POST /api/v1/session/logout` | Implementado, ativação fechada | Sessão, origem exata, JSON e CSRF | Revoga a sessão e limpa o cookie |
| `POST /api/v1/session/revoke-others` | Implementado, ativação fechada | Sessão, origem exata, JSON e CSRF | Revoga somente outras sessões do usuário atual |

Liveness não comprova autorização Google, schema instalado, credenciais ou readiness operacional. O endpoint administrativo retorna 503 por padrão (`SERVICE_NOT_ACTIVATED`); com configuração da bridge válida, a identidade continua fechada por padrão (`IDENTITY_NOT_ACTIVATED`). As sessões exigem configuração privada adicional independente, com suporte somente a DEV. Não habilitar até concluir emissão verificada, MFA e limites persistentes. PINs 1357/2468, Bearer com PIN e headers de papel não autenticarão a API.

Métodos diferentes do declarado em cada rota retornam 405 com Allow correspondente. Todas as respostas usam JSON, `no-store` e `nosniff`. Erros têm a forma `{ "error": { "code": "...", "requestId": "..." } }`, sem stack/payload. 401/403 são usados pelo contrato de autenticação/autorização; 502/503 representam falhas fechadas do adaptador/configuração. Não devolver mensagens brutas do Google.

## Bridge entre servidores

Envelope HTTP POST para `/exec`, nunca para o browser:

```text
{ message: base64(UTF8(JSON(request))), signature: hex(HMAC-SHA256(key, "request.v1." + message)) }
```

O request contém versão 1, ambiente, UUID de instalação, IDs de recursos, requestId, issuedAt em milissegundos, nonce aleatório de 32 bytes, ação permitida, actor e payload estritamente definidos por operação. `system.ping` retorna prontidão DEV sem identidade de usuário. `identity.session.read/revoke/revokeOthers` recebe somente o hash do token, com habilitação separada. `system.schema` exige referência de sessão e revalidação autoritativa sob lock; papéis declarados pelo chamador não bastam. Apps Script verifica assinatura antes de interpretar o corpo e confirma todos os bindings e a janela temporal.

Resposta autenticada usa o prefixo `response.v1.`, com ambiente, instalação, requestId e nonce idênticos, sentAt e sucesso/dado ou erro seguro. O backend verifica assinatura e correlação antes de repassar somente os campos permitidos pela operação. O redirect próprio do ContentService é GET HTTPS restrito, sem reenviar identidade ou o POST.

Não há CRUD público nem proxy genérico de ações do protótipo. O backend não aceita um nome de função arbitrário enviado pelo cliente.

## Contratos planejados — NÃO implementados

| Fase | Recursos |
| --- | --- |
| B | `/products`, `/niches`, `/customers`, `/sales`, `/inventory`, `/assets`, `/changes` |
| C | `/auth/activation`, emissão de sessão/login, `/auth/recovery`, `/users`, `/me` |
| D | `/audit`, `/notifications`, `/schedules`, `/reports` |
| E | Checkout anônimo, sincronização e políticas offline homologadas |

Antes de implementar: DTOs com allowlist, identidade de servidor, paginação/versão incremental, preço em centavos, versões de registro/If-Match para edições, chave idempotente por comando e corpo canônico, CSRF/origem para mutações e controle de acesso por campo. Nenhum caminho futuro descrito nesta tabela deve ser considerado disponível.

Detalhes e limites da parte de identidade: [SESSOES_E_PERMISSOES.md](SESSOES_E_PERMISSOES.md). Situação de todas as fases: [STATUS_V17.md](STATUS_V17.md).

## Controles internos de primeiro acesso

`identity.guard.attempt` e `identity.challenge.create/consume` usam a bridge assinada, com habilitação DEV independente. Não existem rotas públicas correspondentes nesta entrega. Os limites, pré-condições, armazenamento privado e pendências de ativação estão em [CONTROLES_PRIMEIRO_ACESSO.md](CONTROLES_PRIMEIRO_ACESSO.md).

## Passkeys internas

`identity.passkey.list/begin/take/register/counter` têm trava DEV independente e não são expostas como rotas HTTP do navegador. Verificação WebAuthn, persistência, testes e pendências em [PASSKEYS.md](PASSKEYS.md).

## Auditoria administrativa DEV

`GET /api/v1/audit/list`: parâmetros `from`/`to` UTC canônicos, `employeeId`, `operation`, `productId`, `saleId`, `result`, `offset` e `snapshot`. Filtros opcionais usam string vazia, período máximo de 366 dias. Página de 25; offset maior que zero exige snapshot. Resposta protegida com campos operacionais autorizados e metadados de responsáveis, sem contatos/cifra.

`POST /api/v1/audit/export`: `{commandId, filters, snapshot}`, com origem exata/CSRF e autenticação administrativa recente. Registra autorização e retorna OOXML `.xlsx` binário, até 500 eventos e 30 mil campos, com no-store. Mudança da origem exige nova consulta; repetição do mesmo comando/autor/carga recupera o resultado original. Nenhuma rota de alteração/exclusão de auditoria. Flags próprias fechadas por padrão. [Contrato completo](AUDITORIA_DEV.md).

## Eventos internos de segurança

`identity.security.record` é uma RPC interna assinada, sem Function pública própria. Aceita somente `commandId`, `phase` e `code` permitidos; registra autor SYSTEM_AUTH sem identificador/credenciais recebidos do usuário. O controlador só a usa após negativa de autenticação validada. Logout mantém `POST /api/v1/session/logout` com cookie/origem/CSRF e pode reconhecer repetição de revogação já concluída sem voltar a conceder autenticação. Ver [EVENTOS_AUDITORIA_DEV.md](EVENTOS_AUDITORIA_DEV.md).

## Relatórios comerciais DEV

`POST /api/v1/reports/query` recebe `{filters}` com tipo SALES/STOCK/MOVEMENTS, período UTC canônico quando aplicável e filtros do contrato. Exige administrador com autenticação forte recente, origem exata e CSRF. Nunca usar CPF em URL. Resposta contém conjunto completo protegido, indicadores/rankings e prova de consulta válida por cinco minutos.

`POST /api/v1/reports/export` recebe `{commandId, filters, sourceSnapshot, expiresAt, proof}` da consulta anterior. Mesma sessão/versão/filtros/fonte; após alteração relevante ou expiração é necessário consultar novamente. Retorna `.xlsx` binário com todos os resultados após registrar a autorização. RPCs internas reports.source/record são assinadas e não são endpoints públicos de consulta livre. Flags próprias fechadas por padrão. [Contrato](RELATORIOS_COMERCIAIS_DEV.md).

## Perfil de compra e preparação manual DEV

`POST /api/v1/customer-insights/query`: `{customerId}`. ADMIN/SUPER_ADMIN com autenticação forte recente, origem DEV e CSRF. Localizar o cadastro por `customers/find` já existente (CPF em POST). Retorna perfil individual completo dentro dos limites, indicadores, nichos, faixa histórica e até 12 sugestões entre todos os candidatos, com contagem explícita. Sem contatos/CPF na resposta.

`POST /api/v1/customer-insights/message`: `{commandId,customerId,productIds,sourceSnapshot,expiresAt,proof}`. De um a três produtos sugeridos na mesma fonte/consulta/sessão válida por cinco minutos; preferência WhatsApp, consentimento/data e telefone válido no cadastro são revalidados. Registra autorização e retorna apenas texto para revisão/cópia, sem envio, link, telefone ou provedor externo. Mesma chave/carga é idempotente; alteração de fonte/expiração exige nova consulta. RPCs internas `insights.source/record` assinadas, sem Function pública livre. Flags próprias fechadas por padrão. [Contrato](PERFIL_COMPRA_DEV.md).
