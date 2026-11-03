# Tarefas — Migração do armazenamento vivo para o Firestore

A implementação será feita somente no ambiente `dev`. As tarefas seguem a ordem de
dependência do `design.md`. Nenhuma tarefa inclui deploy, exclusão de dados, congelamento de
gravações ou alteração de produção sem confirmação operacional do responsável.

## Regras de execução

- manter o modo `gas` funcionando até o cutover aprovado;
- não relaxar testes de regra de negócio ou segurança;
- adaptar somente testes que verificam a infraestrutura GAS/Sheets;
- toda tarefa que mudar contrato, erro, credencial ou fonte da verdade deve atualizar a
  matriz de equivalência em `design.md`;
- qualquer incompatibilidade diferente das exceções de senha e TTL de e-mail bloqueia a
  tarefa e deve ser comunicada antes de continuar;
- nenhuma credencial Google Cloud, chave de e-mail ou dado real deve entrar no Git;
- cada fase deve terminar com validação registrada antes de iniciar a seguinte.

## Fase 0 — Pré-requisitos operacionais e baseline

- [ ] **1. Preparar o ambiente técnico de desenvolvimento**
  - [ ] Confirmar com o responsável o projeto Google Cloud exclusivo para `dev`, banco
        Firestore Native, região e situação da cota gratuita.
  - [ ] Criar ou receber a identidade de serviço do backend com menor privilégio e configurar
        o acesso local pelo emulator, sem usar credencial de produção.
  - [ ] Definir o bucket privado de backup, identidade de backup, retenção e alerta de
        orçamento, caso a exportação gerenciada seja aprovada.
  - [ ] Registrar as variáveis de ambiente no `.env.example` sem valores secretos e validar
        isolamento entre `dev` e `prod`.
  - [ ] Parar e avisar antes de habilitar billing, criar credencial, alterar Netlify ou
        executar qualquer operação no projeto do responsável.
  - **Requisitos:** 9, 12, 13.

- [ ] **2. Definir as integrações externas bloqueantes**
  - [ ] Escolher o provedor de e-mail e documentar API, remetente/domínio, idempotency key,
        limites e tratamento de timeout.
  - [ ] Criar a chave separada para cifrar `deliveryCiphertext` no outbox, usando a mesma
        organização de segredos já adotada pelo projeto.
  - [ ] Confirmar como o backend lerá capas, fotos de perfil e imagens de nicho do Drive
        privado, ou aprovar a migração posterior para Cloud Storage.
  - [ ] Não habilitar fluxos de e-mail no Firestore antes de o provedor ser testado sem
        expor código em log.
  - **Requisitos:** 2, 5, 12, 15, 17.

- [ ] **3. Registrar a baseline das nove operações**
  - [ ] Instrumentar `Server-Timing` em login completo, validação de sessão, catálogo,
        cadastro de produto, recebimento de estoque, checkout, estorno, consulta de relatório
        e exportação `.xlsx`.
  - [ ] Separar cold start, warm start, tempo de aplicação, RPC atual, geração XLSX, erro e
        número de chamadas internas.
  - [ ] Executar uma carga representativa no `dev` atual baseado em dados não sensíveis e
        registrar p50, p95, p99, taxa de erro e volume.
  - [ ] Definir a meta pós-migração como redução relativa à baseline e registrar os limiares
        de alerta antes do cutover.
  - **Requisitos:** 1, 8, 14.

- [ ] **4. Inventariar o estado vivo atual**
  - [ ] Listar tabelas da planilha principal e da planilha privada de identidade.
  - [ ] Listar Script Properties, flags, intents, controles de rate limit, passkeys, códigos,
        referências de Drive, backups e estados de recuperação.
  - [ ] Produzir exportação de inventário com contagens, hashes e versão do schema, sem
        imprimir dados sensíveis.
  - [ ] Registrar os IDs dos stores e a fonte da verdade como GAS/Sheets.
  - **Requisitos:** 10, 11, 13, 18.

## Fase 1 — Fundação Firestore e contrato interno

