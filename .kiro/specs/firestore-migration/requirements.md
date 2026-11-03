# Requisitos — Migração do armazenamento vivo para o Firestore

## Objetivo

O sistema hoje usa Google Apps Script (GAS) + Google Sheets como backend completo: toda
leitura e escrita de dados de produção passa por um Web App do Apps Script, serializado
por um único `ScriptLock` do projeto inteiro, lendo/gravando linhas de planilha. Medições
reais do próprio projeto (`docs/v17/ABERTURA_ACESSO_LATENCIA_DEV.md`) mostram RPCs
individuais levando 10-20 segundos cada; um login completo soma ~30s. Isso afeta o sistema
inteiro (catálogo, caixa, relatórios), não só o login.

Este spec migra o armazenamento **vivo e transacional** para o Google Cloud Firestore
(NoSQL, mesma conta Google, tier grátis: 50.000 leituras/dia, 20.000 gravações/dia, 1 GiB —
muito acima do uso esperado de uma livraria de igreja), mantendo:
- Toda regra de negócio e invariante de segurança já existente, sem exceção.
- A possibilidade de gerar relatórios/planilhas (já existe geração real de `.xlsx` para
  Auditoria e Relatórios, independente de onde os dados vivem).
- Compatibilidade total com o contrato HTTP que o frontend já consome (`/api/v1/...`), para
  não exigir reescrever as páginas `-dev.js`/`-dev.html`.

O Google Apps Script deixa de ser o motor de execução das regras de negócio. A lógica que
hoje mora em `google-apps-script/*.gs` passa para `backend/*.mjs` (Node.js, já rodando como
Netlify Functions), falando com o Firestore diretamente. Boa parte da criptografia,
validação e autorização **já vive em Node** (`credential-core.mjs`, `authorization.mjs`,
`personal-data.mjs`, `login-guard.mjs`, `passkey-service.mjs`, `protocol.mjs`) e não
depende de onde os dados ficam armazenados — essa parte muda pouco ou nada.

## Fora de escopo (nesta fase)

- Qualquer mudança visível para quem usa o sistema (tela, texto, fluxo). O contrato de
  erro/sucesso de cada endpoint deve continuar idêntico.
- Mudar o ambiente de produção (`prod`) — este spec cobre apenas o ambiente `dev`, como
  todo o resto do projeto até aqui.
- Decisão de política de negócio nova (ex: mudar quem pode fazer o quê). Só a camada de
  armazenamento muda.

## Requisitos

### Requisito 1 — Paridade de regra de negócio

**User story:** Como responsável pela livraria, quero que a migração não altere nenhuma
regra de negócio ou de segurança já definida, para que a confiança no sistema não diminua.

**Critérios de aceite:**
1. QUANDO uma operação (login, venda, cadastro de livro, etc.) for reimplementada contra o
   Firestore, ENTÃO o sistema DEVE produzir exatamente o mesmo código de erro/sucesso que a
   implementação atual produz para o mesmo cenário (ver `backend/protocol.mjs`'s mapa de
   códigos como contrato de referência).
2. QUANDO uma regra numérica/formato existente (ex: CPF com dígito verificador, ISBN com
   dígito verificador, limite de 1 milhão de unidades em estoque, limite de 20 nichos por
   produto, etc.) for portada, ENTÃO o limite exato DEVE ser preservado byte a byte, não
   aproximado. Isso NÃO se aplica às duas exceções expressamente autorizadas pelo
   Requisito 2 (política de senha e validade do código de e-mail), que substituem — não
   complementam — as regras de PIN e de 10 minutos que existiam antes.
3. QUANDO uma suíte de teste existente (`tests/backend/*.test.mjs`, `scripts/test-*.py`)
   exercitar um comportamento, ENTÃO esse teste DEVE continuar passando sem alterar sua
   asserção — exceto testes que seriam re-escritos para testar a infraestrutura de
   persistência em si (ex: testes que hoje fazem assert direto sobre linhas de planilha/GAS
   emulado), que podem ser **adaptados** para testar o Firestore, mas nunca **relaxados**,
   e exceto os testes que hoje exercitam especificamente o formato de PIN ou a validade de
   10 minutos, que DEVEM ser reescritos para exercitar a nova política de senha e a nova
   validade de 15 minutos com o mesmo rigor (não removidos, não enfraquecidos).
4. SE uma regra depender hoje do `ScriptLock` para evitar uma condição de corrida (não
   apenas por desempenho), ENTÃO a reimplementação DEVE usar uma transação do Firestore
   (ou mecanismo equivalente) que ofereça a mesma garantia de atomicidade.
5. DEVE existir uma matriz de equivalência, mantida como parte do design, listando cada
   endpoint HTTP afetado (`/api/v1/...`), o comportamento atual, o comportamento migrado, e
   uma marcação explícita de "idêntico" ou "exceção autorizada (Requisito 2)" — nenhum
   endpoint pode ficar sem essa marcação.
6. Para cada endpoint da matriz, DEVEM existir testes de contrato cobrindo pelo menos: um
   caminho de sucesso, um caminho de erro de validação, um caminho de erro de autorização, e
   (quando aplicável) um caminho de conflito/concorrência — comparando o código de erro e a
   forma da resposta antes e depois da migração.
7. QUALQUER incompatibilidade inevitável além das duas exceções já autorizadas DEVE ser
   documentada e aprovada pelo responsável pelo projeto antes da implementação daquele
   trecho — nunca decidida silenciosamente durante a codificação.

### Requisito 2 — Identidade, sessão e autenticação

