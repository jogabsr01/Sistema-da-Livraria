# Reconexão dos nichos — DEV

A gestão de nichos passa a exigir conferência recente da mesma conta administrativa antes de novas alterações. Sessão e consultas têm timeout de 30 segundos. Reconexão, foco, retorno à página e conferência manual atualizam somente leituras; não reenviam gravações. A leitura é renovada a cada 60 segundos quando possível e deixa de liberar novas gravações após 90 segundos. Permissões, versão e unicidade continuam sendo validadas pelo servidor.

## Rascunho, imagens e revisões

Queda de conexão, ocultação ou saída da página invalidam respostas antigas e removem os cards da lista. O formulário e a prévia ficam ocultos até conferir o acesso novamente. O rascunho não enviado permanece nos campos em memória na mesma aba, incluindo a imagem já preparada. Isso é ocultação visual, não apagamento dos valores do DOM. Sessão recusada, outra conta ou perda do papel administrativo limpam campos, lista e prévia, removem a imagem local preparada e fecham o editor. A conta originalmente vinculada à página não é substituída.

O processamento assíncrono de uma imagem verifica o contexto depois de decodificar o arquivo. Uma imagem que terminou de preparar após queda ou mudança de contexto não restaura a prévia nem é incluída silenciosamente no pedido seguinte. O operador pode selecioná-la novamente após conferir o acesso.

Ao reconectar com um nicho existente aberto, a página compara a revisão atual com a revisão que originou o rascunho. Uma diferença bloqueia novas gravações e preserva os campos locais. **Descartar rascunho e abrir versão atual** substitui os campos e a prévia pela versão consultada somente por ação explícita.

## Pedido com resposta incerta

Antes de enviar, a página fixa commandId, identificador, revisão, campos e imagem ou remoção de imagem. Uma resposta perdida conserva esse conteúdo em memória. **Conferir / tentar novamente** e **Conferir pedido pendente** verificam a mesma conta administrativa antes de repetir o pedido original. Não há nova chave silenciosa nem reenvio automático ao reconectar. O backend existente reconhece repetições e preserva o efeito único.

O aviso genérico de pendência fica fora do editor e continua acessível quando uma recusa de sessão limpa os campos privados. Uma recusa posterior não descarta silenciosamente um pedido já incerto. Uma rejeição semântica conclusiva na primeira tentativa, como nome duplicado ou revisão conflitante, libera os campos para correção. Depois de uma gravação confirmada, uma falha apenas na atualização da lista é apresentada separadamente, sem tornar o salvamento incerto.

Não há nova persistência em localStorage, sessionStorage ou IndexedDB, fila offline, autosave ou descarte automático por prazo de pedidos incertos. **Mantenha a aba aberta enquanto houver pedido pendente.** O aviso de saída depende do navegador; não há garantia de recuperação após recarga, fechamento, limpeza ou troca de aparelho. Restauração do histórico exige reconferência e não substitui backup.

## Escopo

Somente controller, HTML/CSS, testes, script de execução e documentação. Sem alteração de backend, schema, flag, segredo, dependência, instalação Google, home dos perfis ou produção. Desativar nichos continua preservando livros e vínculos existentes. O v17 permanece em andamento. [Validação](QA_RECONEXAO_NICHOS.md).
