# Reconexão das escalas — DEV

O calendário exige conferência recente da mesma conta antes de criar, publicar, alterar ou cancelar uma escala. Sessão e requisições têm timeout de 30 segundos. Foco, retorno à página, reconexão e conferência manual atualizam somente leituras; não reenviam alterações automaticamente. A consulta é renovada a cada 60 segundos quando possível e perde a validade para novas gravações após 90 segundos. O servidor continua sendo a autoridade sobre sessão, papel, revisão e conflitos de horário.

## Rascunho e mudança de contexto

Queda de rede, página ocultada ou saída invalidam respostas anteriores e removem o calendário. O formulário fica oculto até validar novamente o acesso. Um rascunho ainda não enviado permanece nos campos em memória na mesma aba, para recuperação pela mesma conta; ocultação visual não é apagamento desses valores do DOM. Sessão recusada, troca de conta ou perda do papel administrativo limpam os campos privados, pessoas e calendário e fecham o editor. A página não se vincula silenciosamente a outra conta.

Reconectar preserva os valores locais, mas também consulta a revisão atual de uma escala existente. Se outro atendimento a alterou, salvar fica bloqueado. **Descartar rascunho e abrir versão atual** é uma ação explícita que substitui os campos locais pelos dados atuais. Funcionários continuam tendo somente acesso à própria escala publicada e histórico autorizado; rascunhos continuam administrativos.

## Alteração com resposta perdida

Antes de enviar, a página fixa operação, commandId, identificador, revisão e conteúdo. Após resposta perdida, mantém o pedido original em memória e bloqueia novos pedidos. **Conferir / tentar novamente** ou **Conferir pedido pendente** validam a mesma conta administrativa e repetem esse pedido, usando a idempotência existente do backend. Editar programaticamente os campos não altera o conteúdo já fixado. Reconectar não cria nova chave nem repete o POST sozinho.

O aviso genérico de pendência permanece fora do editor mesmo quando uma recusa de acesso limpa os campos privados. Uma recusa posterior não descarta silenciosamente um pedido que já estava incerto. Uma gravação confirmada continua sendo apresentada como salva quando falha apenas a atualização seguinte do calendário; essa falha não gera outro pedido de alteração.

Não há fila offline, autosave, nova persistência local nem descarte automático por prazo de uma gravação incerta. **Mantenha a aba aberta enquanto houver pedido pendente.** O aviso de saída depende do navegador e não garante recuperação após recarga, fechamento, limpeza ou troca de aparelho. Restauração do histórico exige nova conferência e não substitui backup.

## Escopo

HTML, CSS, controller, testes e documentação. Sem alteração de backend, schema, flag, segredo, dependência, instalação Google ou home de perfis. Publicação exclusiva DEV; v17 permanece em andamento. [Validação e contagem de testes](QA_RECONEXAO_ESCALAS.md).
