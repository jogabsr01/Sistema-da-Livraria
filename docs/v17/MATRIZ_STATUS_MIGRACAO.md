# Matriz de status — migração Firestore

Esta matriz distingue código local, evidência em emulador oficial e operação real. Um rótulo de conclusão local não aprova cutover nem comprova IAM, backup restaurável ou dados reais. A numeração das fases do plano formal em `.kiro/specs/firestore-migration/tasks.md` prevalece; marcos conversacionais são apenas agrupamentos de trabalho.

| Componente | Estado | Evidência e limite |
|---|---|---|
| Inspeção de cabeçalhos, consolidação e dry-run de fixtures | [CONCLUÍDO LOCAL/SINTÉTICO] | Scripts e testes locais; não extraem linhas reais. |
| Contratos de catálogo e operação, mapeador de fixture | [CONCLUÍDO LOCAL/SINTÉTICO] | Validação parcial em memória; não produz documentos completos de destino. |
| Planejador e inspeção de destino/backup | [CONCLUÍDO LOCAL/SINTÉTICO] | Checkpoints são simulados; TCP não prova identidade do emulador, hash não prova restauração. |
| Escrita transacional, recuperação e reconciliação de importação | [PENDENTE DE EXECUÇÃO EM EMULADOR] | Projetar e testar com emulador oficial, incluindo mídia, índices, cifra, conflitos, concorrência e reexecução. Sem evidência não marcar como concluído. |
| Testes concorrentes Firestore existentes | [CONCLUÍDO LOCAL/SINTÉTICO] | Executados no emulador oficial local: 619 testes passaram, sem ignorados. Não são testes do importador, ainda inexistente. |
| Extração consistente, backup restaurável, shadow, delta e rollback | [PENDENTE DE CUTOVER REAL] | Dependem de origem, destino e procedimentos autorizados e comprovados. |
| Cutover, homologação e produção | [PENDENTE DE CUTOVER REAL] | Requer reconciliação, paridade funcional, segurança, desempenho e aprovação explícita. |

O modo operacional em dados reais não é autorizado por esta matriz. Nenhum status aqui prova que registros reais tenham sido migrados.

## Bloqueio do executor de importação

O mapeador operacional existente descarta o candidato e retorna apenas contagens. Ele não produz os documentos completos necessários aos serviços Firestore: índices `productSearch`, reservas `uniqueness`, vínculos de identidade, dados de clientes selados e indexados com chaves do destino, comandos/eventos/projeções e histórico de vendas compatível. A origem real de clientes pode conter contato cifrado e CPF vazio. Os testes sintéticos atuais não comprovam que esse material possa ser transformado. A implementação de um executor que gravasse apenas o contrato intermediário criaria dados inválidos ou incompletos; por isso o planejador continua sem escrita. Antes de escrever, definir e testar o contrato completo e a política de identidade e chaves, incluindo preservação e reconciliação das mídias existentes.

O emulador oficial foi executado em loopback com Java local, e a suíte existente passou integralmente; não houve teste de importador ou reconciliador de importação, pois ainda não existem. Nenhum cutover foi realizado.

Foi iniciado `backend/firestore-document-mapper.mjs` para documentos de produtos e nichos, suas mídias e reservas/índice de busca. O mapeamento é parcial e somente em memória: não trata clientes, movimentos, vendas, outbox ou auditoria, não preserva automaticamente mídia já existente e não foi aprovado para gravação. A ausência explícita de mídia só é segura para destino comprovadamente vazio; o executor permanece inexistente.

Atualização: o mesmo módulo também mapeia documentos de cliente, reserva de CPF, movimento e venda/itens a partir de contratos explícitos. A cifra de cliente mantém nonce aleatório e o fingerprint HMAC é estável; o executor futuro deve conservar a cifra já commitada ao retomar. A transformação das sete abas ainda não fornece todas as entradas necessárias (inclusive versões históricas e identidades); o mapeador não cria auditoria/outbox nem prova integridade entre documentos. Assim, permanece parcial, sem executor ou reconciliador pós-importação e não aprovado para gravação.

`backend/import-context-defaults.mjs` acrescenta resolução explícita de ator sintético e versão inicial de novos documentos, com proveniência; versões de movimentos são sequências locais de importação somente quando é fornecida uma cadeia declarada completa e consistente. A declaração não comprova completude nem recria a versão histórica da origem. O módulo ainda não está integrado ao pipeline ou a um escritor; títulos históricos, origem cifrada, auditoria, outbox, conflitos e concorrência continuam pendentes.

O mapeador também possui políticas puras para conservar cifra existente somente após verificar CPF indexado, metadados e contato autenticado completo, e para preservar mídia existente consistente sem substituí-la. Essas funções não leem Firestore nem são uma transação: o futuro executor deve ler e verificar os documentos na mesma transação de escrita, inclusive reservas de unicidade, para evitar corridas. O contrato de payload completo e o escritor permanecem pendentes.

`projectOperationalFixture` fornece projeção detalhada opcional em memória, exige UUIDs de destino explícitos e sinaliza a proveniência do ator e das versões locais. Ela contém registros de origem e PII, não deve ser impressa nem persistida e não equivale a payload Firestore completo. Ainda faltam política para títulos históricos, validação cruzada com versões finais dos produtos, identidade e cifragem da origem, documentos auxiliares e protocolo de commit/reconciliação; portanto não autoriza escrita.

O auxiliar `resolveHistoricalSaleTitles` exige snapshot histórico explícito e correspondência exata dos itens; não utiliza título atual como substituto. O código GAS mostra títulos em linhas de eventos de vendas recentes, mas `Itens_Venda` não contém título: extração, validação de integridade e compatibilidade de eventos legados ainda precisam ser implementadas. A função isolada não comprova autenticidade do snapshot nem integra o pipeline de importação.