- [ ] **5. Adicionar cliente Firestore e configuração segura**
  - [x] Adicionar a dependência Firestore compatível com Node 22 e fixar sua versão no lockfile.
  - [x] Implementar `backend/firestore-config.mjs` com validação de ambiente, projeto,
        database, região, prefixo e credencial.
  - [ ] Implementar cliente para o Firestore Emulator e impedir que testes locais aceitem
        configuração de `prod` por acidente.
  - [x] Criar `WORKSPACE_STORAGE_MODE=gas|shadow|firestore` com comportamento fechado para
        valores inválidos.
  - [x] Manter o caminho GAS inalterado quando o modo for `gas`.
  - **Requisitos:** 10, 12.

- [ ] **6. Criar a fachada de armazenamento e os contratos de repositório**
  - [ ] Extrair a implementação GAS atual para o adaptador `gas-workspace-client` sem mudar
        os DTOs consumidos pelos handlers.
  - [x] Criar `firestore-workspace-client` com a mesma superfície de métodos por domínio.
  - [ ] Criar tipos/validadores para documentos, referências, Timestamp, campos versionados e
        erros de infraestrutura.
  - [ ] Proibir acesso a Firestore em handlers e manter autorização, CSRF e validação no
        servidor.
  - [ ] Adicionar testes que demonstrem que a troca de adaptador não altera resposta HTTP.
  - **Requisitos:** 1, 3, 11, 12.

- [ ] **7. Implementar comandos, transações, retries e mapeamento de erros**
  - [x] Criar `commands` com fingerprint canônico, ator, estado, resultado e retenção por
        domínio.
  - [x] Implementar intenção durável antes da projeção e recuperação de comandos em estado
        intermediário.
  - [x] Implementar transação com no máximo cinco tentativas, backoff crescente, jitter e
        deadline da Function.
  - [x] Classificar `ABORTED`, timeout e indisponibilidade sem expor erro interno.
  - [ ] Integrar conflito de versão, colisão de unicidade e resultado incerto ao mapeamento
        específico de cada domínio.
  - [ ] Mapear cada falha para os códigos existentes em `backend/protocol.mjs` ou registrar
        aprovação explícita antes de criar um código novo.
  - [x] Garantir que retry do mesmo comando devolva o resultado persistido sem duplicação.
  - **Requisitos:** 1, 4, 6, 11, 15.

- [ ] **8. Implementar observabilidade transversal**
  - [ ] Criar logs estruturados com `requestId`, endpoint, operação, tentativa, duração,
        resultado e contagens, sem CPF, senha, PIN, código, token ou segredo.
  - [ ] Adicionar métricas de latência, erro, conflito, retry, outbox, cold start e warm start.
  - [ ] Instrumentar `Server-Timing` para o cliente Firestore e manter compatibilidade dos
        headers HTTP.
  - [ ] Criar classificação separada para erro esperado de validação, falha de autenticação,
        conflito transacional e indisponibilidade.
  - **Requisitos:** 8, 14.

- [ ] **9. Criar schema versionado e configuração de índices**
  - [ ] Definir versão do schema Firestore e migrações de campos retrocompatíveis.
  - [ ] Criar configuração de índices compostos para catálogo, vendas, movimentos, sessões,
        auditoria, notificações, escalas e outbox.
  - [ ] Desativar indexação de ciphertext, hashes grandes, payloads e blobs que não forem
        consultados.
  - [x] Validar documentos com margem de 900 KiB e dividir estruturas grandes em subcoleções.
  - [ ] Criar verificação que falhe se schema ou índices necessários estiverem ausentes.
  - **Requisitos:** 6, 11, 17.

## Fase 2 — Identidade, senha e sessão

- [ ] **10. Portar credenciais para o modelo explícito**
  - [x] Reutilizar scrypt `N=32768`, `r=8`, `p=1`, pepper, salt por registro e comparação em
        tempo constante.
  - [x] Criar primitiva `PASSWORD_V1` com contagem Unicode e preservação exata da entrada.
  - [x] Persistir `PASSWORD_V1` e `PIN_LEGACY` no documento privado de credencial.
  - [x] Manter registro dummy e resposta indistinguível para conta inexistente/senha errada.
  - [x] Proibir senha, PIN, código e hash restrito em log, auditoria e DTO.
  - [ ] Importar credenciais legadas sem recriar usuário, papel, status ou histórico.
  - **Requisitos:** 1, 2, 5, 6, 10, 17.

