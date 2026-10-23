# QA — Operações administrativas e CEP

Evidências locais de 23/10/2026. Google/Drive/MailApp e BrasilAPI emulados. Não houve venda real, devolução bancária, envio real de dados pessoais ou alteração de flags privadas.

- Backend: 224 cenários em Node 24.19.0 e 22.23.4. Nove cenários novos agrupados de operações e três de CEP.
- Browser: operações (6), clientes/CEP (8), Caixa (10), estoque (5), notificações (7) e catálogo (6): 42 cenários.
- Build público, sintaxe de JavaScript, `git diff --check`; captura móvel `work/qa-operations/operacoes-celular.png` inspecionada.

Operações: correção positiva/negativa com piso zero e versão; convivência com entradas/vendas/edições; estorno integral uma única vez; corrida entre cancelamentos; sessão administrativa recente; proibição de atendente, leitura limitada às próprias vendas; CSRF/origem; período até um ano; valores de recibo validados; histórico original preservado, livro inativo preservado, título/preço histórico após edição; estado CANCELADA no reenvio do Caixa; última compra recuperada ou apagada após cancelar a única compra.

Injeções de falha antes/depois de diário, venda/status, movimento, auditoria, produto e última compra. Dois produtos no mesmo estorno; replay com a flag de novas operações desligada; nova chave não devolve novamente as unidades. Corrupção de quantidade, valor, referência de venda ou checkpoint impede mutações subsequentes. Ajustes negativos têm testes de falha próprios, além do estorno positivo.

Browser: celular/desktop, saldo absoluto, motivo obrigatório, confirmação do operador, formulário bloqueado em resultado incerto, mesmo comando no reenvio, atendente sem controles administrativos, Escape, visão de impressão sem navegação e preservação dos valores. A função imprimir foi interceptada no teste e o CSS de impressão inspecionado; não comprova impressora física nem arquivo PDF gerado.

CEP: consulta somente ao clique; somente CEP no endereço fixo do provedor, sem headers do usuário ou redirect; CEP inválido, texto ativo/fórmula, UTF-8 inválido, resposta grande e CEP/UF divergentes recusados; limite persistente e CSRF; não consulta ao digitar; falha preserva endereço manual; não altera nome/número/contatos.

Pendências gerais: IAM, quotas/latência reais do Apps Script, aparelhos/passkeys físicos, BrasilAPI real, testes Google multiusuário, backups/restauração e aceite do proprietário. Estorno parcial e integração bancária não foram implementados.
