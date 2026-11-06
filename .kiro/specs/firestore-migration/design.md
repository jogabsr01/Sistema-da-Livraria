# Design — Migração do armazenamento vivo para o Firestore

## 1. Decisões aprovadas e escopo

Este design implementa a migração apenas no ambiente `dev`. O ambiente `prod` não será
alterado por esta spec.

Decisões confirmadas pelo responsável após a revisão dos requisitos:

- a credencial principal deixa de ser PIN e passa a ser senha de 8 a 40 caracteres;
- a interface, os textos, os nomes dos campos e o contrato de entrada específicos de PIN
  serão substituídos pela terminologia e pelo comportamento de senha;
- todo código entregue por e-mail, seja para definição, redefinição, ativação, recuperação,
  troca de e-mail ou outra confirmação equivalente, terá validade de 900 segundos;
- a instrumentação será ampliada para as nove operações de desempenho antes da baseline;
- relatórios continuam sendo arquivos `.xlsx` sob demanda, sem planilha Google viva;
- o navegador nunca acessará o Firestore diretamente;
- a autorização continuará no backend, reutilizando a matriz existente em
  `backend/authorization.mjs`.

A alteração de PIN para senha e a alteração da validade dos códigos são as duas exceções
explicitamente autorizadas pelo Requisito 2. Os demais códigos, estados, erros, limites,
papéis, sessão de 24 horas, autenticação forte recente de 5 minutos e regras de negócio
continuam idênticos.

### 1.1. Limites deste design

Este documento define a arquitetura e o procedimento. Ele não cria o projeto Google Cloud,
não altera o Netlify, não faz deploy, não migra dados reais e não exclui dados. Essas ações
serão executadas somente em uma etapa posterior, com confirmação operacional do responsável.

As seguintes dependências ficam deliberadamente explícitas para a implementação:

- projeto Google Cloud separado para `dev`, Firestore Native, região, IAM, bucket de backup
  e alertas de orçamento;
- credencial do backend para o Firestore, fornecida por variável de ambiente ou mecanismo
  equivalente já aprovado pelo projeto;
- provedor de e-mail com chave e domínio/configuração aprovados. O provedor será acessado
  somente pelo outbox, nunca dentro de uma transação Firestore;
- acesso do backend aos ativos de imagem que permanecerem no Drive, ou decisão posterior de
  mover esses ativos para Cloud Storage;
- definição operacional da rotina de exportação e restauração de backups.

A implementação deve parar e avisar o responsável antes de qualquer dependência que exija
configuração externa. Nenhuma credencial será escrita no repositório.

## 2. Arquitetura alvo

### 2.1. Fluxo de requisição

```text
Navegador
  -> Netlify Function /api/v1/...
  -> handler HTTP existente
  -> autenticação de sessão, CSRF, origem e RBAC existentes
  -> fachada createWorkspaceClient(...)
  -> serviço de domínio Node
  -> repositório Firestore
  -> transação ou consulta Firestore
  -> DTO existente e resposta HTTP existente
```

O `ScriptLock`, o envelope HMAC RPC, o nonce `_Requisicoes` e o dispatcher GAS deixam de
participar do caminho normal depois do corte do domínio. O Apps Script permanece como
adaptador de fallback durante a migração e o período de rollback, não como fonte de verdade
ao mesmo tempo que o Firestore.

A fachada `createWorkspaceClient` será preservada para reduzir o risco de alteração nos
handlers. Sua implementação será dividida em dois adaptadores:

- `gas-workspace-client`: implementação atual, mantida durante inventário, importação,
  shadow-read e rollback;
- `firestore-workspace-client`: implementação nova, com os mesmos métodos de domínio e DTOs
  públicos, sem `WORKSPACE_SCRIPT_URL` no caminho Firestore.

Um seletor de armazenamento por ambiente escolherá `gas`, `shadow` ou `firestore`:

- `gas`: leitura e escrita somente no GAS/Sheets;
- `shadow`: GAS continua autoritativo; o Firestore recebe somente importação ou leitura de
  comparação controlada, sem alterar a resposta do usuário;
- `firestore`: Firestore é autoritativo para o agregado cortado; o GAS não recebe dual-write
  normal.

O seletor será validado no carregamento da configuração. Qualquer valor desconhecido fará a
Function falhar fechadamente com erro de configuração.

### 2.2. Camadas

| Camada | Responsabilidade | Regra de desenho |
|---|---|---|
| Handlers HTTP | Rotas, método, origem, tamanho do corpo, DTO e código HTTP | Não conterão acesso ao Firestore |
| Serviços existentes | Sessão, RBAC, CSRF, WebAuthn, validação, criptografia e XLSX | Reutilizarão os módulos atuais sempre que forem agnósticos ao armazenamento |
| Fachada workspace | Contrato de operações usado pelos handlers | Mantém nomes e formatos internos durante a transição |
| Serviços de domínio | Compor consultas, comandos, transações e outbox | Não executarão efeitos externos dentro de transações |
| Repositórios | Leitura/escrita tipada de documentos | Proíbem update/delete de auditoria e validam schema |
| Infraestrutura Firestore | Cliente, retries, métricas, índices e configuração | Somente backend, com credencial de menor privilégio |
| Migração | Importação, reconciliação, cutover, replay e rollback | Executada por scripts explícitos, nunca por uma rota pública |

### 2.3. Módulos previstos

Os nomes abaixo são a divisão prevista para a implementação. Eles não exigem refatoração
fora da migração:

- `backend/firestore-config.mjs`: configuração, cliente e seleção `dev`;
- `backend/firestore-client.mjs`: fachada compatível com `workspace-client.mjs`;
- `backend/firestore-repositories.mjs`: acesso tipado às coleções;
- `backend/firestore-transactions.mjs`: transações, classificação de conflitos e backoff;
- `backend/firestore-commands.mjs`: intenção durável, fingerprint, idempotência e recuperação;
- `backend/firestore-outbox.mjs`: e-mail e demais efeitos externos pós-commit;
- `backend/firestore-observability.mjs`: métricas, `Server-Timing` e logs estruturados;
- `backend/firestore-assets.mjs`: leitura de capas, fotos e imagens fora dos documentos;
- `scripts/firestore-migration-*.mjs`: inventário, importação, reconciliação, replay e
  verificação;
- `tests/backend/firestore-*.test.mjs`: contrato, transação, concorrência e recuperação.

Os handlers existentes continuarão sendo os pontos de entrada. A troca de `createWorkspaceClient`
não autoriza mover regra de autorização para o repositório.

## 3. Configuração e isolamento

### 3.1. Ambiente

