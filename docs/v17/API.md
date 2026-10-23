# API da Fase A

URL base: mesmo domínio do frontend, `/api/v1`. Não usar chamadas diretas do browser ao Apps Script ou à planilha.

| Endpoint | Estado | Acesso | Resultado |
| --- | --- | --- | --- |
| `GET /api/v1/health` | Implementado | Público | `{ "ok": true }`, liveness do handler, sem IDs/configuração |
| `GET /api/v1/schema` | Handler/adaptador implementados, identidade fechada | Futuro ADMIN/SUPER_ADMIN com MFA/passkey recente | `data.schemaVersion`, nomes das abas e ID de correlação |

Liveness não comprova autorização Google, schema instalado, credenciais ou readiness operacional. O endpoint administrativo retorna 503 por padrão (`SERVICE_NOT_ACTIVATED`); com configuração válida, o autenticador da Fase A continua retornando `IDENTITY_NOT_IMPLEMENTED`. Isso é intencional. PINs 1357/2468, Bearer com PIN e headers de papel não autenticarão a API.

Métodos diferentes de GET retornam 405/Allow: GET. Todas as respostas usam JSON, `no-store` e `nosniff`. Erros têm a forma `{ "error": { "code": "...", "requestId": "..." } }`, sem stack/payload. 401/403 são usados pelo contrato de autenticação/autorização; 502/503 representam falhas fechadas do adaptador/configuração. Não devolver mensagens brutas do Google.

## Bridge entre servidores

Envelope HTTP POST para `/exec`, nunca para o browser:

```text
{ message: base64(UTF8(JSON(request))), signature: hex(HMAC-SHA256(key, "request.v1." + message)) }
```

O request contém versão 1, ambiente, UUID de instalação, IDs de recursos, requestId, issuedAt em milissegundos, nonce aleatório de 32 bytes, ação `system.schema`, actor afirmado pelo backend autenticado e payload vazio. Apps Script verifica assinatura antes de interpretar o corpo e confirma todos os bindings e a janela temporal.

Resposta autenticada usa o prefixo `response.v1.`, com ambiente, instalação, requestId e nonce idênticos, sentAt e sucesso/dado ou erro seguro. O backend verifica assinatura e correlação antes de repassar somente schemaVersion/nomes autorizados. O redirect próprio do ContentService é GET HTTPS restrito, sem reenviar identidade ou o POST.

Não há CRUD público nem proxy genérico de ações do protótipo. O backend não aceita um nome de função arbitrário enviado pelo cliente.

## Contratos planejados — NÃO implementados

| Fase | Recursos |
| --- | --- |
| B | `/products`, `/niches`, `/customers`, `/sales`, `/inventory`, `/assets`, `/changes` |
| C | `/auth/activation`, `/auth/session`, `/auth/recovery`, `/sessions`, `/users`, `/me` |
| D | `/audit`, `/notifications`, `/schedules`, `/reports` |
| E | Checkout anônimo, sincronização e políticas offline homologadas |

Antes de implementar: DTOs com allowlist, identidade de servidor, paginação/versão incremental, preço em centavos, versões de registro/If-Match para edições, chave idempotente por comando e corpo canônico, CSRF/origem para mutações e controle de acesso por campo. Nenhum caminho futuro descrito nesta tabela deve ser considerado disponível.
