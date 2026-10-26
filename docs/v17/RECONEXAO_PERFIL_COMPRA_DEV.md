# Reconexão do perfil de compra — DEV

Este lote protege a consulta individual de compras, sugestões e preparação manual de texto quando há desconexão ou mudança de contexto. Não muda os critérios consultivos do PR #31 nem ativa envio de WhatsApp, e-mail ou outro canal.

## Dados pessoais e contexto

Queda de conexão, ocultação/saída da página, recusa de acesso ou outra conta remove CPF, nome, histórico, indicadores, sugestões, seleção e texto da tela. A conta originalmente vinculada à página não é substituída. O texto preparado conhecido também é removido: não é restaurado automaticamente ao reconectar.

Sessão e requisições têm timeout de 30 segundos. Consulta captura o CPF antes de aguardar a sessão e confere contexto antes da busca, antes de consultar o histórico e antes de mostrar o resultado. Mudança de CPF, seleção, visibilidade, conexão ou conta impede publicar a resposta anterior. Retirar o papel administrativo durante a requisição também limpa a visualização.

Reconexão, retorno/foco, restauração da página, botão de conferência e checagem de sessão de 60 segundos validam acesso, mas não consultam outro cliente nem preparam/copiam texto automaticamente. Abertura offline pode retomar somente o acesso ao voltar a rede. Uma consulta de cliente sempre exige ação do operador.

## Preparação com resultado incerto

Antes do envio ao backend, a página fixa commandId, cliente, livros selecionados, snapshot, prova e prazo da consulta. Se a resposta se perder, conserva essa referência em memória e mostra **Conferir preparação** fora da visualização privada. Outros pedidos ficam bloqueados até conferir, descartar explicitamente ou vencer o prazo.

A conferência verifica a mesma conta administrativa e usa o pedido original, sem trocar a chave nem duplicar a preparação auditada quando válida. O texto recuperado aparece em uma área própria; o histórico, nome e indicadores já limpos não são restaurados junto. Consultá-los de novo exige nova busca do cliente. Recuperar texto não é prova de envio a uma pessoa.

**Descartar referência e consultar novamente** remove somente a referência local. Uma preparação anterior pode já estar na auditoria; não é apagada. Uma nova consulta e preparação deliberadas usam nova chave e podem registrar outra preparação. Sessão recusada ou outra conta não descarta silenciosamente o pedido incerto.

## Consentimento e cópia

Preparar, conferir ou copiar continua solicitando validação ao backend. Preferência WhatsApp, consentimento, disponibilidade dos livros, fonte e autenticação administrativa recente precisam continuar válidos. Fonte alterada, consentimento recusado, prova inválida ou consulta vencida removem a referência/texto e exigem nova consulta; não se usa texto anterior como fallback.

Uma resposta atrasada que já perdeu seu contexto não exibe texto nem inicia solicitação de cópia. O contexto também é conferido depois de aguardar o clipboard, para não restaurar mensagens de sucesso ou seleção em uma tela que já foi limpa. A página não consegue cancelar ou reverter uma solicitação de clipboard já aceita pelo navegador, apagar texto já copiado ou desfazer um envio manual externo.

**Nada é enviado automaticamente.** O operador deve revisar o texto e escolher o contato autorizado. O texto continua sem CPF, telefone, e-mail ou detalhes do histórico de compras. A preparação não reserva estoque nem confirma uma venda.

## Prazo, persistência e escopo

O `expiresAt` existente da consulta, de até cinco minutos, também passa a remover automaticamente dados privados, texto e referência pendente da página. Preparar/copiar e checar sessão não renovam esse prazo. O timer local não substitui nem estende a prova vinculada pelo backend ao usuário, sessão, versão, cliente e fonte. Uma nova autenticação pode exigir outra consulta; não se promete retomar a mesma referência em uma nova sessão.

Referência, prova e identificadores ficam somente na memória da página. Não há novo localStorage/sessionStorage/IndexedDB, fila offline ou autosave. **Mantenha a aba aberta enquanto houver preparação pendente.** O aviso de saída depende do navegador e não garante recuperação após recarga, fechamento, limpeza ou troca de aparelho. Restauração do histórico pode preservar memória, mas limpa a visualização e exige reconferência; não é backup.

Somente controller/HTML/CSS, testes e documentação. Sem mudança de backend, schema, flag, segredo, dependência ou Google real. Permanecem a criptografia, as permissões administrativas e a auditoria do contrato anterior. Publicação exclusiva DEV, sem alterar produção ou a home dos perfis. O v17 continua em andamento. [Validação](QA_RECONEXAO_PERFIL_COMPRA.md).