O projeto `dev` terá projeto Google Cloud próprio, banco Firestore próprio e credencial
própria. Nenhum ID de projeto, banco, bucket, chave privada ou segredo será fixado no código.
A configuração mínima esperada será:

```text
WORKSPACE_STORAGE_MODE=gas|shadow|firestore
WORKSPACE_FIRESTORE_PROJECT_ID=<projeto dev>
WORKSPACE_FIRESTORE_DATABASE=(default)
WORKSPACE_FIRESTORE_LOCATION=<região aprovada>
WORKSPACE_FIRESTORE_SERVICE_ACCOUNT_JSON=<fornecido fora do repositório>
WORKSPACE_FIRESTORE_PREFIX=dev
WORKSPACE_EMAIL_PROVIDER=<provedor aprovado>
WORKSPACE_EMAIL_PROVIDER_KEY=<segredo externo>
WORKSPACE_EMAIL_DELIVERY_KEY=<chave externa separada>
WORKSPACE_ASSET_STORE=drive
```

O nome real das variáveis seguirá a convenção já usada pelo projeto e será documentado no
`.env.example` sem valores secretos. O cliente recusará usar configuração `prod` quando
`APP_ENV=dev`, mesmo que os demais valores pareçam válidos.

A opção inicial para ativos é `drive`: capas, fotos de perfil e imagens de nicho continuam
referenciadas pelos IDs existentes e não serão gravadas em documentos Firestore. O adaptador
de ativos terá leitura privada, validação de MIME/tamanho/hash e os mesmos endpoints de
imagem. A migração para Cloud Storage será uma decisão separada, não uma condição escondida
do corte transacional.

### 3.2. IAM e acesso

O backend usará uma identidade de serviço com acesso de aplicação ao banco `dev`. O papel
mínimo necessário será validado no projeto escolhido. A rotina de backup usará identidade
separada, somente se a exportação gerenciada exigir permissões adicionais.

O Admin SDK/cliente servidor não é protegido pelas Security Rules como um navegador seria.
Por isso:

- o navegador não receberá credenciais Firestore;
- as Security Rules não serão tratadas como camada de RBAC;
- a conta do backend ficará restrita ao projeto `dev`;
- acesso humano direto ao banco será limitado a administradores designados e auditado;
- a aplicação não terá rota genérica de consulta ou escrita de coleção;
- dados sensíveis, credenciais e tokens continuarão fora dos logs.

A proteção contra uma rota normal, contra acesso IAM privilegiado e a detecção de adulteração
serão tratadas como controles distintos. Não será afirmado que o Firestore fornece
imutabilidade absoluta.

## 4. Modelo de dados

Todos os horários serão armazenados como Timestamp UTC ou ISO UTC conforme o cliente, e
convertidos para `America/Sao_Paulo` somente na apresentação. Valores monetários serão
inteiros em centavos. IDs de negócio continuarão sendo UUIDs existentes; os IDs de
unicidade e índices usarão chaves HMAC ou chaves compostas, nunca CPF/e-mail em texto puro.

Nenhum documento conterá uma lista de vendas, movimentos, auditoria, sessões ou usuários do
sistema inteiro. Isso evita o equivalente Firestore de um contador ou fila global.

### 4.1. Identidade, credenciais e sessões

| Coleção | Documento | Campos principais | Índices/garantias |
|---|---|---|---|
| `users` | `userId` | papel, status, owner, `authorizationVersion`, contato cifrado, índices HMAC, revisão, datas | papel/status e revisão; campos cifrados e hashes grandes sem indexação |
| `users/{userId}/credentials` | `primary` | `credentialType`, `version`, algoritmo, salt, hash, atualizado em | documento único por usuário; `PIN_LEGACY` somente durante transição |
| `users/{userId}/passkeys` | hash do credential ID | chave pública, contador, transports, versão, criado/atualizado/revogado | até 5 por usuário; credential ID não fica em texto em logs |
| `sessions` | `sessionId` | user, token hash, criado, expira, revogado, assurance, versão de autorização, dispositivo cifrado | consulta por usuário e expiração |
| `sessionTokenIndex` | HMAC/hash do token | `sessionId`, user, criado, expira | documento de reserva único para leitura O(1) |
| `authFlows` | `flowId` | propósito, estado, subject, versão, hash do código, `codeExpiresAt`, `flowExpiresAt`, tentativas, cerimônia, intenção | token hash e cerimônia com documentos de unicidade |
| `authChallenges` | `challengeId` | tipo, hash, expiração, uso, subject, cerimônia | consumo atômico e uso único |
| `authRateLimits` | HMAC da conta/origem | janela, tentativas, bloqueio, última tentativa | uma chave por conta e por origem; sem contador global |
| `emailOutbox` | `messageId` | destinatário cifrado, template, `deliveryCiphertext` do código, hash do código, idempotency key, estado, tentativas | código cifrado em repouso; nunca texto puro em consulta/log/auditoria |
| `emergencyRecovery` | `userId` | até 6 hashes de códigos, versão e estado | consumo de um código em transação |
| `keyManagement` | `userId` | comando atual, estado, expiração, hashes de desafios | uma operação ativa por usuário, com revisão |

O hash do token de sessão e os hashes de credencial são valores restritos. O cliente só
receberá o cookie bruto da sessão ou o DTO já permitido; nunca esses campos.

### 4.2. Senha no lugar do PIN

A credencial terá um tipo explícito:

```text
credentialType: PASSWORD_V1
version: 1
algorithm: scrypt-N32768-r8-p1
salt: 32 bytes em hexadecimal
hash: 32 bytes em hexadecimal
```

Contas importadas antes da transição serão marcadas como `PIN_LEGACY`, com o mesmo registro
scrypt existente. O tipo nunca será inferido pelo hash.

A senha será processada exatamente como digitada:

- comprimento contado por ponto de código Unicode (`Array.from(value).length`), entre 8 e 40;
- nenhum `trim`, remoção de espaço interno ou normalização silenciosa;
- letras, números, símbolos e espaços são aceitos livremente;
- a regra de dígitos iguais lado a lado não será aplicada;
- texto puro nunca será persistido, incluído em fingerprint, log, resposta ou auditoria;
- o backend repetirá toda validação feita no frontend;
- a verificação de senha comprometida ficará desligada até existir mecanismo aprovado sem
  custo obrigatório. A ausência desse mecanismo não bloqueia a migração.

O frontend trocará `login-pin`, `new-pin`, textos, mensagens e payloads para `password`,
`newPassword` ou o nome final definido pelo contrato do handler. O modo de senha restrito a
`dev` usará `ADMIN_PASSWORD_LOGIN_ENABLED`; durante a implantação poderá existir leitura
controlada do nome antigo apenas para detectar configuração incompleta, nunca para reativar a
semântica de PIN.