- [ ] **11. Substituir PIN por senha na interface e nos contratos**
  - [x] Alterar `acesso-dev.html`, `acesso-dev.css` e `acesso-dev.js` para campos e mensagens
        de senha, sem manter layout ou regra visual de PIN.
  - [x] Validar 8–40 pontos de código Unicode no frontend e repetir a validação no backend.
  - [x] Preservar espaços internos e extremos conforme digitados, sem `trim` silencioso.
  - [x] Remover a regra de dígitos iguais lado a lado e não exigir classes de caracteres.
  - [x] Atualizar payloads, mensagens, acessibilidade e `autocomplete` sem expor o valor.
  - [x] Atualizar o modo restrito de `ADMIN_PASSWORD_LOGIN_ENABLED` somente para `dev`.
  - **Requisitos:** 1, 2, 16.

- [ ] **12. Implementar fluxos de e-mail de 900 segundos**
  - [ ] Criar campos separados `codeExpiresAt` e `flowExpiresAt`.
  - [x] Aplicar 900 segundos a ativação, redefinição, recuperação, troca de e-mail e todo
        fluxo futuro que entregue código por e-mail.
  - [x] Preservar o código de acesso de sete caracteres e o formato URL-safe específico da
        troca de e-mail quando aplicável.
  - [x] Implementar consumo único, cinco tentativas de prova e invalidação atômica.
  - [x] Cifrar o código no outbox com `deliveryCiphertext`; guardar somente hash para prova.
  - [ ] Testar limites exatos de expiração e concorrência de dois consumidores.
  - **Requisitos:** 2, 12, 15, 16, 17.

- [ ] **13. Implementar migração de PIN legado para senha**
  - [x] Fazer login de conta `PIN_LEGACY` encaminhar para fluxo explícito de migração, sem
        aceitar quatro dígitos como senha.
  - [x] Exigir código de e-mail e passkey existente ou recuperação autorizada antes de criar
        sessão.
  - [x] Gravar nova credencial, incrementar `authorizationVersion` e invalidar sessões na
        mesma transação.
  - [x] Preservar identificador, papel, status e histórico da conta.
  - [x] Criar resposta/estado que o frontend consiga apresentar sem divulgar se o PIN antigo
        era válido.
  - **Requisitos:** 1, 2, 10, 15.

- [ ] **14. Portar usuários, sessões, passkeys e rate limits**
  - [ ] Migrar usuários, epochs, credenciais, passkeys, sessões ativas, desafios, fluxos,
        códigos de emergência e limitadores das duas fontes atuais.
  - [x] Implementar lookup de sessão por hash, expiração absoluta de 24 horas e epoch dentro
        da leitura autoritativa.
  - [x] Implementar fluxo inicial LOGIN/PASSKEY/COMMIT com sessão Firestore e lookup de credencial.
  - [ ] Completar revogação por logout, papel/status, troca de e-mail, recuperação e passkey
        junto com as mutações correspondentes de identidade.
  - [ ] Preservar limites por conta/origem, bloqueio exponencial e reset das janelas.
  - [x] Reutilizar `@simplewebauthn/server` com RP ID, origem, `userVerification: required` e
        algoritmo -7 no serviço Node existente.
  - [x] Persistir passkeys, cerimônias, contador anti-replay e limite de cinco chaves no Firestore.
  - [x] Remover a recuperação acoplada de outros domínios da leitura de sessão.
  - **Requisitos:** 2, 3, 12, 15, 17.

- [ ] **15. Portar outbox e entrega de e-mail**
  - [x] Implementar lease, idempotency key, backoff e limite de tentativas.
  - [ ] Implementar consulta de resultado no provedor para timeout incerto antes de reenviar.
  - [x] Garantir que transação Firestore nunca chame provedor, MailApp ou Drive.
  - [x] Registrar somente estado de entrega e classificação segura do erro.
  - [ ] Testar indisponibilidade, quota, retry e entrega duplicada simulada.
  - **Requisitos:** 2, 12, 14, 15.

## Fase 3 — Dados pessoais, catálogo e estoque

- [ ] **16. Portar equipe, clientes e perfil**
  - [ ] Migrar usuários/equipe da planilha principal e controles da planilha privada.
  - [x] Reutilizar AES-256-GCM, versões de chave e HMACs independentes do vault atual no limite HTTP/cliente.
  - [x] Criar reservas transacionais de CPF para clientes/equipe e manter erros distintos de duplicidade.
  - [x] Portar clientes com revisão, contatos cifrados, consentimento, última compra, busca e DTOs.
  - [x] Portar listagem/salvamento de equipe com revisão, papel/status, epoch e contato cifrado.
  - [x] Implementar bootstrap/get/save de perfil com revisão, contato cifrado e auditoria.
  - [ ] Completar vínculo do CPF do proprietário, passkeys, ativação, recuperação, fotos e troca de e-mail.
  - [ ] Criar DTOs equivalentes de equipe sem CPF ou contato completo.
  - **Requisitos:** 3, 5, 6, 10, 11, 17.

