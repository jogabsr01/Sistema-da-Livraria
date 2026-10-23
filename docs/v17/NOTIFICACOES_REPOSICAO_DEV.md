# Notificações e lista de reposição por fornecedor

Incremento solicitado e autorizado para publicação em DEV em 23/10/2026, a partir do PR #19 integrado (`dc0c5996393e425fc87643088caafe8abaefddd8`). A central `/notificacoes-dev.html` usa o estoque compartilhado e prepara um relatório administrativo; não envia mensagens nem realiza compras.

## Uso

1. Abrir o sino **Notificações** no Catálogo, Caixa ou Minha conta. O contador indica alertas pendentes ainda não lidos pela conta atual.
2. Consultar livro, saldo, mínimo, prioridade e estado. **Marcar como lida** é pessoal e não resolve a falta. ADMIN/SUPER_ADMIN podem marcar **Em atendimento** ou voltar para aberta. Todos os perfis operacionais podem abrir o cadastro e a entrada de unidades autorizada.
3. Como administrador, gerar **Somente sem estoque**, ou incluir também **Abaixo do mínimo**. Selecionar todos os fornecedores, um fornecedor ou os livros sem fornecedor informado.
4. Conferir título e fornecedor lado a lado, ISBN/código, saldo, mínimo, quantidade sugerida e acompanhamento. Os livros são agrupados por fornecedor; a central alerta sobre cadastros incompletos.
5. Baixar **CSV para Excel**, imprimir/salvar PDF pelo navegador ou preparar texto para revisar/copiar e encaminhar manualmente. Cada ação confere novamente o estoque no servidor e gera auditoria. Nenhuma API de e-mail, WhatsApp ou compra é chamada.
6. Ao receber os livros, usar **Adicionar unidades** no mesmo cadastro. O alerta é resolvido quando o saldo deixa a condição de falta; se passar de zero para saldo ainda baixo, a ocorrência de zero é encerrada e fica um alerta de estoque baixo. Desativar o livro também encerra seu alerta de estoque.

Livro esgotado permanece ativo/editável. Nenhum alerta exclui cadastros. Somente administradores continuam podendo excluir logicamente ou reativar livros.

## Como a sugestão funciona

`quantidade = max(1, estoque mínimo − saldo atual)`, apenas para livros ativos zerados ou abaixo do mínimo no filtro escolhido. Se não há mínimo definido e o saldo é zero, uma unidade é sugerida para revisão. Isso não é previsão de vendas, custo de compra, quantidade confirmada ou pedido emitido. Preço de venda não é usado como custo do fornecedor.

Fornecedor vazio fica destacado como **Fornecedor não informado**. Agrupamento desconsidera diferença de maiúsculas e espaços repetidos; o cadastro continua sendo a fonte do nome. Livros com estoque suficiente ou excluídos não entram na lista. O relatório contém todos os livros do filtro, independentemente da paginação dos alertas.

## Alertas, histórico e recuperação

- Uma ocorrência ativa por produto/condição. Atualizações repetidas não duplicam alertas. Passar de estoque baixo para zero cria um novo alerta de alta prioridade, ainda não lido, mesmo que o anterior tenha sido lido. Nova falta após reposição também gera uma ocorrência nova.
- Leituras ficam em `Notificacoes_Usuarios`, vinculadas ao usuário resolvido pela sessão. Não é aceito escolher outro usuário no corpo do pedido.
- Estados globais usam um comando administrativo auditado antes da projeção. Repetir a mesma chave após falha recupera o resultado sem duplicar comandos. Reaplicar comandos antigos nunca reabre alertas já resolvidos pelo estoque.
- Criação/resolução têm IDs de auditoria determinísticos. Falha após escrever a notificação, mas antes da auditoria, é reparada na próxima recuperação. O processamento ocorre sob o mesmo ScriptLock das vendas/entradas.
- Mudanças de filtro durante uma atualização não são perdidas. O sino atualiza após gravações confirmadas e também por foco/intervalo; a central atualiza por foco/conexão e a cada minuto enquanto visível.
- O histórico começa com o módulo habilitado. Livros ativos já zerados entram na primeira reconciliação; não se inventa a data de um esgotamento anterior. **Alerta desde** indica a criação da ocorrência, não uma promessa de histórico retroativo.

## Acesso e exportação