Fluxos:

1. **Ativação/primeiro acesso:** código de e-mail de 900 segundos, definição de senha,
   registro de passkey e commit da sessão.
2. **Login de conta com senha:** lookup com registro dummy, verificação scrypt constante,
   criação do fluxo e autenticação WebAuthn, depois sessão de 24 horas.
3. **Conta `PIN_LEGACY`:** a entrada de quatro dígitos nunca será validada como senha. O
   usuário será encaminhado ao fluxo explícito de migração, com código de e-mail e passkey
   existente; sem passkey, usará recuperação autorizada. A sessão só será criada depois de
   definir a senha e completar o fator exigido.
4. **Recuperação:** código de e-mail, código de emergência ou passkey conforme o fluxo
   existente, definição de senha nova e incremento atômico da versão de autorização.
5. **Troca de e-mail:** código enviado ao novo endereço por 900 segundos; confirmação,
   reserva de e-mail e revogação de outras sessões na mesma operação de identidade.

A versão de autorização será incrementada na mesma transação que concluir definição,
redefinição de senha, troca de e-mail, alteração de papel/status e revogação de passkey.
A criação da sessão lerá essa versão dentro da transação, evitando sessão criada com epoch
antigo.

`codeExpiresAt` e `flowExpiresAt` serão campos distintos. Para qualquer fluxo que dependa de
código entregue por e-mail, ambos serão inicialmente 900 segundos, para que um código ainda
válido não fique inutilizável porque o fluxo expirou antes. Os códigos de acesso continuarão
com sete caracteres e alfabeto sem `I`, `O`, `0` e `1`; o token de confirmação de troca de
e-mail, que usa formato URL-safe próprio, manterá esse formato e também terá TTL de 900
segundos. A cerimônia WebAuthn continuará com a janela própria já existente; a autenticação
forte recente continuará em 5 minutos. Códigos de emergência, challenges WebAuthn e tokens
internos não serão tratados como códigos de e-mail e conservarão suas janelas específicas.

### 4.3. Catálogo, nichos e ativos

| Coleção | Documento | Campos/uso |
|---|---|---|
| `products` | `productId` | ISBN, código, campos normalizados, preço em centavos, estoque, mínimo, `active`, `version`, datas, `nicheIds`, referência de capa |
| `productSearch` | `productId` | tokens normalizados de busca, revisão do índice e campos de apoio |
| `niches` | `nicheId` | nome, descrição, cor, ordem, ativo, versão, referência de imagem |
| `uniqueness` | `active-isbn:{value}` / `active-code:{value}` | owner, tipo, revisão e estado da reserva |
| `stockMovements` | `movementId` | produto, tipo, quantidade, saldos anterior/posterior, versão, venda, operador, data |

`nicheIds` é a única desnormalização de produto necessária para a consulta existente por
nicho; o limite de 20 continua sendo validado. Produtos continuam sendo documentos
independentes, sem documento agregado de catálogo.

A busca textual preservará a semântica de correspondência parcial por meio de índice
auxiliar. Para cada produto ativo será gerado um conjunto limitado de n-gramas normalizados
nos campos atualmente pesquisáveis. A consulta usa um n-grama seletivo para obter candidatos
e o serviço Node aplica a comparação `includes` normalizada nos campos completos antes de
ordenar e paginar. Para consultas curtas serão usados tokens de um e dois caracteres com
limite de candidatos; quando o limite seguro for excedido, o serviço retornará o erro de
capacidade já previsto em vez de inventar uma resposta incompleta. A atualização do índice
ocorrerá na mesma transação do produto ou por comando de reconstrução determinístico quando
o índice ainda estiver em importação.

ISBN e código interno não dependerão de índice Firestore para unicidade. A reserva em
`uniqueness` será criada, liberada ou trocada na mesma transação do produto ativo. Um produto
inativo não mantém a reserva ativa. A transação de reativação lê a reserva atual e falha com
`CATALOG_DUPLICATE` se outro produto a possuir.

Capas e imagens permanecem fora do documento. O Firestore guarda apenas referência, hash,
versão e estado; os endpoints existentes continuam validando bytes JPEG, tamanho e hash
antes de entregar uma resposta privada.

### 4.4. Limites de documento e divisão

O repositório rejeitará qualquer documento antes da gravação quando a serialização exceder
uma margem de segurança de 900 KiB, mantendo folga para metadados e evolução do schema. O
limite do Firestore não será tratado como algo que o retry possa resolver.

- itens de venda ficam em `sales/{saleId}/items`, nunca em um array ilimitado da venda;
- movimentos e auditorias são um documento por evento;
- payloads de domínio têm campos permitidos, tamanho máximo e, quando necessário, conteúdo
  cifrado separado;
- n-gramas de busca são limitados por campo e reconstruíveis a partir do produto; se o índice
  ultrapassar a margem, o produto é rejeitado com erro de capacidade;
- imagens e blobs nunca entram em documentos;
- a importação falha de forma explícita diante de uma linha grande, em vez de truncá-la.

### 4.5. Clientes e equipe

`customers/{customerId}` armazenará o contato cifrado com o mesmo `createPersonalDataVault`,
versão de chave e índice HMAC de CPF. `users/{userId}` armazenará os dados cifrados da equipe
com o mesmo esquema e índices independentes de e-mail e CPF.

As reservas serão documentos separados:

```text
uniqueness/staff-email:{hmac}
uniqueness/staff-cpf:{hmac}
uniqueness/customer-cpf:{hmac}
```

A transação escreve a reserva junto com a revisão da pessoa. O navegador recebe somente
DTOs produzidos pelos handlers, incluindo CPF mascarado. Antes, depois, contatos cifrados e
índices não entram em auditoria ou XLSX.

### 4.6. Vendas e estoque

| Coleção | Documento | Uso |
|---|---|---|
| `sales` | `saleId` | cliente, atendente, total, pagamento, status, origem, idempotency key, data |
| `sales/{saleId}/items` | `productId` ou line ID determinístico | quantidade, preço unitário e subtotal confirmados pelo servidor |
| `stockMovements` | movimento UUID determinístico por comando | cadeia de saldo e versão por produto |
| `commands` | domínio + command/idempotency key | intenção, fingerprint, ator, estado e resposta determinística |
| `domainEvents` | `eventId` derivado do comando | evento autoritativo e estado de projeção/replay |