- [ ] **17. Portar produtos, nichos, unicidade e busca**
  - [x] Implementar leitura Firestore de catálogo/nichos com filtros, DTOs e sessão autoritativa.
  - [ ] Migrar produtos, relações de nicho, nichos, versões, ativação e referências de imagem.
  - [x] Implementar reservas de ISBN/código somente para produtos ativos, incluindo reativação.
  - [x] Implementar save/remove com versão otimista, unicidade transacional, evento, auditoria
        e índice de busca determinístico.
  - [ ] Implementar `productSearch` com n-gramas limitados e filtro `includes` no serviço.
  - [ ] Preservar limites de 5.000 produtos, 20 nichos por produto, campos e preços em centavos.
  - [ ] Implementar cursores internos com compatibilidade temporária de `offset`/`nextOffset`.
  - [ ] Adaptar leitura privada de capas/imagens e validar hash/tamanho/MIME.
  - **Requisitos:** 1, 4, 7, 8, 11, 17.

- [ ] **18. Portar movimentos e mutações de estoque**
  - [x] Criar produto com saldo/versionamento e movimento append-only por operação.
  - [x] Implementar recebimento, ajuste e reversão com movimento e cadeia saldo anterior/posterior.
  - [x] Criar reconciliação da cadeia de estoque e detectar divergências de saldo/versão.
  - [x] Exigir `expectedVersion` nas mutações de produto/recebimento e retornar conflito sem
        sobrescrita.
  - [x] Preservar limite de 1.000.000 e proibir estoque negativo em produto, recebimento e
        checkout.
  - [x] Garantir comando, evento, movimento, produto e auditoria na mesma transação para
        recebimento e checkout.
  - **Requisitos:** 4, 6, 11, 15, 16.

- [ ] **19. Implementar checkout transacional**
  - [x] Recalcular preço, total, produto ativo, estoque e cliente no servidor dentro da mesma
        transação.
  - [x] Gravar comando/idempotency key, venda, itens, movimentos, evento e auditoria juntos.
  - [x] Preservar limite de até 100 linhas; falta concluir o orçamento de bytes/leitura da
        transação antes do corte.
  - [x] Garantir que duas vendas concorrentes da última unidade tenham somente um vencedor.
  - [ ] Implementar consulta de resultado após timeout incerto e recibo idempotente.
  - [x] Preservar formato, status e códigos de erro do endpoint `/api/v1/checkout`.
  - **Requisitos:** 1, 4, 6, 8, 11, 15, 16.

## Fase 4 — Domínios restantes e relatórios

- [ ] **20. Portar notificações e projeções**
  - [x] Criar notificações e destinatários como documentos independentes.
  - [x] Implementar leitura, resumo e estado com revisão/idempotência.
  - [x] Mover alertas de estoque para outbox/projeção sem bloquear a transação do negócio.
  - [ ] Integrar projeção de escalas e confirmar agenda/execução do worker no ambiente `dev`.
  - [x] Garantir que falha de projeção não invalide venda, sessão ou auditoria.
  - [x] Preservar filtros, paginação e DTOs dos endpoints atuais para notificações já importadas.
  - **Requisitos:** 4, 6, 11, 14, 15.

- [ ] **21. Portar escalas e gestão de versões**
  - [ ] Migrar escalas e referências de funcionários.
  - [x] Implementar listagem por funcionário/período, consulta por ID e regras de visibilidade atuais; cursor interno ainda pendente.
  - [x] Implementar salvar/cancelar com `commandId`, fingerprint e `expectedRevision`.
  - [x] Preservar sobreposição, publicação, cancelamento e erros de conflito.
  - [x] Criar plano de notificações de escala no outbox com IDs determinísticos.
  - **Requisitos:** 3, 6, 11, 15, 17.