**User story:** Como dono/equipe da livraria, quero continuar entrando com CPF/e-mail +
senha e confirmação pelo aparelho (passkey), com a mesma sessão de 24h sem expiração por
inatividade, para que a segurança já validada não regrida.

> **Exceção autorizada ao Requisito 1:** o PIN numérico de 4 dígitos é substituído por uma
> senha convencional, e a validade do código de confirmação por e-mail passa de 10 para 15
> minutos. Ambas as mudanças estão detalhadas no critério 7 (código de e-mail) e nos
> critérios 11–23 (política de senha e migração) abaixo, e **substituem** — não coexistem
> com — as regras antigas de PIN e de 10 minutos.

**Critérios de aceite:**
1. O hash da credencial DEVE continuar usando scrypt com os parâmetros exatos N=32768, r=8,
   p=1, mais o HMAC-pepper existente (`backend/credential-core.mjs`), incluindo a verificação
   de tempo constante (`timingSafeEqual`) e o registro "dummy" para não revelar se a conta
   existe. Isso vale tanto para o PIN legado (durante a transição) quanto para a nova senha.
2. A sessão DEVE continuar com vida absoluta de 24 horas, sem expiração por inatividade,
   revogada apenas por: logout explícito, mudança de papel/status do usuário, ou incremento
   da versão de autorização (troca de e-mail, recuperação, revogação de passkey).
3. A janela de "autenticação forte recente" (5 minutos, usada por perfil, gestão de chaves,
   exportação sensível) DEVE continuar distinta e independente da vida da sessão.
4. O fluxo de passkey/WebAuthn (registro, autenticação, avanço de contador anti-replay)
   DEVE continuar verificado em Node via `@simplewebauthn/server` com os mesmos parâmetros
   (RP ID, origem, `userVerification: required`, algoritmo -7) — isso já é
   armazenamento-agnóstico hoje.
5. O mecanismo de epoch/versão de autorização (`identity.version.<userId>`) que invalida
   sessões antigas em bloco ao trocar papel, e-mail ou passkeys DEVE ser preservado
   exatamente: um contador por usuário, incrementado atomicamente, comparado em toda leitura
   de sessão.
6. A limitação de tentativas (rate limit) por conta E por origem, com bloqueio exponencial
   (base 60s, dobrando até 1h, resetando após 24h sem tentativa ou 15 min de janela limpa)
   DEVE ser preservada com os mesmos limiares (5 tentativas por conta, 30 por origem).