Um checkout de até 100 linhas será executado em uma transação. O serviço contará leituras,
escritas e tamanho antes de confirmar. Para o pior caso de 100 produtos distintos, a
operação escreverá comando, evento, venda, itens, movimentos e auditoria dentro do limite
operacional reservado; projeções de notificação não entram na transação e vão para outbox.
Se uma futura alteração fizer a operação ultrapassar o orçamento Firestore, ela será
rejeitada explicitamente e não dividida em duas fases que permitam estoque parcial.

O produto e sua versão serão lidos dentro da transação. O checkout recalculará preço,
produto ativo, cliente e estoque. Cada produto será atualizado com `version + 1`, e o
movimento registrará `stockBefore`, `stockAfter`, `versionBefore` e `versionAfter`.
Duas vendas concorrentes da última unidade terão exatamente um commit vencedor.

### 4.7. Auditoria, notificações, escalas e configurações

| Coleção | Documento | Observação |
|---|---|---|
| `auditEvents` | `eventId` único | append-only na aplicação, relógio do servidor, ator e resultado sanitizados |
| `notifications` | `notificationId` | corpo e estado da notificação |
| `notificationRecipients` | `notificationId:userId` | leitura, confirmação e estado por destinatário |
| `schedules` | `scheduleId` | escala, funcionário, data, horário, status e versão |
| `settings` | chave estável | configurações não secretas e versão |
| `migrationRuns` | execução UUID | origem, hash, contagens, etapa, fonte da verdade e evidências |
| `outbox` | evento/efeito UUID | e-mail e projeções pós-commit, com lease e retry |

A auditoria entra na mesma transação do negócio. Nenhum repositório comum possuirá método
de update/delete de `auditEvents`. Auditoria de relatórios e insights será registrada em
comando idempotente, depois da leitura coerente, sem incluir dados pessoais completos.

Os três níveis de proteção ficam separados:

- rotas e repositórios normais não conseguem atualizar ou excluir auditoria;
- IAM restringe o acesso humano e de serviço, mas administradores com privilégio direto no
  projeto continuam sendo uma ameaça distinta que o Firestore sozinho não elimina;
- Cloud Audit Logs, exportação de backup e reconciliação de hashes/contagens fornecem
  evidência de alterações administrativas. Um hash encadeado global não será usado porque
  recriaria contenção; qualquer mecanismo futuro deverá ser particionado.

Notificações derivadas de estoque e escalas são efeitos de outbox. Uma falha na projeção de
notificação não invalida sessão, venda ou auditoria. A leitura de sessão não executará
recuperação de todos os domínios, como ocorre hoje no GAS.

## 5. Índices, consultas e paginação

### 5.1. Índices compostos

A configuração versionada de índices terá, no mínimo:

| Consulta | Índice/estratégia |
|---|---|
| produtos ativos por ordem/data | `active + updatedAt` |
| produtos por nicho | `active + nicheIds array-contains + updatedAt` |
| vendas por período/status | `createdAt + status` |
| vendas por cliente | `customerId + createdAt` |
| itens/movimentos por produto | `productId + occurredAt` |
| sessões de usuário | `userId + expiresAt` |
| auditoria por período | `occurredAt`, com combinações de ator, ação, entidade e resultado conforme consultas reais |
| notificações de destinatário | `userId + status + createdAt` |
| escalas de funcionário/período | `employeeId + date + status` |
| outbox pendente | `state + nextAttemptAt` |

Campos cifrados, ciphertext, payload de evento, conteúdo de e-mail e imagens serão
excluídos de indexação quando não forem consultados. Índice não será descrito como mecanismo
de unicidade: unicidade é responsabilidade dos documentos `uniqueness` e das transações.

### 5.2. Paginação

O contrato atual de páginas usa `offset`, `limit` implícito e `nextOffset`. Não haverá
mudança visível nas telas.

A implementação nova terá dois caminhos:

- o frontend atualizado internamente enviará um cursor opaco assinado, mantido fora da
  apresentação, e o backend usará `startAfter`; a resposta continuará contendo `nextOffset`
  para compatibilidade e poderá conter `nextCursor` como extensão não sensível;
- clientes antigos que enviarem somente `offset` continuarão funcionando por uma janela de
  compatibilidade limitada, com `offset` convertido para cursor por uma leitura paginada
  controlada. O limite continuará sendo 5.000 e esse caminho será marcado nas métricas.

O cursor incluirá hash de consulta, última chave de ordenação, revisão do snapshot lógico,
usuário/escopo quando necessário e expiração curta. Um cursor de outra consulta ou conta será
rejeitado. Não será criado um contador global nem uma tabela de sessão global para páginas.

Para auditoria, relatórios, escalas, notificações e operações serão usados cursores próprios;
o formato legado de `nextOffset` continuará sendo produzido enquanto o frontend depender dele.
O ganho de custo/latência do caminho novo será medido separadamente do fallback.

## 6. Transações, comandos e recuperação

### 6.1. Regra geral

Cada mutação segue este fluxo:

1. validar payload, sessão, CSRF, papel e reautenticação no handler;
2. calcular fingerprint canônico sem segredo ou dado pessoal em texto;
3. iniciar transação e ler o documento de comando;
4. se o comando já estiver `COMMITTED`, comparar ator, operação e fingerprint e devolver o
   resultado salvo;
5. se estiver em estado incompatível, recuperar ou devolver o conflito correspondente;
6. ler todas as pré-condições dentro da transação;
7. reservar unicidades, atualizar agregados, criar evento e auditoria;
8. gravar comando `COMMITTED` com resultado mínimo necessário;
9. confirmar a transação;
10. publicar ou processar outbox depois do commit;
11. devolver o mesmo DTO de sucesso.

O callback transacional será puro: não enviará e-mail, não chamará Drive, não emitirá evento
externo, não usará relógio mutável para decidir duas vezes e não dependerá de estado em
memória. O SDK poderá reexecutá-lo.

### 6.2. Versões e conflitos

Produtos, clientes, usuários, escalas, nichos e demais agregados mutáveis terão `version` ou
`revision` inteiro. A transação exige a versão esperada do comando e incrementa exatamente
uma vez. Divergência produz o erro público já existente, por exemplo `CATALOG_CONFLICT`,
`CUSTOMER_CONFLICT`, `STAFF_CONFLICT`, `OPERATION_CONFLICT` ou `SCHEDULE_CONFLICT`.

`ABORTED` do Firestore será repetido somente enquanto for conflito transitório do SDK. Depois
do limite, será mapeado para conflito do domínio quando houver pré-condição conhecida ou
para `UNAVAILABLE` quando não houver decisão segura. `DEADLINE_EXCEEDED`, indisponibilidade e
resultado incerto nunca serão convertidos silenciosamente em uma nova venda.

