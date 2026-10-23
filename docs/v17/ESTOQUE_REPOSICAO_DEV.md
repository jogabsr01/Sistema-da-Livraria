# Livro esgotado, edição, reposição e exclusão administrativa

Regras solicitadas em 23/10/2026, após autorização para publicar o PR #18 e continuar a publicação em DEV.

## Regras entregues

- Saldo zero **não exclui nem desativa** o livro. Ele continua no catálogo, com ISBN/código, preço, foto, nichos e histórico preservados.
- Sem estoque **não há venda**. A tela bloqueia adicionar unidades indisponíveis e avançar com quantidade superior ao saldo. O servidor confirma novamente estoque/preço sob o lock, inclusive diante de venda concorrente. Verificar uma venda pendente continua permitido para recuperar um resultado já registrado.
- A edição permanece disponível, inclusive após vendas e com saldo zero. Editar título, preço, capa ou metadados não altera a quantidade.
- **Adicionar unidades** recebe quantidade positiva e motivo, soma ao saldo e registra operador, movimentação e auditoria, sem criar outro livro.
- Somente **ADMIN/SUPER_ADMIN** excluem/desativam ou reativam. Exclusão é lógica: retira do catálogo ativo e preserva registro/histórico. Atendentes podem editar metadados e receber estoque, conforme as permissões V17. Alterar `active` por save forjado também é recusado no servidor.
- Reposição não reativa um livro excluído: primeiro um administrador precisa reativá-lo.

O protótipo também deixa de oferecer exceção para estoque negativo. O transporte de demonstração ignora qualquer flag antiga de override, soma linhas repetidas antes da validação e recusa compras insuficientes. A interface impede avançar com carrinho incompatível. A demonstração continua local; seu PIN não autoriza o backend Google.

## Recuperação e integridade

`catalog.receive` usa `commandId` UUID, produto, versão esperada, quantidade positiva e motivo. O evento `STOCK_RECEIVED` é anexado antes de movimento, auditoria e estoque/versão. Repetir o mesmo comando pelo mesmo operador retorna o recibo original mesmo após edições posteriores; mudar quantidade/motivo/operador reutilizando a chave é recusado.

A aba guarda somente essa referência técnica de entrada, em chave separada por conta. Campos ficam bloqueados enquanto o resultado for incerto. Após recarga, **Verificar entrada pendente** recupera o comando original. Falta de espaço local impede o primeiro envio. Não são guardados cookies, PINs, tokens ou dados de clientes. A referência não autoriza operações: a sessão atual é conferida novamente.

Fechar/apagar a aba ou trocar de aparelho não garante recuperar a referência. Não repetir uma entrada incerta com outra chave sem reconciliar as movimentações. Consulta operacional e reconciliação entre aparelhos continuam pendentes antes do uso real.

O projetor combina vendas/entradas com checkpoints validados das edições concluídas no journal privado. Cada passo exige versão consecutiva e saldo compatível. Metadados conservam o saldo; a recuperação não pode fabricar uma edição incompleta, restaurar título/capa antigos nem apagar uma entrada. Histórico/projeção corrompido recusa novas escritas. Edição ou entrada com versão antiga exige carregar o estado atual. Colisões de IDs entre módulos são recusadas antes do intent.

## API

`POST /api/v1/catalog/receive`, sessão verificada e `stock.receive`, Origin/CSRF DEV:

```json
{ "commandId": "UUID-v4-da-entrada", "id": "UUID-v4-do-produto", "expectedVersion": 3, "quantity": 5, "reason": "REPOSICAO" }
```

Recibo: `commandId`, `id`, `quantity`, `version`, `stockBefore`, `stockAfter`, `createdAt` UTC. Quantidade inteira de 1 a 1.000.000; saldo máximo 1.000.000. Corpo limitado a 2.000 bytes. Não aceita papel, identidade ou saldo substituto.

`POST /api/v1/catalog/remove`, sessão administrativa forte, `products.delete`, Origin/CSRF:

```json
{ "commandId": "UUID-v4-da-exclusao", "id": "UUID-v4-do-produto", "expectedVersion": 4 }
```

Retorna ID e versão confirmada. Exclusão usa o journal recuperável de catálogo e auditoria de atualização de produto; snapshots anteriores/posteriores guardam ativo/inativo. Reenvio conserva o resultado. Não existe DELETE físico.

## Atualização privada Google

Publicação em DEV não atualiza Apps Script automaticamente. O proprietário precisa instalar **em lote todos os arquivos** de `google-apps-script`, incluindo o novo **Stock.gs** e versões compatíveis de Sales.gs, Catalog.gs e Code.gs. Não há nova aba, cabeçalho ou chave privada. As 17 abas mantêm schema v1; o journal existente passa a aceitar entradas v1 e vendas v1/v2. Eventos antigos não são reescritos.

Fazer backup antes, implantar nova versão do Apps Script e conferir o endpoint privado no Netlify. Preservar credenciais/recursos DEV. Não habilitar flags reais somente pelo sucesso do build. Catálogo/sessão continuam obrigatórios; vendas ainda dependem da flag de checkout. Nesta sessão não houve instalação nem homologação Google real.

Após concluir os pré-requisitos privados, homologar com dados fictícios: criar livro, entrada de duas unidades, vender ambas, confirmar bloqueio, editar título/preço/capa esgotados, adicionar três unidades e vender uma; saldo final dois no mesmo ID. Conferir outro aparelho, operadores, histórico, auditoria, resposta perdida, exclusão negada ao atendente e exclusão/reativação administrativas.

## Limites restantes

Entradas positivas implementadas; ajustes negativos, inventário físico, devolução/estorno, cancelamento, clientes identificados, consulta operacional, relatórios e notificações compartilhadas seguem pendentes. Capacidade: 2.000 eventos de inventário, 1.000 comandos de catálogo e 5.000 auditorias. Compactação versionada, retenção, proteção de tráfego e homologação de quotas são necessárias antes de uso amplo. Sheets não oferece transação ACID entre abas.

Testes locais usam Google/Drive/Mail emulados, identidades fictícias e Chromium. Não provam Google IAM real, hardware, Safari, cobrança bancária ou instalação privada. Resultados: [QA_ESTOQUE_REPOSICAO.md](QA_ESTOQUE_REPOSICAO.md).