- [ ] **22. Portar auditoria append-only**
  - [x] Gravar evento de auditoria na mesma transação de cada operação Firestore implementada.
  - [x] Impedir update/delete de `auditEvents` pelos repositórios normais.
  - [x] Sanitizar antes/depois e omitir PII completa, credenciais, tokens e códigos.
  - [x] Criar IDs determinísticos/idempotentes e usar relógio do servidor.
  - [x] Implementar consultas por período/filtros e paginação.
  - [x] Preservar `audit-xlsx.mjs` e o formato das abas/colunas por meio do handler existente.
  - [ ] Integrar Cloud Audit Logs, hashes/contagens e exportação para detectar alteração
        administrativa sem afirmar imutabilidade absoluta.
  - **Requisitos:** 1, 6, 7, 12, 13, 14, 17.

- [ ] **23. Portar relatórios e insights**
  - [x] Implementar leitura coerente de produtos, vendas, movimentos, clientes, equipe e nichos para relatórios comerciais.
  - [x] Preservar snapshot, filtros, limites e erros `REPORT_CHANGED` no contrato existente.
  - [x] Manter `report-xlsx.mjs` e o formato dos arquivos gerados.
  - [x] Registrar consulta/exportação com comando idempotente e auditoria sanitizada.
  - [x] Retornar erro de capacidade em vez de gerar retrato misturado ou incompleto.
  - [x] Implementar perfil de compra, insights e fonte para mensagens; envio externo continua bloqueado até provedor aprovado.
  - **Requisitos:** 1, 7, 8, 11, 14, 15.

- [ ] **24. Atualizar diagnóstico de schema e health**
  - [ ] Manter `/api/v1/health` como liveness sem revelar infraestrutura sensível.
  - [ ] Adaptar `/api/v1/schema` para versão e coleções Firestore, preservando autorização,
        resposta e códigos públicos.
  - [ ] Garantir que o diagnóstico não retorne nomes de projeto, credenciais, PII ou payloads.
  - **Requisitos:** 1, 12, 14.

## Fase 5 — Migração de dados, reconciliação e rollback

- [ ] **25. Implementar exportação e importação inicial**
  - [ ] Criar scripts para exportar planilha principal, planilha privada, Script Properties e
        referências de Drive sem alterar a origem.
  - [ ] Converter linhas para documentos versionados, preservando IDs, datas, versões,
        relacionamentos e campos cifrados.
  - [ ] Importar primeiro em banco/emulator descartável e depois em área `dev` isolada.
  - [ ] Registrar contagens, hashes, origem, destino, versão e erros em `migrationRuns`.
  - [ ] Tornar a importação repetível e idempotente por lote/ID.
  - **Requisitos:** 10, 11, 13, 17, 18.

- [ ] **26. Implementar reconciliação por domínio**
  - [ ] Comparar contagem e IDs de produtos, nichos, clientes, usuários, passkeys, sessões,
        vendas, itens, movimentos, auditoria, notificações e escalas.
  - [ ] Comparar saldo de estoque por produto e totais financeiros por período.
  - [ ] Comparar epochs, credenciais por tipo, sessões ativas e referências de ativos.
  - [ ] Tratar qualquer divergência financeira, de saldo ou identidade como bloqueio.
  - [ ] Gerar relatório sanitizado com evidências e assinatura/hash da execução.
  - **Requisitos:** 5, 6, 10, 13, 18.

- [ ] **27. Implementar shadow-read e comparação de contrato**
  - [ ] Executar consultas Firestore em paralelo às respostas GAS sem expor resultado shadow.
  - [ ] Comparar DTOs normalizados, códigos de erro, paginação, snapshots e autorização.
  - [ ] Medir leituras, gravações, conflitos, latência e divergências por operação.
  - [ ] Corrigir divergências antes de alterar qualquer fonte de verdade.
  - **Requisitos:** 1, 8, 10, 11, 14.

- [ ] **28. Implementar replay e ponte de rollback**
  - [ ] Registrar eventos pós-corte suficientes para reaplicar vendas, estornos, ajustes,
        identidade e auditoria sem duplicação.
  - [ ] Criar adaptador GAS compatível com `PASSWORD_V1`, epoch e passkeys antes do corte de
        identidade.
  - [ ] Implementar replay por agregado, preservando IDs e ordem de versões.
  - [ ] Testar rollback completo em ambiente descartável sem descartar eventos Firestore.
  - [ ] Bloquear rollback se o domínio ainda não tiver replay e compatibilidade testados.
  - **Requisitos:** 2, 10, 15, 18.