A política de tentativa é no máximo cinco tentativas transacionais, com backoff crescente e
jitter, respeitando o deadline da Function. O chamador não fará loop adicional imediato.

### 6.3. Retenção de idempotência

- comandos de cadastro, estoque, equipe, cliente, nicho, escala e perfil: 90 dias após
  `COMMITTED`;
- checkout, estorno e ajuste de estoque: 1 ano após `COMMITTED`, por serem operações
  financeiras e de saldo;
- registros de comando são mantidos por mais tempo quando ainda referenciados por auditoria,
  evento ou reconciliação;
- TTL é somente limpeza eventual. A segurança não dependerá de o documento desaparecer no
  instante do vencimento.

Após a retenção, um retry antigo pode ser tratado como novo apenas se o contrato operacional
já o considerar fora da janela legítima. O cliente deve consultar o estado atual antes de
repetir qualquer timeout incerto fora dessa janela.

### 6.4. Checkout

O comando de checkout usa a `idempotencyKey` HTTP como chave interna estável. A transação:

- valida e lê o comando;
- lê cliente, quando informado;
- lê cada produto e sua versão;
- recalcula preço e total;
- rejeita produto inativo, preço alterado ou estoque insuficiente;
- grava venda, itens, movimentos, evento, auditoria e resultado do comando;
- atualiza `ultimaCompra` do cliente na mesma transação quando aplicável.

Os itens e movimentos serão identificados deterministically a partir da venda e do produto.
Uma repetição depois de timeout consultará `commands`/`sales` antes de permitir qualquer
nova escrita.

### 6.5. E-mail e outbox

Definição de senha, recuperação e troca de e-mail gravam primeiro o fluxo, hash do código e
um item `emailOutbox`. O outbox contém somente o material mínimo: destinatário cifrado,
template, `deliveryCiphertext` cifrado por uma chave de entrega separada, hash/fingerprint
e idempotency key. O worker descriptografa o código somente em memória, monta a mensagem e
não o grava, registra ou envia para nenhum log. O código em texto não entra em auditoria ou
documento de negócio; o ciphertext também fica fora de indexação e de respostas HTTP.

Um worker ou Function agendada busca itens com lease, envia ao provedor usando idempotency
key e confirma o estado. Em timeout incerto, consulta o provedor pela idempotency key antes
de reenviar. Tentativas limitadas usam backoff; falha final marca `DELIVERY_UNAVAILABLE` e
mantém a operação recuperável sem expor o código.

