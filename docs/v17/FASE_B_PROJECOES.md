# Fase B: recuperação de projeções no Apps Script

Incremento dependente dos PRs #5 e #6, sem merge automático. O aplicativo público permanece inalterado e o backend desativado. Ainda não conclui a fase B.

`google-apps-script/Sales.gs` implementa a recuperação de eventos de venda em Vendas, Itens_Venda, Movimentacoes_Estoque e Produtos. O diário não é reescrito: a chave da venda e as versões do produto permitem repetição sem duplicar saídas. Os totais usam centavos inteiros e não incluem dados pessoais. Não é um fluxo de pagamento: Forma_Pagamento permanece vazia e Origem é DEV_TEST.

Antes de qualquer projeção, são conferidos o schema, todos os eventos, os hashes dos comandos, os totais, IDs únicos, a cadeia de estoque/versão e eventuais linhas já projetadas. Em conflito, a operação recusa novas escritas. Estoque e versão são gravados juntos na mesma linha. O lock permanece durante a recuperação inteira. Uma falha depois de uma gravação permite repetir a recuperação usando os checkpoints.

`recoverDevelopmentSales` é uma ação de editor exclusiva do proprietário DEV. Nenhuma rota HTTP de venda foi aberta; usuários do protótipo não podem alimentar o diário. A geração durável dos eventos e a autenticação de usuários continuam sendo etapas seguintes. Não inserir eventos manualmente em recursos compartilhados.

## Testes executados

Testes Node exercitam o código Apps Script em contrato descartável de Sheets/Drive. Um evento produzido pelo núcleo Node é validado e projetado pelo código GAS real sob emulação. São injetadas falhas antes e depois de cada gravação de venda, item, movimento e produto, seguidas de duas recuperações. Também são testados histórico corrompido, projeção conflitante, checkpoint desconhecido, duas vendas sucessivas e recusa de PROD, outro proprietário, recurso público e lock ocupado.

Isso não comprova atomicidade de uma chamada Sheets, persistência remota, IAM, quotas ou desempenho Google. A instalação privada DEV ainda é necessária para homologação real. Sheets não fornece transação ACID entre abas: leitores futuros precisam recuperar sob o mesmo lock antes de expor dados consistentes. Não permitir outros escritores em produção.

Limite explícito de 2.000 eventos para evitar varredura sem limite. Ao atingir a capacidade, recusar recuperação; implementar compactação versionada, backup e checkpoints antes de ampliar o uso. O histórico nunca é truncado silenciosamente. Outros tipos de evento ainda não são aceitos.
