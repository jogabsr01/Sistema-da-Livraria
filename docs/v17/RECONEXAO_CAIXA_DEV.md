# Reconexão segura do Caixa — DEV

Este incremento trata a pendência de desconexão e reconciliação na frente de Caixa compartilhada. Não encerra essa área do v17: os outros módulos e a homologação com aparelhos e Google reais permanecem pendentes.

## Comportamento do operador

O Caixa mostra uma faixa com quatro estados: sem conexão, conferindo, estoque precisa ser conferido e estoque conferido. Uma queda bloqueia novas confirmações, adição de livros e edição do carrinho. Os dados já exibidos continuam visíveis como referência, com o horário da última consulta. Não há registro de venda offline nem fila de envio em segundo plano.

Ao reconectar, o Caixa confere a sessão da mesma conta, atualiza o CSRF e consulta nichos, página atual e cada livro selecionado que estiver fora dessa página. Somente uma consulta completa libera novas confirmações. Uma resposta iniciada antes de uma desconexão, retorno da rede ou ocultação da aba não pode liberar o Caixa. Se houver uma consulta em andamento ao reconectar, outra será feita após ela terminar.

Preços e saldo alterados por outro atendimento aparecem na nova conferência. Um livro que esgotou continua no cadastro, ativo e editável, mas bloqueia a venda. A validação final de preços, sessão, papel e saldo continua no servidor sob o lock existente; a faixa não garante reserva de estoque.

O estoque consultado perde a validade para novas vendas após 90 segundos, medidos pelo relógio monotônico da página. O Caixa continua consultando a cada 30 segundos enquanto visível, além de foco, retorno à aba e reconexão. Ocultar a aba invalida a conferência; restaurar uma página do histórico também exige nova consulta. Cada atualização inclui uma leitura de sessão adicional: impacto em quotas e latência reais precisa de homologação.

## Venda com resultado incerto

Uma falha de resposta não significa venda recusada. O comando técnico já usado permanece na chave `checkout.pending.<usuário>` do sessionStorage, com o mesmo idempotencyKey, itens, pagamento, referência de cliente e total esperado. Não são acrescentados nome, CPF, contato, PIN ou credenciais. O protocolo de armazenamento e a recuperação por recarga permanecem os existentes.

A reconexão nunca reenvia esse comando automaticamente. O operador deve usar **Verificar resultado / tentar novamente**. A conferência explícita pode funcionar mesmo se a consulta do catálogo falhar: uma venda já registrada pode ser recuperada apesar de seu livro ter esgotado. Ela continua exigindo sessão válida da mesma conta e a proteção idempotente do servidor. Offline, o botão fica bloqueado. Recusa da sessão preserva o comando sem enviá-lo ao endpoint de venda.

Enquanto o resultado estiver pendente, alterações no carrinho e nova compra seguem bloqueadas. O navegador recebe um pedido de confirmação de saída, cuja exibição depende das regras do próprio navegador. É necessário manter a aba: sessionStorage permite recuperação por recarga na mesma aba, mas não é backup e não garante recuperação depois de fechar a aba, limpar o navegador, trocar de aparelho ou perder o armazenamento. Um carrinho ainda não enviado permanece somente em memória e não sobrevive a recarga.

## Limites e publicação

Mudança apenas no HTML, CSS e controller do Caixa compartilhado, testes e documentação. Sem nova flag, tabela, segredo, dependência, permissão Google ou migração. O Caixa continua condicionado às flags já existentes e à origem DEV autorizada. Não altera a demonstração local da página inicial. Nenhuma mudança em main/PROD ou ativação Google real.

Não implementa sincronização offline de outros cadastros, envio automático de vendas, pagamentos bancários, backup ou resolução de conflitos de toda a aplicação. [Evidências deste lote](QA_RECONEXAO_CAIXA.md).