Toda rota valida sessão no Node e novamente dentro do lock Google. O domínio é exclusivamente DEV; mutações e relatórios exigem Origin exato/CSRF. Atendentes consultam alertas e marcam sua leitura; não acessam o relatório nem alteram o estado global. ADMIN/SUPER_ADMIN gerenciam atendimento. Relatórios/exportações exigem autenticação forte de até cinco minutos; se necessário, sair/entrar novamente com passkey.

O relatório usa um snapshot consistente do filtro sob o lock. Cada geração/exportação registra usuário, momento, filtro, formato e contagens. A tela usa texto simples e CSP restrita; o CSV é UTF-8 com BOM, delimitado por ponto e vírgula, com aspas e proteção contra fórmulas. Códigos longos são tratados como texto. PDF é a impressão do navegador, não um documento fiscal. Texto preparado não procura contatos nem envia mensagens.

Cada exportação reconstrói a lista atual, podendo diferir de uma visualização anterior após reposição ou edição. Conferir o horário impresso. Os dados não são guardados em localStorage/sessionStorage nem publicados no Drive. Não há CPF, cliente, PIN, cookie ou token no relatório.

## API e ativação privada

- `GET /api/v1/notifications/summary`: pendentes/não lidas da conta.
- `GET /api/v1/notifications/list?offset=0&history=false`: páginas de 25 alertas; `history=true` inclui resolvidos.
- `POST /api/v1/notifications/read`: `{ "id": "UUID-do-alerta" }`.
- `POST /api/v1/notifications/state`: `{ "commandId": "UUID-do-comando", "id": "UUID-do-alerta", "state": "EM_ATENDIMENTO" }`, ou `ABERTA`.
- `POST /api/v1/notifications/report`: `{ "scope": "zero", "supplier": null, "format": "view" }`. Scope `low` inclui abaixo do mínimo; supplier `null` seleciona todos, `""` só não informados, texto filtra fornecedor. Formatos `view`, `csv`, `print`, `copy` são auditados; a API devolve dados validados, e a tela prepara a saída.

Flags próprias, **desligadas por padrão**: `WORKSPACE_NOTIFICATIONS_ENABLED` no Netlify/Functions DEV e `NOTIFICATIONS_ENABLED` nas Script Properties Google DEV. Dependem de backend, catálogo e sessões previamente homologados. Não habilitar somente pelo sucesso do build.

O proprietário precisa atualizar **em lote todos os arquivos Google**, agora incluindo **Notifications.gs** e versões compatíveis de Sales.gs/Catalog.gs/Code.gs/Stock.gs. Fazer backup antes, preservar propriedades/recursos DEV e implantar nova versão. Não há nova aba, migração de cabeçalhos, escopo OAuth ou chave privada: são usadas as abas de notificações/leitura/auditoria já existentes no schema v1. Nenhuma instalação Google, envio real ou mudança de flags privadas foi feita nesta rodada.

Homologar com dados fictícios em duas contas/aparelhos: alerta pessoal, escalada baixo→zero, atendimento administrativo, permissão negada a atendente, fornecedores diferentes/ausente, relatório/exportação completos, reposição e nova falta sem duplicatas. Comparar contagens, títulos, fornecedor, saldo e auditoria no Google real.

## Limites e próximos avanços úteis

Capacidade explícita de 5.000 alertas, 5.000 leituras e 5.000 auditorias compartilhadas com os demais módulos. Ao atingir limites, a operação é recusada; não se entrega relatório truncado. O relatório tem orçamento de 3,5 milhões de caracteres Base64 e transporte limitado a 4 MB. Se uma lista muito extensa ultrapassar esse orçamento, filtrar por fornecedor; limite de auditoria exige manutenção/compactação, não é resolvido pelo filtro. Retenção, arquivamento e quotas Google precisam de homologação antes de uso amplo.

Esta primeira central admite apenas alertas de estoque. Outros tipos (escalas, sincronização, gestão), resolução manual por justificativa, responsável nominal, contatos de fornecedores e pedidos ainda não foram implementados. Os dados Google/Drive/Mail dos testes são emulados; build e merge não equivalem à ativação real.

Próximo avanço para compras: pedidos por fornecedor com estados rascunho/enviado/recebido parcialmente/concluído, vinculação das entradas ao pedido para evitar compras repetidas e acompanhamento de prazo. Depois, sugestão baseada em consumo e prazo de entrega, quando houver histórico confiável e custo de compra cadastrado separadamente. Nenhum pedido/enviado foi simulado como funcional nesta entrega.