Nesta etapa, o adaptador Resend consulta um `providerId` já conhecido pelo endpoint de
recuperação do e-mail ([API de recuperação](https://resend.com/docs/api-reference/emails/retrieve-email)). A API documenta a
idempotency key no envio ([API de envio](https://resend.com/docs/api-reference/emails/send-email)), mas não oferece uma consulta
autoritativa por essa chave; se o POST expirar antes de devolver o `providerId`, o item fica
em `UNCERTAIN` e não é reenviado automaticamente. A escolha de um provedor com consulta por
idempotency key, ou um procedimento operacional equivalente, continua bloqueante para ligar
os fluxos.

A escolha do provedor e a configuração de domínio são dependências do responsável. A
implementação do outbox não será ligada a uma conta sem essa configuração.

## 7. Equivalência HTTP

A camada HTTP existente permanece. A tabela abaixo é a matriz de equivalência inicial exigida
pelo Requisito 1.5. Cada linha deve receber testes de sucesso, validação, autorização e
conflito quando aplicável.

| Endpoint | Operações | Implementação atual | Implementação Firestore | Resultado |
|---|---|---|---|---|
| `/api/v1/health` | GET | liveness Netlify | igual, sem Firestore | idêntico |
| `/api/v1/access/:operation` | `state`, `start`, `recover`, `login`, `biometric`, `continue-login`, `device-login`, `email`, `options`, `complete`, `cookie`, `rescue` | `owner-access` + GAS/controles | serviço de identidade, `authFlows`, outbox e passkeys | idêntico, exceto senha, PIN e TTL de e-mail |
| `/api/v1/access/password` | definição/redefinição | não existe como senha | grava `PASSWORD_V1` em fluxo autenticado | exceção autorizada do Requisito 2 |
| `/api/v1/session` | GET | sessão via GAS | `sessions` + epoch Firestore | idêntico |
| `/api/v1/session/logout` | POST | revoga sessão via GAS | revoga sessão em transação | idêntico |
| `/api/v1/session/revoke-others` | POST | revoga outras sessões via GAS | incrementa/revalida epoch e revoga as demais | idêntico |
| `/api/v1/catalog/:operation` | `bootstrap`, `list`, `get`, `niches`, `save`, `isbn`, `cover`, `receive`, `remove` | `Produtos`, nichos, Drive e locks GAS | `products`, `niches`, `stockMovements`, reservas e asset adapter | idêntico |
| `/api/v1/checkout` | POST | venda, itens, journal e estoque sob ScriptLock | transação por produtos, venda, movimentos, comando e auditoria | idêntico |
| `/api/v1/customers/:operation` | `find`, `get`, `save`, `postal-code` | clientes e limitadores GAS | `customers`, reservas HMAC e rate limit por chave | idêntico |
| `/api/v1/staff/:operation` | `bootstrap`, `list`, `save` | usuários/equipe e controles GAS | `users`, credenciais, reservas e outbox | idêntico, exceto senha |
| `/api/v1/profile/:operation` | `bootstrap`, `get`, `save`, `photo` | perfil, propriedades/Drive e GAS | `users`, revisão, vault e asset adapter | idêntico |
| `/api/v1/email-change/:operation` | `state`, `start`, `confirm`, `cancel` | intent e token GAS | fluxo, reserva de e-mail, outbox e epoch | idêntico, TTL do código = 900 s |
| `/api/v1/keys/:operation` | `list`, `state`, `start`, `prove`, `complete`, `cancel` | passkeys/códigos e intents GAS | subcoleção passkeys, key management e transações | idêntico |
| `/api/v1/operations/:operation` | `list`, `get`, `adjust`, `reverse` | movimentos/vendas GAS | comandos, vendas, produtos e movimentos | idêntico |
| `/api/v1/notifications/:operation` | `bootstrap`, `summary`, `list`, `read`, `state`, `report` | notificações e projeções GAS | notificações, destinatários e outbox | idêntico |
| `/api/v1/schedules/:operation` | `list`, `get`, `people`, `save`, `cancel` | escalas e recuperação GAS | `schedules`, usuários e comandos | idêntico |
| `/api/v1/niches/:operation` | `list`, `save`, `image` | nichos e Drive GAS | `niches`, reservas de revisão e asset adapter | idêntico |
| `/api/v1/audit/:operation` | `list`, `export` | auditoria GAS e gerador XLSX Node | `auditEvents` e o mesmo `audit-xlsx.mjs` | idêntico |
| `/api/v1/reports/:operation` | `query`, `export` | fonte GAS e `report-xlsx.mjs` | leitura coerente Firestore e o mesmo gerador | idêntico |
| `/api/v1/customer-insights/:operation` | `query`, `message` | fonte/projeção GAS e mensagens | leitura coerente Firestore, comando e auditoria | idêntico |
| `/api/v1/schema` | GET administrativo | diagnóstico de `LIVRARIA_SCHEMA` | diagnóstico versionado do modelo Firestore | idêntico no contrato, conteúdo adaptado ao storage |

Os nomes públicos de PIN serão removidos da interface e dos novos payloads. Durante a janela
de migração poderá existir um alias interno controlado para clientes antigos, que aceitará
somente o fluxo legado e nunca registrará PIN como `PASSWORD_V1`. O alias terá flag,
telemetria e data de remoção definida antes do corte estável.

## 8. Relatórios e retratos pontuais

`audit-xlsx.mjs` e `report-xlsx.mjs` continuarão sendo os geradores dos arquivos. A troca
será somente da fonte `client.audit`/`client.reports`.

Consultas de relatório serão executadas por serviço de leitura coerente. O serviço abrirá uma
leitura transacional limitada, buscará os documentos necessários sob o mesmo snapshot e
calculará um hash de fonte. O hash, filtros, versão do usuário e expiração formam o proof já
usado pelo handler. A exportação aceita somente o proof correspondente ao mesmo snapshot.

Se o resultado exceder limite de documentos, bytes, tempo ou tamanho OOXML, a operação
retornará `REPORT_CAPACITY`/`AUDIT_EXPORT_LIMIT`; não produzirá um arquivo misturando
momentos diferentes. O conteúdo sensível continuará mascarado/omitido antes de chegar ao
XLSX.

## 9. Migração e fonte da verdade

A migração será por dados e por dependências, mas o corte transacional de vendas não será
feito no meio de uma operação que atravesse Sheets e Firestore. Catálogo, clientes,
vendas/estoque, identidade e auditoria necessários ao checkout serão ativados juntos no
barrier de operações transacionais.

| Fase | Ação | Fonte da verdade | Critério para avançar |
|---|---|---|---|
| 0. Preparação | projeto `dev`, IAM, segredos, backup, e-mail e assets | GAS/Sheets | configurações testadas sem dados reais de produção |
| 1. Inventário | listar planilha principal, planilha privada, Script Properties e Drive; gerar hashes | GAS/Sheets e stores atuais | inventário completo e backup verificável |
| 2. Importação inicial | importar dados vivos para coleções versionadas | GAS/Sheets | 100% dos registros importados ou divergência bloqueante |
| 3. Reconciliação | comparar contagens, chaves, saldos, vendas, usuários, sessões e hashes | GAS/Sheets | zero divergência bloqueante |
| 4. Shadow-read | executar consultas Firestore e comparar DTOs sem alterar resposta | GAS/Sheets | suíte de contrato e comparações aprovadas |
| 5. Finalização | congelar gravações do domínio, exportar delta e reconciliar novamente | GAS/Sheets | backup, delta e checklist pré-corte aprovados |
| 6. Cutover | trocar flag do agregado para Firestore | Firestore | smoke tests e checks de integridade aprovados |
| 7. Observação | manter GAS somente como fallback, sem dual-write normal | Firestore | janela intensiva concluída |
| 8. Estabilização | remover fallback somente após aprovação operacional | Firestore | evidências arquivadas e rollback ainda possível conforme runbook |

### 9.1. Ordem de corte

1. infraestrutura e diagnóstico, sem tráfego de negócio;
2. identidade, credenciais, fluxos, passkeys, sessões e rate limits;
3. catálogo, nichos e reservas de ISBN/código;
4. clientes e equipe, incluindo índices HMAC e contatos cifrados;
5. vendas, itens, estoque, movimentos, comandos e auditoria, ativados em uma única janela
   transacional para evitar checkout cross-store;
6. notificações, escalas, relatórios e insights, após as fontes de domínio estarem estáveis;
7. ativos, se a estratégia Drive continuar, usando o adaptador privado sem copiar blobs para
   Firestore.

A importação pode ser feita por domínio antes do corte, mas uma operação de usuário não será
roteada para Firestore em um domínio enquanto uma mesma operação ainda precisar confirmar
estado mutável no Sheets de outro domínio.

### 9.2. Cutover e checklist

Antes do corte, o responsável designado registrará:

- backup mais recente e teste de restauração aprovado;
- versão do código e configuração `dev` usada;
- suíte unitária, contrato, concorrência e reconciliação 100% aprovada;
- fonte da verdade declarada como GAS até o instante do congelamento;
- contagem de produtos, nichos, clientes, usuários, passkeys, sessões ativas, vendas,
  itens, movimentos, auditoria, notificações e escalas;
- saldo por produto e total financeiro por período;
- verificação de contas, epochs e sessões ativas;
- hash da exportação final e do delta;
- horário de início e fim do congelamento.

O congelamento será uma flag de manutenção por domínio, com resposta já existente de
indisponibilidade para novas gravações. Leituras continuam disponíveis quando seguro. O
delta final será importado, reconciliado e somente então a flag trocará para Firestore.
Qualquer divergência de contagem, saldo, total financeiro ou identidade bloqueia o corte.

### 9.3. Rollback

Rollback não é apagar ou simplesmente ignorar documentos Firestore.

1. Acionar o rollback somente por critério objetivo: divergência de estoque/financeira,
   sessão indevidamente válida ou inválida, perda de evento, taxa de erro acima do limiar
   operacional ou indisponibilidade sustentada.
2. Congelar novas escritas Firestore no domínio afetado e exportar comandos/eventos desde o
   corte.
3. Reconciliar cada evento como comando idempotente no adaptador GAS/Sheets, preservando a
   ordem por agregado. Vendas, estornos e movimentos são reaplicados com IDs originais e
   saldo conferido.
4. Para identidade, usar o adaptador de compatibilidade preparado antes do corte. Ele
   entende `PASSWORD_V1`, versões de autorização e passkeys novas; nunca converte uma senha
   em PIN e nunca perde a credencial nova. A credencial de rollback é escrita somente na
   planilha privada de identidade, sem passar por tabela pública ou log.
5. Confirmar contagens, saldos, totais, epochs e sessões nos dois lados.
6. Trocar a fonte da verdade para GAS somente depois da reconciliação, mantendo o export do
   período como evidência.
7. Se a compatibilidade de senha ou o replay de um domínio não estiver pronto, o rollback
   fica bloqueado: Firestore permanece autoritativo e o incidente é tratado sem descartar
   eventos.

O período de observação inicial será de pelo menos duas horas após o corte, com métricas
acompanhadas continuamente. Rollback automático não será implementado.

## 10. Backup, restauração e ciclo de vida

### 10.1. Backup

A política inicial para `dev` será:

- exportação completa gerenciada a cada 6 horas para bucket privado Cloud Storage;
- exportação adicional imediatamente antes de cada cutover;
- retenção de cópias de 30 dias;
- uma cópia mensal retida por 12 meses enquanto a migração estiver ativa;
- objetos com hash, metadados de versão, banco, região e contagens esperadas;
- acesso ao bucket por identidade separada e sem exposição pública.

A frequência e o custo serão validados no projeto antes de habilitar a agenda. Se a
exportação gerenciada exigir cobrança ou serviço não aprovado, a execução será interrompida
para decisão do responsável; nenhum serviço pago será introduzido silenciosamente.

RPO inicial de `dev`: 6 horas para falha técnica completa, reduzido para o intervalo desde
o último evento exportado no caso de rollback, pois comandos/eventos são preservados. RTO
inicial: 4 horas, incluindo restauração em banco separado, reconciliação e troca de flag.
Esses objetivos são adequados ao ambiente `dev`; não autorizam uso em produção.

A integridade será verificada por:

- hash e contagem por coleção no export;
- restauração periódica em projeto/banco de teste separado;
- execução da suíte de reconciliação sobre o banco restaurado;
- uma restauração completa bem-sucedida antes do primeiro cutover;
- evidência da leitura de documentos de identidade, vendas, estoque e auditoria após restaurar.

Exclusão acidental de documento será tratada primeiro por restauração seletiva em coleção
intermediária e replay do documento/comando, sem substituir o banco inteiro. Quando a
ferramenta de export não oferecer restauração seletiva segura, será restaurado um banco
paralelo e o repositório copiará somente documentos validados por ID e versão. Nenhuma
restauração destrutiva será executada sem confirmação do responsável.

### 10.2. Retenção e privacidade

| Dado | Retenção operacional inicial |
|---|---|
| sessões expiradas/revogadas | limpeza eventual após 30 dias; auditoria preserva o acesso |
| fluxos de identidade consumidos/expirados | 24 horas após expiração, salvo referência de recuperação |
| challenges WebAuthn | 24 horas após consumo/expiração |
| rate limits limpos | 24 horas após o fim da janela |
| outbox entregue | 30 dias após confirmação |
| comandos comuns | 90 dias |
| comandos financeiros | 1 ano ou enquanto referenciados |
| vendas e movimentos | 5 anos no desenho inicial, sujeito à validação contábil |
| auditoria | 5 anos, com arquivamento antes de qualquer limpeza |
| backups | conforme a política de 30 dias/12 meses acima |

As retenções são parâmetros versionados, não exclusões manuais espalhadas pelo código.
TTL, quando usado, será tratado como eventual. A aplicação nunca permitirá apagar auditoria,
venda, movimento ou evento financeiro por uma rota normal.

Para solicitações LGPD, clientes poderão ser anonimizados quando a finalidade operacional
terminar e a retenção financeira/auditável permitir, preservando IDs técnicos, totais,
movimentos e referências necessárias. CPF, contato e nome serão cifrados ou substituídos por
marcadores conforme a base legal e a orientação do responsável/contador. A solicitação não
será implementada como exclusão indiscriminada nesta migração.

## 11. Observabilidade e desempenho

### 11.1. Logs e métricas

Cada handler continuará gerando `requestId`. O adaptador Firestore propagará esse ID para
logs estruturados e métricas, sem enviá-lo como dado de negócio. Campos de log permitidos:

```json
{
  "metric": "firestore.transaction",
  "requestId": "uuid",
  "endpoint": "/api/v1/checkout",
  "operation": "sales.checkout",
  "attempt": 2,
  "result": "ABORTED",
  "durationMs": 84,
  "readCount": 12,
  "writeCount": 17
}
```

Nunca serão logados CPF, senha, PIN legado, token bruto/hash de sessão, código de e-mail,
segredo, ciphertext, corpo de provedor ou payload completo.

Métricas mínimas:

- chamadas, sucesso, erro e latência por endpoint/operação;
- cold start e warm start;
- duração Firestore, número de leituras/escritas, tentativas e backoff;
- conflitos transacionais e taxa de retry;
- falhas de autenticação, rate limit e entrega de e-mail;
- comandos em estado incerto, outbox pendente e projeções atrasadas;
- contagens de venda, estoque e reconciliação;
- leituras, gravações, armazenamento e entradas de índice conforme painel Google Cloud.

O `Server-Timing` será uniformizado para as nove operações:

1. login completo;
2. validação de sessão;
3. consulta de catálogo;
4. cadastro de produto;
5. recebimento de estoque;
6. checkout;
7. estorno;
8. consulta de relatório;
9. exportação `.xlsx`.

Cada resposta relevante terá duração da aplicação e, quando aplicável, Firestore, transação,
retry e geração XLSX. A baseline será coletada no `dev` atual antes do corte; depois as mesmas
cargas serão repetidas em condições comparáveis, reportando p50, p95, p99, erro, cold/warm e
conflitos. A meta será calculada como redução relativa observada, não como número inventado.

Alertas iniciais:

- erro de login ou checkout acima de 2% por 15 minutos, excluindo erros esperados de entrada
  inválida em indicador separado;
- qualquer divergência financeira ou de estoque na reconciliação;
- outbox ou conflito transacional acima do limite medido na baseline;
- aproximação de 70% da cota diária e 70% do armazenamento projetado;
- ausência de backup ou falha na verificação de restauração.

Os limiares serão calibrados após a baseline e registrados antes do cutover. O alerta de
orçamento não será tratado como bloqueio automático de cobrança.

### 11.2. Estimativa inicial de uso

A tabela é uma estimativa de planejamento, não uma medição final. Ela será recalculada com
telemetria do emulator e do `dev` real:

| Operação | Leituras típicas | Gravações típicas | Observação |
|---|---:|---:|---|
| login completo | 8–15 | 5–10 | usuário, credencial, fluxo, passkey, sessão, auditoria/outbox |
| validação de sessão | 2–4 | 0–1 | sessão, índice e usuário/epoch |
| catálogo página | 15–40 | 0 | página, nichos e candidatos de busca |
| salvar produto | 6–12 | 5–12 | produto, reservas, comando, evento, auditoria |
| receber estoque | 4–8 | 5–8 | produto, comando, movimento, evento, auditoria |
| checkout com 5 itens | 12–25 | 15–25 | venda, itens, produtos, movimentos, comando e auditoria |
| estorno/ajuste | 5–10 | 6–12 | produto, venda/movimento, comando e auditoria |
| relatório | 100–5.000 | 1–2 | depende do filtro e registra consulta |
| exportação XLSX | 100–5.000 | 1–2 | mesma fonte coerente da consulta |

Cenário de uso para o primeiro cálculo: 30 checkouts/dia, 100 páginas de catálogo, 20
validações de sessão por usuário ativo, 10 logins, 10 mutações de catálogo/estoque, 3
relatórios e 1 exportação diária. Mesmo usando o extremo superior dos fluxos comuns e
incluindo fator 2 para índices/retries, a projeção será comparada com 50.000 leituras e
20.000 gravações por dia antes de habilitar o modo Firestore.

Para auditoria, o script calculará `eventos/dia × bytes médios por documento × dias`, incluindo
índices e backups. O limite de 70% de 1 GiB acionará revisão de retenção/arquivamento antes
de qualquer limpeza. A estimativa não incluirá apenas cliques: relatórios e exportações
entrarão com todas as leituras retornadas.

## 12. Testes e critérios de aprovação

A suíte atual continuará passando sem relaxar asserções. Testes que verificam linhas GAS
serão adaptados para documentos Firestore; testes de regra de negócio continuarão com o
mesmo resultado. Testes de PIN serão substituídos por testes de senha nos limites 7, 8, 40 e
41 pontos de código, espaços, Unicode, símbolos, senha comum condicional e ausência de
regra de dígitos repetidos.

### 12.1. Contrato por endpoint

Para cada linha da matriz HTTP haverá, no mínimo:

- sucesso;
- corpo/query inválido;
- sessão ausente ou inválida;
- papel sem permissão;
- conflito de revisão quando o endpoint mutar estado;
- timeout incerto e retry quando houver comando;
- comparação de status, `error.code`, formato `{ error: { code, requestId } }`, cookies,
  CSRF e headers permitidos.

### 12.2. Concorrência obrigatória

No Firestore Emulator e, antes do corte, em projeto `dev` controlado, serão executados
concorrentemente:

- duas vendas da última unidade;
- checkout repetido com a mesma idempotency key;
- mesma chave com payload diferente;
- estorno concorrente;
- ajuste de estoque concorrente;
- dois produtos com o mesmo ISBN;
- reativação após reaproveitamento de ISBN;
- mudança de papel durante sessão ativa;
- revogação concorrente com requisição em andamento;
- consumo simultâneo do mesmo código de e-mail;
- falha de rede com retry;
- conflito transacional forçado;
- todos os limites de expiração e comprimento da senha/código.

A aprovação será por integridade: nenhum estoque negativo, nenhuma duplicação, exatamente
um vencedor quando aplicável, nenhuma sessão indevida e auditoria correspondente para cada
operação confirmada.

O emulator valida a lógica e os conflitos. IAM, quotas, latência, cold start, backup e
integração de e-mail exigem verificações adicionais no projeto `dev` real.

## 13. Guia de dependências operacionais

Nenhum passo abaixo será executado automaticamente nesta fase. Antes da implementação do
cliente Firestore, o responsável deverá:

1. criar um projeto Google Cloud exclusivo para `dev`, sem reutilizar o projeto de produção;
2. confirmar a conta de cobrança, região e elegibilidade da cota gratuita;
3. habilitar Firestore Native e escolher o banco/região aprovado;
4. criar a identidade de serviço do backend e conceder somente o papel necessário;
5. criar, se aprovado, bucket privado para exports e identidade separada de backup;
6. configurar alerta de orçamento e monitoramento de leituras, gravações e armazenamento;
7. cadastrar na Netlify as variáveis de ambiente `dev`, sem commitar JSON de chave;
8. escolher e configurar o provedor de e-mail, seu domínio/remetente, idempotency key e
   limites de envio;
9. confirmar como o backend acessará os arquivos privados do Drive ou aprovar a migração
   posterior para Cloud Storage;
10. executar o preflight, um teste de leitura/escrita no emulator e uma restauração de
    backup antes de qualquer importação real.

A criação do projeto, configuração de billing, geração de credenciais, deploy, congelamento
de gravações e migração de dados são ações operacionais separadas. O responsável será
avisado antes de cada uma.

## 14. Ordem de implementação

1. adicionar dependência/client Firestore e configuração segura, sem mudar o modo `gas`;
2. implementar repositórios, schema versionado, índices e testes no emulator;
3. implementar comandos, transações, auditoria e classificação de erros;
4. trocar identidade para senha, alterar telas/payloads, criar fluxo `PIN_LEGACY` e aplicar
   TTL de 900 segundos a todos os códigos de e-mail;
5. implementar sessões, passkeys, RBAC, clientes, equipe e perfil;
6. implementar catálogo, nichos, estoque, checkout, estornos e movimentos;
7. implementar notificações, escalas, relatórios, insights e ativos;
8. uniformizar observabilidade e coletar baseline das nove operações;
9. implementar scripts de inventário, importação, reconciliação, replay e rollback;
10. executar testes de contrato e concorrência, primeiro no emulator e depois no `dev` real;
11. executar checklist de cutover somente após as dependências operacionais estarem prontas.

## 15. Riscos residuais e decisões fora desta fase

- A política de retenção de cinco anos para dados financeiros e auditoria precisa ser validada
  com o responsável contábil/jurídico antes de automatizar limpeza.
- O custo real de exports, Cloud Storage, índices e provedor de e-mail precisa ser confirmado
  no projeto escolhido antes de ativar agendas.
- A disponibilidade de acesso direto do backend aos arquivos privados do Drive precisa ser
  testada; não se deve presumir que a identidade Firestore tenha acesso aos arquivos atuais.
- A baseline real definirá os limiares finais de desempenho e alerta.
- O rollback com senha exige que a compatibilidade `PASSWORD_V1` no adaptador GAS seja
  implementada e testada antes do primeiro corte de identidade.

Enquanto qualquer um desses itens estiver sem validação, o trabalho pode continuar no
emulator e em importações descartáveis, mas o modo Firestore autoritativo e qualquer alteração
em dados vivos ficam bloqueados.