7. **[Exceção autorizada]** Os códigos de e-mail de uso único DEVEM manter o mesmo formato
   (7 caracteres, alfabeto sem I/O/0/1, até 5 tentativas de prova), mas a validade passa de
   10 para **15 minutos (900 segundos)**, calculada e verificada no servidor, com uso único e
   invalidação imediata após consumo. PENDÊNCIA DE DESIGN: hoje essa validade é a mesma janela
   de expiração do fluxo de identidade inteiro (`Expires_At`, compartilhada com as etapas de
   PIN/senha e passkey do mesmo fluxo), não um temporizador isolado do código em si — o
   design deve decidir explicitamente se os 15 minutos se aplicam à janela do fluxo completo
   ou apenas à etapa do código, e registrar essa decisão, em vez de presumi-la aqui. Este
   ajuste é independente da janela de bloqueio por tentativas (item 6, "15 min de janela
   limpa de tentativas"), do tempo de bloqueio exponencial, da sessão de 24h e da janela de
   autenticação forte recente de 5 minutos — nenhuma dessas outras janelas muda.
8. O fluxo de recuperação por código de emergência (6 códigos de uso único, invalidados em
   lote ao reemitir) e a recuperação de senha via passkey existente DEVEM ser preservados,
   com a senha nova sujeita à mesma política dos critérios 11–16.
9. A troca de e-mail autenticada (requer sessão forte recente, código de confirmação,
   detecção de conflito com conta existente, revogação de outras sessões ao concluir) DEVE
   ser preservada.
10. SE o Firestore reintroduzir qualquer necessidade de idempotência (reenvio de uma mesma
    requisição por timeout), ENTÃO o padrão de intenção durável antes da gravação (hoje
    "PENDING → COMPLETE" no fluxo de identidade) DEVE ter equivalente no novo desenho.

**Critérios de aceite — política de senha (substitui o PIN, exceção autorizada ao Requisito 1):**

11. A credencial principal DEVE ser uma senha convencional de **8 a 40 caracteres**, validada
    com o mesmo limite no frontend e no backend; o backend DEVE aplicar o limite
    independentemente da interface. A contagem de comprimento DEVE ser definida de forma
    consistente para caracteres Unicode (ex: por ponto de código), documentada no design.
12. A senha DEVE aceitar letras maiúsculas, minúsculas, números, símbolos e combinações
    livres entre eles. O sistema NÃO DEVE exigir obrigatoriamente a presença simultânea de
    todas essas classes de caractere.
13. O sistema NÃO DEVE aplicar a regra de "sem números iguais lado a lado" herdada do PIN a
    esta nova credencial.
14. O sistema NÃO DEVE remover espaços internos nem alterar silenciosamente qualquer parte
    do valor digitado antes do hash.
15. SE existir um mecanismo confiável de verificação de senhas comuns/comprometidas (ex: uma
    lista local ou uma API de terceiros sem custo, como uma consulta por k-anonimato),
    ENTÃO o sistema DEVE rejeitar essas senhas; esse mecanismo é condicional — se nenhum for
    aprovado, essa verificação específica fica registrada como pendente, sem bloquear o
    restante da migração.
16. O sistema NUNCA DEVE armazenar ou registrar em log a senha em texto puro, em nenhuma
    etapa (criação, verificação, recuperação, auditoria, diagnóstico de erro).

**Critérios de aceite — migração de PIN para senha:**

17. O sistema DEVE conseguir distinguir uma conta ainda não migrada (credencial no formato
    PIN) de uma conta já migrada (credencial no formato senha) sem depender apenas do hash
    armazenado — por exemplo, por um campo de versão/tipo explícito no registro da
    credencial, já que o hash em si não revela o formato da entrada original.
18. QUANDO uma conta com credencial no formato PIN tentar entrar após a migração, ENTÃO o
    sistema DEVE exigir a definição de uma nova senha por um fluxo autenticado explícito
    (equivalente ao fluxo de primeiro acesso já existente) antes de conceder sessão — nunca
    aceitar silenciosamente um valor de 4 dígitos como senha válida.
19. Por construção, um PIN de 4 dígitos NÃO PODE satisfazer o requisito mínimo de 8
    caracteres da nova senha; o design DEVE tratar essa diferença de tamanho como o
    mecanismo primário que força a transição, em vez de inventar uma comparação direta
    entre os dois formatos.
20. A transição de uma conta DEVE preservar seu identificador, papel, status e histórico —
    nenhuma conta é recriada; apenas a credencial de acesso é substituída.
21. QUANDO uma conta concluir a transição de PIN para senha, ENTÃO sua versão de autorização
    DEVE ser incrementada, revogando sessões antigas dessa conta, da mesma forma que já
    ocorre hoje para troca de e-mail ou de passkey.
22. Durante a migração, o PIN antigo e a senha nova NUNCA DEVEM ser expostos juntos em
    nenhuma resposta, log ou auditoria — cada um segue as mesmas regras de sigilo do
    critério 16.
23. A via de login "somente senha" hoje restrita a `dev` (`ADMIN_PIN_LOGIN_ENABLED`, caminho
    mais rápido que dispensa a confirmação obrigatória pelo aparelho) DEVE ser atualizada
    para a nova terminologia de senha, preservando a mesma semântica de política restrita a
    `dev` e a mesma exigência de reautenticação forte para operações sensíveis.

### Requisito 3 — Controle de acesso (RBAC)

**User story:** Como dono da livraria, quero que atendentes, administradores e o
super-administrador continuem com exatamente as mesmas permissões de hoje.

**Critérios de aceite:**
1. A matriz de permissões por papel (`ATENDENTE`/`ADMIN`/`SUPER_ADMIN`) definida em
   `backend/authorization.mjs` DEVE ser reutilizada sem alteração — esse módulo já não
   depende de Sheets/GAS.
2. Operações marcadas como exigindo reautenticação recente (lista `recent` em
   `authorization.mjs`) DEVEM continuar exigindo-a.
3. Um atendente NUNCA pode alterar seu próprio papel/status; um administrador gerencia
   apenas atendentes, nunca outros administradores.
4. Gerenciar um atendente e gerenciar um administrador DEVEM continuar sendo capacidades
   distintas (`users.attendant.manage` vs `users.admin.manage`).

### Requisito 4 — Catálogo, estoque e caixa

**User story:** Como equipe da livraria, quero continuar cadastrando livros, recebendo
estoque e vendendo sem perder nenhuma validação ou proteção contra duplicidade.

**Critérios de aceite:**
1. ISBN e código interno DEVEM continuar únicos apenas entre produtos **ativos** (um produto
   inativo pode compartilhar ISBN com um novo cadastro ativo).
2. Desativar/ativar um livro (`active`) DEVE continuar restrito a `ADMIN`/`SUPER_ADMIN`,
   mesmo que o valor chegue dentro de um `save` comum — comparado contra o valor
   **atualmente armazenado**, não contra o que o cliente alega ser o valor anterior.
3. Toda mutação (salvar produto, receber estoque, ajustar estoque, reverter venda) DEVE
   continuar usando concorrência otimista por número de versão — tentativa com versão
   divergente é conflito, nunca sobrescrita silenciosa.
4. Toda mutação DEVE continuar idempotente por `commandId`: reenviar o mesmo comando com o
   mesmo hash de payload retorna o mesmo resultado sem duplicar; reenviar com payload
   diferente sob o mesmo `commandId` é rejeitado como conflito.
5. Checkout DEVE continuar validando: preço total exatamente igual à soma recalculada no
   servidor (rejeita se o preço mudou), estoque suficiente, produto ativo, cliente existente
   quando informado.
6. Estornar uma venda ou ajustar estoque DEVE continuar restrito a `ADMIN`/`SUPER_ADMIN` e
   preservar a cadeia de versões do produto (não pode "pular" nem reescrever histórico).
7. O limite de 1.000.000 de unidades em estoque e os limites de paginação/capacidade (ex:
   5.000 produtos, 2.000 eventos no journal) DEVEM ser preservados.
8. A baixa de estoque de uma venda DEVE ocorrer dentro da mesma transação atômica que
   verifica a disponibilidade — nunca em dois passos separados que permitam uma janela de
   corrida entre checar e debitar.
9. Nenhuma venda PODE produzir estoque negativo, mesmo sob duas tentativas de venda da
   última unidade disponível, disparadas ao mesmo tempo: a transação do Firestore DEVE
   garantir que exatamente uma tentativa reserve a última unidade e a outra seja rejeitada
   como estoque insuficiente, nunca as duas prosseguirem.
10. A unicidade de ISBN/código interno entre produtos ativos (critério 1) DEVE ser garantida
    de forma atômica, incluindo o caso de dois cadastros concorrentes com o mesmo ISBN e o
    caso de reativar um produto cujo ISBN já foi reaproveitado por outro produto ativo nesse
    meio tempo.
11. Falhas intermediárias (processo interrompido no meio de uma gravação) NUNCA PODEM deixar
    uma venda parcialmente registrada (ex: evento de venda sem o movimento de estoque
    correspondente); o padrão de intenção durável antes da projeção (critério 4 deste
    requisito e critério 2 do Requisito 15) cobre este caso.
12. Valores monetários DEVEM continuar representados como inteiros em centavos (sem ponto
    flutuante), preservando a representação exata já usada hoje.
13. Movimentações de estoque DEVEM continuar rastreáveis e reconciliáveis: dado o histórico
    de movimentos de um produto, deve ser possível recalcular seu saldo atual de forma
    determinística, como a cadeia de versões já garante hoje.

### Requisito 5 — Dados pessoais e equipe/clientes

**User story:** Como dono da livraria, quero que CPF e contatos continuem cifrados e nunca
expostos em texto puro, incluindo em auditoria e exportações.

**Critérios de aceite:**
1. CPF e contatos de clientes/equipe DEVEM continuar cifrados com AES-256-GCM (dados) e
   indexados para busca via HMAC determinístico (`backend/personal-data.mjs`) — este módulo
   já é agnóstico de onde os bytes cifrados são guardados.
2. Apenas o CPF mascarado DEVE voltar ao navegador; o valor completo nunca é serializado
   para o cliente nem gravado em log de auditoria.
3. Duplicidade de CPF e de e-mail entre funcionários DEVEM continuar detectadas e
   reportadas como erros distintos (`STAFF_CPF_DUPLICATE` vs `STAFF_EMAIL_DUPLICATE`).
4. O vínculo do CPF do proprietário ao perfil DEVE continuar sendo uma operação única,
   irreversível por essa via, exigindo autenticação forte recente.

### Requisito 6 — Auditoria

**User story:** Como dono da livraria, quero que todo evento sensível continue registrado
de forma imutável, sem exceção.

**Critérios de aceite:**
1. O log de auditoria DEVE continuar apenas-acréscimo (append-only) **no nível da
   aplicação**: nenhuma rota, handler ou operação normal do sistema pode atualizar ou
   excluir uma entrada existente, nem mesmo por bug.
2. Nenhum valor sensível (PIN legado ou senha em texto puro, CPF completo, tokens,
   segredos, corpo de erro de provedor externo) PODE aparecer em uma entrada de auditoria.
3. Toda ação já auditada hoje (login, logout, revogação, troca de e-mail, criação/edição de
   produto, venda, estorno, ajuste de estoque, etc.) DEVE continuar gerando sua entrada
   equivalente.
4. A gravação de um evento sensível DEVE ocorrer de forma atomicamente consistente com a
   operação de negócio correspondente — nunca a operação de negócio confirmada sem o
   registro de auditoria, nem o inverso.
5. Cada entrada de auditoria DEVE ter um identificador único e usar o relógio do servidor
   (nunca um valor enviado pelo cliente) como data/hora.
6. Reenviar a mesma operação (retry de rede) NÃO PODE duplicar a entrada de auditoria
   correspondente — mesma garantia de idempotência do Requisito 4.
7. O documento de design DEVE declarar explicitamente a política de retenção da auditoria
   (por quanto tempo os registros são mantidos, se há arquivamento).
8. O sistema PODE, quando necessário, oferecer um mecanismo de verificação de integridade
   (ex: hash encadeado) para detectar adulteração; isso é distinto da proteção de escrita do
   critério 1.
9. O documento de design DEVE distinguir claramente três níveis de proteção, sem confundi-los:
   (a) proteção contra modificação pela aplicação/rotas normais (critério 1); (b) proteção
   contra modificação por um administrador com acesso privilegiado direto ao banco (o
   Firestore, por si só, NÃO impede isso — exige regra de IAM/segurança explícita, tratada
   no Requisito 12); (c) mecanismo de detecção de adulteração (critério 8), que detecta mas
   não necessariamente impede.
10. O sistema NÃO DEVE afirmar ou assumir que o Firestore oferece imutabilidade absoluta de
    documentos nativamente — a imutabilidade efetiva vem da combinação de regras de acesso,
    regras de segurança e, opcionalmente, do mecanismo de detecção do critério 8.

### Requisito 7 — Relatórios e visão em planilha

**User story:** Como dono da livraria, quero continuar conseguindo gerar relatórios e, se
fizer sentido, ver os dados em formato de planilha, mesmo com os dados vivendo no Firestore.

**Decisão confirmada pelo responsável:** os relatórios serão exclusivamente arquivos
`.xlsx` de leitura (download), gerados sob demanda. NÃO haverá planilha Google viva como
espelho do sistema — isso elimina o risco de reintroduzir o gargalo de escrita via Sheets
e simplifica o Requisito 11 (nenhuma sincronização Firestore↔Planilha a desenhar).

**Critérios de aceite:**
1. A geração de arquivos `.xlsx` reais para Auditoria e Relatórios (hoje construída do zero
   em `Audit.gs`/`Reports.gs`) DEVE continuar funcionando, alimentada pelos dados do
   Firestore, com o mesmo formato de arquivo e mesmas colunas.
2. O arquivo `.xlsx` gerado DEVE continuar sendo um retrato pontual do momento da geração
   (download), nunca um documento vivo/editável sincronizado com o sistema.
3. O sistema NÃO DEVE implementar nenhuma escrita automática em uma Planilha Google como
   parte desta migração.

### Requisito 8 — Desempenho

**User story:** Como quem usa o sistema no dia a dia, quero que as ações sejam rápidas,
sem a espera de vários segundos que existe hoje.

**Critérios de aceite:**
1. O sistema NÃO DEVE mais serializar todas as requisições do projeto inteiro atrás de um
   único lock global — chamadas para recursos diferentes (ex: duas vendas de produtos
   diferentes) DEVEM poder prosseguir concorrentemente.
2. Permanece o limite de 30 execuções simultâneas do Apps Script como motivação adicional
   (não a única) para a migração, já que deixa de existir ao sair do Apps Script como motor
   de execução.
3. ANTES da migração, DEVE ser registrada uma medição de referência (baseline) end-to-end,
   em ambiente real, de cada operação abaixo, usando o próprio `Server-Timing` que o sistema
   já emite hoje: login completo, validação de sessão, consulta de catálogo, cadastro de
   produto, recebimento de estoque, checkout, estorno, consulta de relatório, exportação
   `.xlsx`.
4. DEPOIS da migração, as mesmas nove operações DEVEM ser medidas novamente, em condições
   comparáveis, reportando p50, p95, p99 e taxa de erro de cada uma.
5. A meta numérica de cada operação DEVE ser derivada da baseline real (critério 3), não de
   suposição — por exemplo, "reduzir o p95 em pelo menos N%", com N justificado, e nunca um
   número arbitrário sem relação com a medição anterior.
6. DEVE ser medida também a taxa de conflito transacional (tentativas de escrita rejeitadas
   por concorrência) sob o uso esperado, para confirmar que o modelo de dados do Requisito
   11 não introduz contenção nova.
7. DEVE ser medida a latência de cold start e de warm start das funções Netlify que passarem
   a falar diretamente com o Firestore, já que isso é um fator real de latência percebida
   que hoje já existe e deve ser comparado, não ignorado.
8. A migração só pode ser considerada bem-sucedida em desempenho SE a medição pós-migração
   (critério 4) mostrar melhoria real e mensurável em relação à baseline (critério 3) nas
   operações mais usadas no dia a dia (login, checkout, consulta de catálogo) — não é
   suficiente supor que Firestore será mais rápido sem medir.

### Requisito 9 — Operação dentro do uso gratuito

**User story:** Como dono da livraria, quero que a migração não crie custo recorrente.

**Critérios de aceite:**
1. O uso esperado (uma livraria de igreja, poucos funcionários, poucas dezenas de
   transações por dia) DEVE permanecer dentro da cota gratuita do Firestore (50.000
   leituras/dia, 20.000 gravações/dia, 1 GiB de armazenamento), com margem confortável.
2. A criação do projeto Google Cloud (passo que só o dono pode fazer, exige o Google
   Console) DEVE ser documentada passo a passo antes da implementação.
3. O design DEVE estimar, por tipo de operação (login, checkout, consulta de catálogo,
   etc.), quantas leituras e quantas gravações de documento ela consome, multiplicado pelo
   volume diário esperado, somando ao total diário projetado.
4. O crescimento do armazenamento de auditoria (que é apenas-acréscimo e nunca encolhe)
   DEVE ser estimado ao longo do tempo (ex: por mês, por ano) para antecipar quando a cota
   de 1 GiB seria atingida, dado o ritmo real de uso.
5. O design DEVE considerar o custo de manutenção de índices (Firestore cobra por entrada de
   índice escrita, não só pelo documento) ao estimar gravações.
6. O design DEVE considerar custos de tráfego de rede e de qualquer infraestrutura
   complementar (ex: Netlify Functions) além do próprio Firestore.
7. Consultas de relatório e exportação `.xlsx` que leem muitos documentos de uma vez DEVEM
   ser incluídas na estimativa de leituras, já que podem consumir uma parcela
   desproporcional da cota diária em relação ao número de cliques.
8. DEVE ser configurado um alerta de orçamento no Google Cloud como aviso preventivo. O
   sistema NÃO DEVE assumir que esse alerta, por si só, impede cobranças automáticas —
   alertas avisam, não bloqueiam gasto.
9. DEVE existir um procedimento simples (ex: revisão mensal do painel de cotas do Google
   Cloud) para acompanhar o consumo real depois de operar, comparando com a estimativa.
10. O sistema NÃO DEVE introduzir um serviço pago como dependência obrigatória desta
    migração sem aprovação expressa e justificativa técnica registrada (ex: a verificação
    de senha comprometida do Requisito 2 é condicional exatamente por este motivo).

### Requisito 10 — Migração segura, sem interrupção prolongada

**User story:** Como dono da livraria, quero migrar sem perder dados nem deixar o sistema
fora do ar por muito tempo, e poder voltar atrás se algo der errado.

**Critérios de aceite:**
1. DEVE existir um processo de migração de dados existentes (Planilhas atuais → Firestore)
   que preserve 100% dos registros, executado e verificado antes de qualquer corte de
   tráfego real.
2. A migração DEVE ser feita em etapas verificáveis (um domínio por vez: identidade,
   depois catálogo/estoque/caixa, depois os módulos restantes), cada etapa validada pela
   suíte de testes adaptada antes de avançar para a próxima.
3. Enquanto a migração estiver em andamento, o sistema atual baseado em Apps Script DEVE
   continuar funcionando sem interrupção — nenhuma etapa intermediária pode deixar o
   sistema sem um caminho de leitura/escrita válido.
4. DEVE existir uma forma de reverter para o Apps Script/Sheets caso um problema grave seja
   encontrado logo após o corte, pelo menos durante um período inicial de observação.
5. Toda etapa de migração DEVE ser validada no ambiente `dev` por completo antes de
   qualquer consideração de aplicar o mesmo em outro ambiente.
6. O design DEVE declarar, para cada fase da migração (inventário, backup, modelagem,
   migração inicial de dados, reconciliação por domínio, testes, corte, ativação,
   monitoramento pós-corte), qual armazenamento é a **fonte da verdade** naquele momento —
   nunca deixando ambíguo se é a Planilha ou o Firestore que deve ser considerado correto
   em caso de divergência.
7. O sistema NÃO DEVE manter escrita simultânea não controlada (dual-write) nos dois
   armazenamentos por mais tempo do que o estritamente necessário para a reconciliação de
   um domínio — e, quando existir, DEVE ter uma direção clara de qual lado é autoritativo.
8. Um rollback NUNCA PODE descartar silenciosamente uma venda, ajuste de estoque, evento de
   identidade ou qualquer evento já registrado no Firestore depois do corte — os detalhes
   operacionais de reversão e reconciliação ficam no Requisito 18, que complementa (sem
   repetir) este requisito.

### Requisito 11 — Modelagem de dados no Firestore

**User story:** Como responsável técnico, quero uma modelagem de dados pensada para o
Firestore desde o início, para não recriar o gargalo do `ScriptLock` com um desenho ingênuo.

**Critérios de aceite:**
1. O design DEVE definir, por domínio (identidade, catálogo, vendas/estoque, equipe,
   clientes, auditoria, relatórios, notificações, escalas, nichos), as coleções e a forma de
   cada documento, incluindo identificadores e como um documento referencia outro.
2. O design DEVE definir quais índices são necessários para cada consulta hoje suportada
   (ex: listar produtos por busca textual parcial, listar vendas por período, listar
   sessões por usuário) e quais índices garantem unicidade (ex: ISBN ativo, e-mail/CPF de
   funcionário).
3. O design DEVE respeitar os limites de tamanho de documento do Firestore e definir como
   dividir qualquer estrutura que hoje seja uma única linha "grande" de planilha, se
   necessário.
4. O design DEVE definir a estratégia de paginação de listagens (hoje baseada em
   offset/limite) de forma compatível com o modelo de cursores do Firestore.
5. O design DEVE definir como a concorrência otimista por versão (Requisito 4) e as
   transações do Firestore se combinam — qual campo de versão, onde ele mora, como uma
   transação falha e é repetida pelo chamador.
6. O design DEVE identificar e EVITAR deliberadamente qualquer desenho que recrie o
   gargalo do `ScriptLock` por meio de um único documento "contador global" ou "fila única"
   compartilhado por operações que hoje podem ser concorrentes (ex: um documento por venda,
   não um documento único de "todas as vendas").
7. O design NÃO DEVE desnormalizar dados além do necessário para as consultas realmente
   existentes — duplicar um campo só é justificado quando evita uma consulta cara ou uma
   limitação real do Firestore, não por padrão.
8. O design DEVE descrever como o esquema evolui no futuro (ex: adicionar um campo) sem
   quebrar documentos já migrados, e como os dados já migrados permanecem compatíveis.

### Requisito 12 — Segurança da infraestrutura

**User story:** Como responsável pela livraria, quero que o acesso ao Firestore siga o
mesmo padrão de segurança que o resto do sistema já segue.

**Critérios de aceite:**
1. Todo acesso operacional sensível ao Firestore DEVE passar pelo backend (Netlify
   Functions) — o navegador NUNCA acessa o Firestore diretamente.
2. Toda autorização DEVE continuar sendo decidida no servidor, a partir de uma sessão já
   validada (Requisito 3), nunca por uma regra de segurança do Firestore que tente replicar
   a lógica de papéis no lado do cliente.
3. O ambiente `dev` DEVE permanecer isolado do `prod` (projeto Google Cloud distinto ou
   configuração equivalente que impeça um vazar para o outro), preservando o isolamento que
   já existe hoje entre as planilhas de cada ambiente.
4. As credenciais de serviço usadas pelo backend para falar com o Firestore DEVEM seguir o
   princípio do menor privilégio (permissão apenas para o que o backend realmente precisa
   fazer), configurado via IAM do Google Cloud.
5. Nenhuma informação sensível (CPF, senha, PIN legado, token de sessão, segredo de
   assinatura) PODE aparecer em um log de aplicação ou de infraestrutura.
6. O design DEVE manter a mesma separação já existente entre parâmetros públicos (ex: RP ID
   e origem do WebAuthn, que são públicos por natureza do protocolo) e segredos privados
   (chaves de HMAC/cifragem, pepper de senha) — nunca tratar os dois como equivalentes.
7. O design DEVE ser compatível com a estratégia de configuração já usada pelo projeto
   (variáveis de ambiente no Netlify para segredos do backend); esta migração NÃO introduz
   um mecanismo de segredos paralelo sem necessidade comprovada.
8. **Orientação expressa sobre o repositório:** esta migração NÃO propõe, como requisito,
   remover ou realocar as chaves de segurança atualmente mantidas no projeto. A organização
   existente de segredos é preservada; não há refatoração de gerenciamento de segredos no
   escopo deste spec. Isso não autoriza nenhuma nova exposição de credencial privada, chave
   de serviço, pepper ou segredo operacional introduzida por esta migração. Caso o código
   revisado contenha algum indício de exposição já existente, esse risco DEVE ser registrado
   separadamente para decisão do responsável pelo projeto, sem que esta tarefa o modifique.
   Nota de verificação: a revisão de código feita até aqui (`backend/*.mjs`,
   `google-apps-script/*.gs`) não encontrou segredo em texto puro no repositório — todas as
   chaves observadas vêm de variáveis de ambiente (Netlify) ou de Propriedades do Script
   (Google), nenhuma das duas versionada no Git.

### Requisito 13 — Backup e recuperação

**User story:** Como dono da livraria, quero garantia de que os dados no Firestore podem
ser recuperados em caso de erro humano ou falha técnica.

**Critérios de aceite:**
1. O design DEVE definir uma política de backup do Firestore (ex: exportação programada
   para Cloud Storage) com frequência proporcional ao risco (dados financeiros e de
   identidade justificam backup mais frequente que dados de configuração).
2. O design DEVE definir por quanto tempo cada backup é retido antes de ser descartado.
3. O design DEVE definir como a integridade de um backup é verificada (não basta "existir
   o arquivo"; deve ser possível confirmar que ele é restaurável).
4. DEVE existir um procedimento de restauração testado pelo menos uma vez antes de
   considerar o backup confiável — um backup nunca testado não conta como válido.
5. O design DEVE cobrir o caso de exclusão acidental de um documento ou coleção e como
   recuperá-lo sem restaurar o backup inteiro, quando possível.
6. O design DEVE declarar um RPO (quanto dado se pode perder, no pior caso) e um RTO
   (quanto tempo leva para restaurar o serviço) justificados pelo risco real do sistema, não
   por padrão genérico.
7. A política de backup escolhida DEVE caber no orçamento e na infraestrutura já aprovados
   (Requisito 9) — não introduz um serviço pago novo sem justificativa.

### Requisito 14 — Observabilidade

**User story:** Como responsável técnico, quero conseguir diagnosticar um problema real de
produção sem precisar adivinhar o que aconteceu.

**Critérios de aceite:**
1. Cada requisição DEVE gerar/propagar um identificador de correlação único, presente em
   todo log relacionado a ela, do jeito que `requestId` já funciona hoje no backend.
2. O sistema DEVE registrar logs estruturados (não texto livre) para erros e eventos
   relevantes de cada endpoint.
3. O design DEVE definir métricas por endpoint: contagem de chamadas, taxa de erro e
   latência — reaproveitando o `Server-Timing` que o backend já emite onde fizer sentido.
4. O design DEVE definir como falhas de autenticação, taxa de conflito transacional e taxa
   de retry são monitoradas, não apenas erros não tratados.
5. DEVE existir alerta para operações críticas que passarem a falhar repetidamente (ex:
   login ou checkout com taxa de erro anormal), não apenas registro passivo em log.
6. O consumo de cota do Firestore (leituras/gravações/armazenamento) DEVE ser monitorável,
   para antecipar a aproximação do limite gratuito antes de ele ser atingido.
7. Uma falha de transação do Firestore DEVE ser diagnosticável a partir do log (qual
   documento, qual tentativa, qual motivo de conflito), sem expor dado sensível.
8. Nenhum log de observabilidade PODE conter CPF, senha, PIN legado, token de sessão ou
   qualquer outro valor coberto pelas regras de sigilo dos Requisitos 2, 5 e 6.

### Requisito 15 — Resiliência e idempotência

**User story:** Como equipe da livraria, quero que uma falha de rede nunca duplique uma
venda, um cadastro ou qualquer outra operação.

**Critérios de aceite:**
1. Toda operação de escrita que hoje é idempotente por `commandId` (Requisito 4) DEVE
   continuar sendo, usando o mesmo padrão de hash de payload para distinguir "mesmo comando
   repetido" de "comando diferente com o mesmo identificador por acaso/erro".
2. O registro da intenção de escrita DEVE ser durável (persistido) antes de qualquer efeito
   de negócio ser considerado concluído, preservando o padrão "intenção antes da projeção"
   já usado hoje.
3. O sistema DEVE ter uma política explícita de por quanto tempo um `commandId` processado
   permanece reconhecível para deduplicação (não pode ser "para sempre" sem limite, nem tão
   curto que um retry legítimo depois desse prazo seja tratado como novo incorretamente).
4. Timeouts de chamada DEVEM ser tratados distinguindo claramente um erro definitivo (a
   operação não ocorreu) de um erro incerto (a operação pode ou não ter ocorrido) — apenas
   o primeiro caso permite nova tentativa automática sem antes consultar o estado atual.
5. Reenvios automáticos (retry) DEVEM ter um limite de tentativas e um atraso crescente
   entre elas (backoff), nunca um laço de repetição imediata e ilimitada.
6. Uma falha parcial (processo interrompido no meio de uma sequência de gravações) DEVE ser
   recuperável a partir do estado já persistido, sem exigir intervenção manual para o caso
   comum.
7. A operação de negócio e o registro de auditoria correspondente (Requisito 6) DEVEM
   permanecer consistentes entre si mesmo após uma falha parcial seguida de recuperação.
8. O sistema NÃO DEVE executar um efeito colateral externo não idempotente (ex: enviar
   e-mail, chamar um serviço de terceiro) dentro de uma função de transação do Firestore que
   possa ser repetida automaticamente pelo próprio SDK em caso de conflito — esses efeitos
   DEVEM ocorrer fora da transação, depois que ela confirmar com sucesso.

### Requisito 16 — Testes de concorrência e carga

**User story:** Como responsável técnico, quero provar sob concorrência real que a
migração não introduziu uma brecha de integridade, não apenas confiar na teoria.

**Critérios de aceite:**
1. DEVEM existir cenários de teste automatizados, disparados concorrentemente (não apenas
   em sequência), cobrindo pelo menos: duas vendas simultâneas da última unidade de um
   produto; checkout repetido com o mesmo `commandId`; o mesmo `commandId` com payload
   diferente; estorno concorrente da mesma venda; ajuste de estoque concorrente do mesmo
   produto; criação simultânea de dois produtos com o mesmo ISBN; reativação concorrente de
   um produto cujo ISBN foi reaproveitado; mudança de papel de um usuário durante uma sessão
   ativa dele; revogação de sessão concorrente com uma requisição em andamento; consumo
   simultâneo do mesmo código de confirmação por e-mail; falha de rede simulada com retry;
   conflito de transação forçado; expiração de código/senha nos limites exatos (7, 8, 15,
   40 caracteres/minutos conforme o caso, nos limites e um valor além de cada limite).
2. O critério de aprovação de cada cenário DEVE ser definido por integridade (nenhuma
   duplicação, nenhum estoque negativo, nenhuma sessão indevidamente válida/invalidada,
   exatamente um resultado vencedor onde só um deveria vencer) — tempo de resposta não é o
   critério de aprovação desses testes específicos (esse é o foco do Requisito 8).
3. Esses cenários DEVEM fazer parte da suíte automatizada reutilizável, não apenas de uma
   verificação manual única no momento da migração.

### Requisito 17 — Ciclo de vida e privacidade dos dados

**User story:** Como dono da livraria, quero que dados pessoais e históricos continuem
tratados com o mesmo cuidado de privacidade de hoje, sem violar nenhuma obrigação legal
aplicável.

**Critérios de aceite:**
1. O design DEVE definir, por domínio, por quanto tempo um dado operacional (ex: sessão
   expirada, código de confirmação consumido, cerimônia de passkey finalizada) permanece
   armazenado antes de poder ser limpo.
2. A auditoria (Requisito 6) DEVE ter retenção definida separadamente dos dados
   operacionais, já que serve a um propósito diferente (histórico/conformidade).
3. Sessões expiradas ou revogadas DEVEM ter um critério definido de limpeza eventual, sem
   comprometer a auditoria de quem teve acesso a quê.
4. O tratamento de dados pessoais (CPF, contato) DEVE continuar seguindo o princípio de
   minimização já aplicado hoje (coletar apenas o necessário, cifrar o que for sensível,
   nunca devolver o valor completo ao cliente sem necessidade).
5. O design DEVE considerar as obrigações aplicáveis da LGPD para os dados pessoais
   tratados (titular, finalidade, e eventual direito de exclusão/anonimização dentro do que
   for legalmente cabível para este sistema).
6. O sistema NÃO PODE eliminar um registro necessário à integridade financeira, à auditoria
   ou a uma obrigação legal, mesmo a pedido de exclusão, quando a retenção for exigida por
   lei ou pela integridade contábil — nesse caso, anonimização é preferível a exclusão,
   quando legalmente suficiente.
7. SE um mecanismo de expiração/limpeza automática do Firestore (ex: TTL) for usado, ENTÃO
   o design DEVE registrar que sua execução é eventual (não instantânea no momento exato do
   vencimento) e não depender de uma exclusão instantânea para uma garantia de segurança.

### Requisito 18 — Cutover, reconciliação e rollback (detalhamento operacional)

**User story:** Como responsável pela operação, quero um roteiro operacional concreto para
o dia do corte, complementando as garantias gerais já definidas no Requisito 10.

> Este requisito detalha a **operacionalização** do Requisito 10; não repete suas garantias
> gerais, apenas as torna executáveis passo a passo.

**Critérios de aceite:**
1. DEVE existir um checklist pré-corte, incluindo: confirmação do backup mais recente
   (Requisito 13), confirmação de que a suíte de testes adaptada está 100% aprovada, e
   confirmação de qual armazenamento é a fonte da verdade no momento do checklist.
2. DEVE existir um critério explícito de quando e como as gravações no armazenamento de
   origem são congeladas (ou reduzidas a um modo seguro) durante a janela do corte, se
   necessário para aquele domínio.
3. DEVE existir uma verificação de contagem de registros (produtos, vendas, usuários,
   sessões ativas, etc.) comparando origem e destino antes de considerar o corte concluído.
4. DEVE existir uma verificação de saldo de estoque por produto e de totais financeiros de
   vendas no período, comparando origem e destino, com qualquer divergência tratada como
   bloqueio ao corte, não como aviso ignorável.
5. DEVE existir uma verificação de identidades e sessões ativas, confirmando que nenhuma
   conta perde acesso indevidamente e que nenhuma sessão é indevidamente revalidada no novo
   armazenamento.
6. DEVE existir um período definido de monitoramento intensivo pós-ativação (ex: métricas
   de erro e latência do Requisito 14 observadas de perto por um tempo mínimo definido)
   antes de considerar o corte estável.
7. DEVEM existir critérios objetivos e pré-definidos de quando acionar o rollback (ex: taxa
   de erro acima de um limiar, uma divergência de integridade financeira encontrada) — a
   decisão de reverter não pode ser subjetiva no momento da crise.
8. O procedimento de rollback DEVE incluir como reconciliar, de volta para a origem, qualquer
   operação de negócio ocorrida no Firestore entre o corte e o rollback, sem perda e sem
   duplicação — nunca um rollback que simplesmente descarta esse período.
9. DEVE haver um responsável designado e evidência registrada (ex: capturas de tela, saída
   dos scripts de verificação) de cada etapa executada no dia do corte, para permitir
   auditoria posterior do próprio processo de migração.
