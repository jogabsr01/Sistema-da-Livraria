# Operações, ajustes e estornos integrais — DEV

Incremento sobre `dev/d3bd501786524d5a89730499b5c009254a9018a9`, após PR #22. Não altera a home, `main` ou a instalação Google real.

## Experiência e autorização

`/operacoes-dev.html` oferece histórico por período (até 366 dias), paginação de 20 vendas, consulta de comprovante e impressão pelo navegador. ADMIN/SUPER_ADMIN consultam todas as vendas com autenticação forte recente (cinco minutos). ATENDENTE consulta somente as próprias vendas; o servidor recusa um ID de venda alheio com 404. Menus não autorizam operações.

O administrador busca o livro no catálogo e informa o saldo físico correto e motivo. O ajuste é absoluto, não uma soma: `0` é permitido, saldo negativo, fracionário ou acima de 1.000.000 é recusado. A versão esperada impede substituir outra movimentação. Saldo sem alteração é recusado. Para recebimento de novos exemplares, permanece a entrada positiva no catálogo.

No comprovante, o administrador pode registrar cancelamento/estorno **integral**, com motivo e confirmação da conferência das unidades e do acerto do pagamento. O evento restaura exatamente as quantidades originais aos mesmos livros, inclusive se o livro estiver desativado, sem reativá-lo. Outra tentativa com chave diferente é recusada; reenvio da chave original retorna o mesmo resultado.

Esta operação registra o cancelamento e a devolução do estoque. Não executa PIX, devolução bancária, transação de cartão ou transferência de dinheiro. O acerto externo deve ser conferido pelo operador. Devoluções parciais, descontos e ajustes financeiros parciais não estão implementados.

## Integridade e recuperação

Novos eventos append-only `STOCK_ADJUSTED` e `SALE_REVERSED`, versão 1, convivem com eventos de venda v1/v2/v3 e entradas existentes. Assinatura, vinculação DEV, nonce, sessão e papel são novamente verificados no Apps Script sob o mesmo ScriptLock da decisão de estoque. Ajuste/estorno exigem ADMIN/SUPER_ADMIN e MFA/passkey recente.

O estorno referencia uma única venda original v2/v3. Validação cruzada verifica quantidade por livro, valor, pagamento e data. Um evento de estorno por venda; não é possível alterar o valor original enviando outro total pelo navegador. IDs de comandos também são verificados contra a auditoria e o diário de catálogo.

Todas as projeções e cadeias de versões/saldos são validadas antes de aplicá-las. A projeção Vendas admite exclusivamente a transição recuperável CONFIRMADA → CANCELADA quando houver o evento correspondente; outros campos devem continuar idênticos. Itens e auditoria da venda original permanecem. Um novo evento/log/movimento registra a reversão; nada é apagado.

A última compra do cliente é recalculada entre as vendas não canceladas; pode voltar à compra anterior ou ficar vazia. Alterações de contato posteriores são preservadas. Antes de movimentar estoque, recupera-se também uma intenção de cliente que possa ter reservado o mesmo ID de auditoria.

A leitura de catálogo/Caixa/notificações e a recuperação técnica reproduzem eventos financeiros já comprometidos mesmo com a flag de **novas** operações desligada. Isso impede deixar saldos parcialmente aplicados por uma desativação de interface.

Novas vendas guardam o título original em cada linha do evento/recibo. Edições posteriores de título/preço não mudam o comprovante histórico. Eventos antigos continuam válidos; sem título histórico, o comprovante mostra a referência técnica do livro, sem inventar o título à época. Reenvio de uma venda já cancelada informa `state:CANCELADA` ao Caixa, evitando apresentá-la como atualmente confirmada.

A interface conserva o comando incerto em memória, bloqueia edição/fechamento e oferece repetição. Não grava motivos financeiros em localStorage/sessionStorage. Se a aba for fechada após uma resposta perdida, consultar saldo e histórico antes de uma nova operação. Ajuste absoluto com versão e reversão única evitam repetição da mesma devolução. Não existe fila offline de estornos.

## Comprovantes e escopo

Recibo contém ID/data/operador técnicos, pagamento, estado atual, itens/título histórico quando disponível, quantidade, preço e total originais. Não consulta nem imprime CPF, nome, contato ou endereço do cliente. A listagem retorna resumos; itens completos somente na consulta individual, evitando respostas excessivas. Não há geração pública de documentos ou compartilhamento automático.

Limites permanecem: 2.000 eventos no diário, 5.000 logs, catálogo e tabelas com os limites anteriores. Recusa explícita ao atingir capacidade, sem truncar histórico. Compactação, retenção e restauração real continuam pendentes. Vendas v1 de ensaio técnico não aparecem no histórico comercial nem podem ser estornadas por esta interface.

## API

- `GET /api/v1/operations/list?from=<ISO UTC>&to=<ISO UTC>&offset=0`: período inclusivo até 366 dias; escopo de operador aplicado no servidor.
- `GET /api/v1/operations/get?id=<UUID>`: comprovante autorizado.
- `POST /api/v1/operations/adjust`: `{commandId,id,expectedVersion,newStock,reason}`.
- `POST /api/v1/operations/reverse`: `{commandId,saleId,reason}`.

Escritas requerem JSON de origem exata, CSRF vinculado à sessão e corpo até 2.000 bytes. Não aceitam papel, valor, itens ou identidade do operador fornecidos pelo cliente. Leituras de comprovantes/listagens também geram auditoria.

## Ativação posterior

Nada foi ativado no Google. Atualizar o lote completo de scripts, incluindo **Operations.gs**, **Customers.gs** e **Staff.gs**, preservando propriedades e recursos. Sem nova aba, migração ou escopo OAuth. Novas flags, desligadas por padrão: Netlify DEV `WORKSPACE_OPERATIONS_ENABLED`; Apps Script DEV `OPERATIONS_ENABLED`. Dependem do catálogo e das sessões existentes.

Somente homologar/ativar na etapa Google posterior, com contas autorizadas e testes de recuperação. Não instalar Sales.gs novo sem o arquivo Operations.gs correspondente. Não ajustar linhas manualmente para substituir eventos.