- [ ] **29. Executar checklist de cutover em `dev`**
  - [ ] Confirmar backup restaurável, suíte 100% aprovada, configuração, versão e fonte da
        verdade atual.
  - [ ] Congelar gravações no domínio dependente, exportar delta e concluir reconciliação.
  - [ ] Alternar feature flag para Firestore somente após contagens, saldos, totais,
        identidades e sessões serem iguais.
  - [ ] Registrar responsável, horários, hashes, saída dos scripts e evidências.
  - [ ] Monitorar por no mínimo duas horas e usar critérios pré-definidos de rollback.
  - **Requisitos:** 10, 13, 14, 18.

## Fase 6 — Validação final e operação

- [ ] **30. Adaptar e ampliar testes de contrato**
  - [ ] Executar a suíte atual contra o adaptador Firestore sem relaxar asserções.
  - [ ] Adaptar testes que verificam linhas GAS para documentos, transações e coleções.
  - [x] Reescrever testes de PIN para senha nos limites exatos e testar TTL de 900 segundos.
  - [ ] Cobrir sucesso, validação, autorização, conflito, erro incerto, retry e forma da
        resposta para cada endpoint da matriz.
  - **Requisitos:** 1, 2, 3, 4, 5, 6, 7, 15, 16.

- [ ] **31. Criar suíte concorrente reutilizável**
  - [ ] Implementar os cenários de duas vendas da última unidade, idempotência, payload
        diferente, estorno, ajuste, ISBN, reativação, papel, sessão, código de e-mail,
        network retry e conflito forçado.
  - [ ] Testar expiração e tamanho de senha/códigos nos limites e um valor além.
  - [ ] Verificar integridade, não apenas tempo de resposta.
  - [ ] Rodar no emulator e repetir cenários selecionados no projeto `dev` real.
  - **Requisitos:** 4, 8, 11, 15, 16.

- [ ] **32. Repetir baseline e validar desempenho**
  - [ ] Reexecutar as mesmas nove operações em condições comparáveis.
  - [ ] Reportar p50, p95, p99, erro, cold/warm, leituras, gravações, retries e conflitos.
  - [ ] Comparar com baseline e comprovar melhoria nas operações de login, catálogo e
        checkout.
  - [ ] Registrar limites e ações caso a meta de desempenho não seja atingida.
  - **Requisitos:** 8, 9, 14.

- [ ] **33. Validar backup, restauração, custo e retenção**
  - [ ] Executar restauração em ambiente separado e comprovar documentos, saldos, identidade
        e auditoria.
  - [ ] Medir consumo de leituras, gravações, índices, armazenamento, tráfego e exports.
  - [ ] Comparar com estimativa diária e projeção de auditoria.
  - [ ] Confirmar alertas de orçamento, cota, erro, outbox, conflito e backup.
  - [ ] Registrar RPO/RTO observado e ajustar procedimento sem alterar retenção de forma
        silenciosa.
  - **Requisitos:** 9, 13, 14, 17.

- [ ] **34. Fechar runbook e habilitação do modo Firestore**
  - [ ] Documentar preflight, importação, reconciliação, cutover, monitoramento e rollback.
  - [ ] Registrar fonte da verdade e responsável para cada etapa.
  - [ ] Confirmar que nenhum dual-write não controlado permanece ativo.
  - [ ] Confirmar que o modo `prod` e qualquer deploy não foram tocados por esta fase.
  - [ ] Somente após aprovação operacional, alterar `WORKSPACE_STORAGE_MODE` de `shadow` para
        `firestore` no ambiente `dev`.
  - **Requisitos:** 1, 9, 10, 12, 13, 14, 18.

## Critério geral de conclusão

A migração estará pronta para o uso autoritativo em `dev` somente quando:

- todas as tarefas bloqueantes estiverem concluídas;
- a matriz HTTP tiver cobertura de contrato e nenhuma incompatibilidade não aprovada;
- reconciliação de registros, saldos, totais, identidades e sessões tiver zero divergência;
- testes concorrentes comprovarem integridade e idempotência;
- backup tiver sido restaurado com sucesso;
- baseline e pós-migração demonstrarem melhoria mensurável nas operações principais;
- custos e retenções estiverem dentro do plano aprovado;
- o runbook de rollback tiver sido testado;
- o responsável tiver confirmado as dependências externas e o cutover de `dev`.
