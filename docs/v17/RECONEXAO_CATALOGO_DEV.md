# Reconexão do Catálogo e reposição — DEV

Este lote amplia a proteção do Caixa (PR #34) para o Catálogo compartilhado, edição de livros, fotos, entrada de unidades e exclusão lógica. A pendência de reconciliação/offline do v17 continua aberta nos demais módulos e na homologação real.

## Conexão e formulário

Há uma faixa de estado na lista e nos dois diálogos. Sem conexão informada pelo navegador, nenhuma gravação é enviada. Novos pedidos exigem conferência recente de sessão, nichos e lista; uma leitura parcial ou resposta que atravessou uma queda/retorno/ocultação não libera a tela. `navigator.onLine` é apenas um sinal negativo: a liberação depende também das respostas do servidor.

Ao reconectar, a página atualiza a sessão da mesma conta, o CSRF e o catálogo. Confere novamente em foco, retorno à aba, restauração da página e a cada 30 segundos enquanto visível. A conferência perde validade após 90 segundos pelo relógio monotônico. Consultas têm timeout de 25 segundos por requisição. Uma reconexão ocorrida durante outra operação agenda uma nova leitura ao final, sem reenviar uma gravação.

O formulário aberto não é recarregado com o produto do servidor. Texto, preço, fornecedor, edição e foto preparada continuam disponíveis nesta aba. Leituras de reconciliação não bloqueiam os campos de um rascunho ainda não enviado; novos salvamentos ficam bloqueados até a conferência. O botão **Conferir conexão sem fechar** permite atualizar sem sair do diálogo.

Uma edição feita por outro atendimento aparece na lista, mas não substitui silenciosamente o rascunho local. Ao salvar com versão antiga, o servidor recusa o conflito e o operador pode carregar explicitamente a versão mais recente. O estado de conexão não é reserva de estoque nem autorização: papel, versão, sessão, preço e saldo continuam validados no servidor sob os locks existentes. Cada reconciliação e gravação acrescenta uma leitura de sessão; quotas e latência Google precisam de homologação.

## Resultado incerto de um salvamento

Antes do envio, a página fixa o comando, produto, versão esperada, campos e eventual foto em uma cópia em memória. Se houver falha de resposta, mantém essa cópia e bloqueia a edição, o fechamento normal e o Escape do diálogo. O botão muda para **Verificar cadastro / tentar novamente**. Nem reconexão nem atualização da lista reenvia esse pedido.

A conferência explícita usa exatamente a mesma chave e conteúdo, mesmo se alguém alterar os valores do DOM. A foto original do pedido é reutilizada, evitando novo arquivo após resposta perdida. Não há armazenamento novo de campos ou base64 em localStorage, sessionStorage, IndexedDB, Drive ou e-mail; a foto só segue ao backend pelo salvamento explícito existente. O backend continua validando/reencodificando a imagem e mantendo o arquivo privado.

Uma primeira resposta de rejeição conhecida (validação, tamanho da foto, duplicidade, conflito ou permissão) permite corrigir o formulário. Se já existia uma resposta incerta anterior, uma rejeição posterior não apaga automaticamente o pedido: ele pode já ter sido aplicado. Conta diferente ou sessão recusada não pode reenviar o comando e não libera sua edição. É preciso recuperar o acesso da mesma conta; situações que continuem inconsistentes exigem análise administrativa, sem apagar journals.

**Limite:** rascunho, salvamento pendente e exclusão pendente ficam somente na memória desta página. Mantenha a aba aberta. O aviso de saída depende das regras do navegador e não garante impedir recarga/fechamento. Não se promete recuperar esses pedidos após recarregar, fechar, limpar dados ou trocar de aparelho. Não há fila offline, autosave ou reenvio em segundo plano. Uma restauração que preserve a página em memória exige reconferência, mas não é backup.

## Entrada de unidades e exclusão

A reposição mantém o protocolo já existente: comando técnico em `catalog.stock.pending.<usuário>` no sessionStorage da mesma aba, sem dados pessoais, com quantidade, motivo, produto e versão originais. Offline, o submit nem cria esse comando. Depois de uma falha, a conferência explícita pode funcionar mesmo com a lista desatualizada, pois um resultado já aplicado precisa ser recuperado. Antes do POST, a sessão da mesma conta é conferida novamente; uma negativa preserva a referência e não envia a entrada.

Recarga na mesma aba continua permitindo retomar a entrada, conforme o contrato anterior; fechar/limpar a aba não oferece essa garantia. Uma quantidade já registrada não é somada novamente. A reposição continua usando o mesmo ID de livro e não reativa um cadastro inativo.

Uma exclusão lógica com resposta perdida ganha **Verificar exclusão pendente**, que usa o pedido original mesmo se o livro já desapareceu da lista ativa. Outras mutações ficam bloqueadas enquanto esse resultado estiver incerto. Só ADMIN/SUPER_ADMIN continuam autorizados; papel é relido e a operação continua protegida pelo backend. Não há exclusão física nem remoção de histórico.

## Escopo

HTML/CSS/controller do Catálogo, testes e documentação. Sem nova flag, tabela, segredo, dependência, migração ou permissão Google. A origem DEV e as flags existentes continuam obrigatórias. O protótipo da home não foi alterado. Produção e configuração Google real permanecem para depois, conforme solicitado.

Outros módulos, backup/restauração, rotação de chaves, recuperação administrativa de identidade e homologação continuam na lista original do v17. [Evidências e limitações](QA_RECONEXAO_CATALOGO.md).
