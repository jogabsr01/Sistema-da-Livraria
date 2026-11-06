# Reconexão da equipe e dos clientes — DEV

Este lote protege os cadastros pessoais na gestão da equipe e no Caixa. A reconexão atualiza leituras, nunca reenvia uma gravação automaticamente. Toda gravação continua sendo autorizada pelo backend, com revisão, permissões, criptografia e auditoria já existentes.

## Equipe

Sessão e requisições têm timeout de 30 segundos. A lista exige a mesma conta administrativa antes e depois da consulta. Respostas anteriores a queda de conexão, ocultação ou saída da página não restauram a lista. Foco, retorno à página e conferência manual renovam as leituras; a checagem periódica ocorre a cada 60 segundos quando possível. Novas gravações ficam bloqueadas quando a consulta ultrapassa 90 segundos.

Offline ou página ocultada removem os cards e ocultam o formulário, preservando o rascunho nos campos em memória na mesma aba. Isso é proteção visual, não apagamento desses valores do DOM. Recusa de sessão, outra conta ou mudança de papel limpam o formulário e fecham o editor. Uma nova conferência não vincula a página silenciosamente a outra pessoa. As restrições entre administrador principal, administrador e atendente permanecem no servidor e na interface.

Ao conferir a lista com uma edição aberta, uma revisão diferente bloqueia o salvamento. **Descartar rascunho e abrir versão atual** substitui os campos somente por ação explícita. Se o cadastro não estiver mais na página consultada, a tela exige fechar o rascunho e localizar a pessoa na lista, sem tratar a ausência naquela página como exclusão do cadastro.

Antes do envio, a página fixa commandId, identificador, revisão, contatos, perfil, status e motivo. Uma resposta incerta conserva esse pedido original em memória. **Conferir e tentar novamente** ou **Conferir pedido pendente** validam a mesma conta antes de repetir o pedido, usando a idempotência existente. Alterar programaticamente os campos não muda o conteúdo já fixado. A saída da página não descarta mais silenciosamente a pendência enquanto a memória da aba for preservada.

Uma recusa posterior não descarta um pedido previamente incerto. Uma rejeição semântica conclusiva na primeira tentativa, como CPF inválido, contato duplicado ou revisão conflitante, libera o formulário para correção. Uma gravação confirmada continua salva se falhar apenas a atualização seguinte da lista.

## Clientes no Caixa

Cada busca, salvamento, leitura posterior ao salvamento e consulta opcional de CEP verifica a conta originalmente vinculada ao Caixa. Busca, leitura do cliente e CEP também conferem a sessão antes de exibir seus resultados. Mudança de CPF ou contexto impede publicar uma busca anterior. Mudança de CEP, conexão ou acesso impede preencher endereço com uma resposta antiga.

Queda, ocultação ou saída da página removem cliente selecionado, candidato, nome/CPF apresentados e CPF da busca. O formulário aberto fica oculto com o rascunho preservado na aba. Recusa de acesso ou outra conta também limpam os campos e fecham o editor. O editor conserva apenas identificador e revisão técnicos da edição; os dados consultados ficam no candidato/seleção e são removidos ao invalidar o contexto. O conteúdo de um pedido incerto precisa permanecer em memória para sua conferência.

Novos cadastros exigem a conferência válida de estoque e acesso do Caixa. Um cliente cuja seleção foi removida precisa ser buscado e selecionado novamente para uma nova venda identificada. Uma venda já pendente mantém somente a referência técnica de cliente em seu pedido original, conforme o fluxo anterior de recuperação de venda.

O pedido de cadastro fixa campos, consentimento, preferência, identificador, revisão e commandId. Uma resposta perdida não cria outro pedido. **Conferir cadastro pendente**, fora do editor, permite validar a mesma conta e conferir o pedido original depois de uma limpeza por acesso recusado. Reconectar não salva sozinho. **Nova compra** não pode descartar um cadastro pendente, inclusive quando acionada programaticamente.

Salvar o cadastro e carregar os dados para a compra são resultados distintos. Depois de salvamento confirmado, uma falha na leitura seguinte mostra **Cadastro salvo** e exige nova busca antes de selecionar. Não é criada uma pendência de gravação nem repetido o salvamento por falha apenas nessa leitura. Uma resposta privada atrasada não restaura a seleção. Revisão concorrente continua rejeitada pelo servidor: o rascunho fica disponível, e o operador deve fechar e buscar o CPF novamente antes de editar a versão atual.

A consulta BrasilAPI continua opcional e somente ao clique em **Preencher pelo CEP**. O backend mantém o envio apenas do CEP, conforme autorização anterior. Estes testes usam serviço emulado. Nenhuma mensagem de marketing é enviada; as validações de contato e consentimento permanecem.

## Memória, saída e escopo

Pedidos incertos e rascunhos ficam somente na memória da aba, sem nova persistência local, autosave ou fila offline. Não há descarte automático por prazo de uma gravação incerta. **Mantenha a aba aberta enquanto houver pedido pendente.** O aviso de saída depende do navegador; não há recuperação garantida após recarga, fechamento, limpeza ou troca de aparelho. Restauração do histórico pode preservar a memória, mas exige nova conferência e não substitui backup.

A persistência técnica já existente de uma venda pendente no sessionStorage foi preservada: ela não guarda nome, CPF, contato ou endereço. Este lote não adiciona persistência de cadastros pessoais.

Sem alteração de backend, schema, flag, segredo, dependência, instalação Google, home dos perfis ou produção. Integração somente DEV. O v17 permanece em andamento. [Validação](QA_RECONEXAO_PESSOAS.md).
