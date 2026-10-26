# Reconexão dos relatórios comerciais — DEV

Este incremento protege consultas de vendas, estoque e movimentações, detalhes e downloads Excel quando a conexão ou a conta muda. Não altera o contrato de cálculo/arquivo do PR #30 nem encerra a reconciliação dos demais módulos do v17.

## Dados exibidos e respostas atrasadas

Queda de conexão, ocultação/saída da página ou recusa da sessão remove resultados, indicadores, rankings, detalhes abertos, nomes das opções de atendentes/nichos e campos de CPF, cidade e identificadores pessoais. URLs temporárias de arquivo são revogadas. Não há resultado antigo como fallback de erro.

Reconectar confere a mesma conta administrativa e o CSRF, mas não refaz a consulta nem baixa arquivo automaticamente. Uma consulta precisa de nova ação do operador. Consulta/exportação tem checagem de contexto antes de enviar o pedido de negócio e antes de publicar seu resultado: uma resposta que atravessou queda, ocultação ou troca de conta não mostra dados nem cria link de download. Filtros alterados durante a consulta também impedem publicar a resposta anterior.

Sessão e requisições passam a ter timeout de 30 segundos. Foco, retorno da página, reconexão e o botão **Conferir conexão e acesso** validam novamente a conta. A checagem periódica de sessão continua a cada 60 segundos, sem consultar relatório ou exportar. Ela não apaga o aviso de autorização vencida. Perda do papel administrativo limpa a visualização; novo usuário não herda o contexto da conta anterior.

## Exportação com resultado incerto

Antes do envio, a página fixa commandId, filtros aplicados, snapshot, prova e vencimento da consulta. Se a resposta se perder, conserva essa referência em memória, enquanto os resultados são limpos. **Conferir / tentar novamente** primeiro valida a mesma conta; somente depois tenta recuperar o arquivo com o mesmo pedido e autorização, se ainda válidos. Não cria outra chave silenciosamente e não envia POST se a conferência da conta falhar.

A autorização no servidor já é idempotente e precede o retorno do arquivo. Portanto, uma resposta descartada ou um download não concluído pode ter uma autorização na auditoria. Conferir o mesmo pedido válido não duplica esse registro. Preparar o Excel não comprova que o navegador terminou de salvá-lo no disco.

**Descartar referência e consultar novamente** é uma ação explícita, disponível quando não há requisição em andamento. Limpa somente a referência desta página. Não cancela nem apaga uma autorização já registrada no servidor. Uma nova consulta e exportação explícitas recebem nova chave e nova autorização auditada.

## Vencimento e autenticação

O prazo existente de até **cinco minutos** vem do `expiresAt` da consulta. A página passa a remover automaticamente prévia, dados privados e referência pendente ao vencê-lo, sem tentar exportar e sem excluir auditoria. A prova no servidor continua sendo a autoridade: o timer local não estende validade, não concede acesso e pode encerrar a visualização antes em caso de divergência de relógio.

A prova continua vinculada ao usuário, sessão, versão de autorização, filtros e fonte. Se uma autenticação real emitir outra sessão, a prova anterior pode deixar de ser utilizável mesmo para o mesmo usuário. Fonte alterada, prova recusada ou expiração exigem nova consulta. Guardar a referência não contorna essas regras nem garante recuperar o arquivo após fazer login novamente.

## Persistência e limites

Referência, prova e filtros — que podem conter CPF digitado — ficam somente na memória desta página até confirmação, descarte ou vencimento. Não há novo localStorage, sessionStorage, IndexedDB, arquivo local de recuperação ou envio de filtros a outro serviço. CPF continua excluído do Excel e dos logs pelo contrato anterior.

**Mantenha a aba aberta enquanto houver exportação pendente.** O aviso de saída depende do navegador; não garante impedir recarga/fechamento nem recuperar a referência depois. Uma restauração do histórico pode preservar memória, mas exige nova validação e não é backup. Arquivos já baixados não podem ser removidos pela página.

Sem fila offline, reenvio automático ou consulta em segundo plano. Sem mudanças no backend, schema, flags, segredos, dependências, Google real, home dos perfis ou produção. Permanecem os limites completos do relatório, filtros, preços históricos, estornos registrados e proteção do Excel. [Validação e limitações](QA_RECONEXAO_RELATORIOS.md).
