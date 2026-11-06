# Reconexão da auditoria — DEV

Este incremento protege a consulta administrativa de auditoria, os detalhes e a exportação Excel contra mudanças de conexão, conta e filtros. O histórico permanece somente para consulta: não há alteração, exclusão ou compactação de registros neste lote.

## Visualização e contexto

Queda de conexão, ocultação/saída da página, recusa de acesso ou conta diferente remove registros, detalhes abertos, contagens, opções de responsáveis/operações/resultados e identificadores de produto/venda da tela. URLs temporárias são revogadas. A conta originalmente vinculada à página não é trocada silenciosamente.

A requisição de sessão passa a ter o mesmo timeout de 30 segundos das consultas/arquivos. Antes de consultar e antes de mostrar uma resposta, a página confere a mesma conta administrativa e o contexto. Mudança de rede/visibilidade ou alteração dos filtros durante a consulta descarta o resultado anterior. O download também confere contexto e acesso depois de receber o arquivo e antes de criar o link.

Abrir a página online continua fazendo a consulta inicial, como antes. Depois de uma desconexão, voltar à página ou restaurá-la do histórico apenas confere acesso: é preciso atualizar a consulta explicitamente. Foco e a checagem de sessão de 60 segundos não consultam registros nem exportam em segundo plano. A checagem periódica não apaga o aviso de encerramento da visualização local.

A paginação continua vinculada ao snapshot do histórico. Se novos registros mudaram a origem, o servidor recusa misturar páginas; a tela remove o resultado anterior e exige atualizar. Filtros e limites anteriores permanecem: até um ano na consulta, Excel completo de até 500 registros e 30 mil campos de detalhes, sem truncamento silencioso.

## Exportação pendente

Antes do POST, a página fixa commandId, filtros e snapshot. Uma resposta perdida conserva a referência em memória enquanto remove os dados da visualização. **Conferir / tentar novamente** primeiro verifica a mesma conta administrativa; só então repete o pedido original, se aceito pelas regras do servidor. Reconectar não baixa o arquivo automaticamente.

Uma autorização pode já estar registrada mesmo se o arquivo não chegou ao navegador. O servidor continua verificando ator, filtros e snapshot e recuperando a exportação anterior conforme o contrato idempotente, sem duplicar seu registro. Arquivo preparado não comprova gravação final no disco.

**Descartar referência e consultar novamente** limpa somente a referência local, quando não há requisição em andamento. Não cancela nem remove uma autorização já registrada. Outra consulta e exportação deliberadas usam uma nova chave e geram outra autorização, preservando as anteriores.

Sessão recusada, perda de papel ou outra conta não apagam automaticamente a referência pendente. É necessário recuperar o acesso permitido da mesma conta, descartar explicitamente ou aguardar o encerramento local. Alteração de fonte, referência conflitante ou pedido inválido exige nova consulta; não se fabrica outro comando para esconder a falha.

## Retenção local e autenticação

Após cada consulta bem-sucedida, a tela mantém visualização e eventual referência pendente por até **cinco minutos**, usando um timer local. Ao terminar o prazo, limpa ambos, sem exportar e sem apagar auditoria. Checagens de sessão não renovam esse timer.

Este prazo é uma proteção de memória e visualização do navegador. **Não é um novo prazo de validade de snapshot no backend**, nem substitui a autenticação administrativa recente, o papel e as validações de origem. Não altera o contrato da auditoria para usar a prova de prévia dos relatórios comerciais. Uma nova autenticação pode mudar o histórico e exigir atualizar a consulta, conforme a resposta do servidor.

Não há novo localStorage/sessionStorage/IndexedDB ou arquivo de recuperação. Referência e filtros permanecem apenas na memória da página até confirmação, descarte ou encerramento local. **Mantenha a aba aberta enquanto houver exportação pendente.** O aviso de saída depende do navegador e não garante recuperação após recarga, fechamento, limpeza ou troca de aparelho. Uma restauração de histórico pode preservar memória, mas exige reconferência e não é backup. Arquivos já baixados não são removidos pela aplicação.

## Escopo

HTML/CSS/controller, testes e documentação. Nenhuma mudança de backend, schema, flag, segredo, dependência, Google real, home dos perfis ou produção. Continuam a anonimização das negativas, omissão de dados protegidos, valores anteriores/posteriores, autorização de exportação antes dos dados e proteção do Excel. O v17 continua em andamento. [QA e limitações](QA_RECONEXAO_AUDITORIA.md).
