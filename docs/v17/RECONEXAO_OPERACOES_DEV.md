# Reconexão de ajustes, estornos e comprovantes — DEV

Este incremento amplia o tratamento de desconexão para Operações. Caixa e Catálogo já possuem seus contratos nos PRs #34 e #35. A área de reconciliação do v17 continua parcial: outros módulos e homologação com Google/aparelhos reais permanecem pendentes.

## Antes de uma operação

A lista e os dois diálogos mostram o estado da conexão. Sem rede informada pelo navegador, submit não cria pedido nem envia POST. Novas operações exigem sessão da mesma conta, histórico conferido e a leitura recente do produto/comprovante aberto. Cada consulta e gravação continua passando pela autorização do backend; papel, sessão, CSRF, versão, estoque e acesso administrativo recente não são substituídos por estado do navegador.

A página reconfere no retorno da rede, foco, volta à aba, restauração da página e pelo botão **Conferir conexão sem fechar**. Respostas iniciadas antes de queda/retorno/ocultação não liberam novas operações. Uma reconexão durante outra requisição agenda uma nova leitura ao final, sem reenviar gravações. Há timeout de 25 segundos por requisição e validade de 90 segundos pelo relógio monotônico para a conferência. Uma sessão recusada ou de outra conta preserva o pedido pendente e bloqueia seu envio. Perda do papel administrativo antes do envio é relida e impede o POST.

As consultas de operações geram auditoria no servidor. Por isso **não há polling periódico**: o vencimento de 90 segundos apenas bloqueia ações até uma nova consulta. Foco/reconexão/clique geram leituras auditadas; seu custo e as quotas reais precisam de homologação.

## Formulários e concorrência

Reconectar não apaga saldo físico, motivo ou a confirmação manual da devolução. Uma nova versão do produto é comparada com a versão sobre a qual o formulário foi aberto. Se mudou, o ajuste fica bloqueado e o operador precisa usar **Rever saldo atualizado**. A nova versão é carregada explicitamente; saldo físico digitado e motivo permanecem para nova conferência. O servidor ainda recusa qualquer corrida posterior.

O comprovante aberto sem pedido pendente é consultado novamente. Se outro atendimento já cancelou a venda, a tela mostra seu estado atual e deixa de oferecer novo estorno. A consulta preserva o motivo/checkbox ainda não enviados enquanto a venda continuar confirmada. Atendentes continuam limitados às próprias vendas; ajustes e estornos permanecem administrativos.

## Pedido com resultado incerto

Ajuste e estorno fixam tipo, chave idempotente, produto/venda, versão, saldo e motivo em memória antes do POST. Uma resposta perdida mantém o mesmo comando, bloqueia campos/fechamento normal/Escape e permite apenas conferência explícita. Alterar valores do DOM não muda o payload fixado. Reconectar faz leituras, nunca repete o POST automaticamente.

Uma primeira rejeição conhecida permite correção/revisão. Depois de uma resposta incerta anterior, uma rejeição posterior não apaga o pedido automaticamente: ele pode já ter sido aplicado. Expiração da sessão ou troca de conta também não permite criar outra chave para a operação pendente. É preciso voltar à mesma conta autorizada; conflitos que não puderem ser esclarecidos exigem análise administrativa, preservando os journals.

Não há gravação nova em localStorage, sessionStorage ou IndexedDB. Pedido e rascunho permanecem somente na memória desta página. **Mantenha a aba aberta.** O aviso de saída quando há pedido/envio depende das regras do navegador e não garante impedir recarga/fechamento nem recuperar os dados depois. Não há fila offline, autosave ou recuperação entre aparelhos. Um rascunho ainda não enviado também pode ser perdido por recarga.

## Estorno confirmado e leitura posterior

O fluxo distingue dois resultados:

1. Sem resposta conclusiva do POST: a conferência explícita repete exatamente o mesmo comando idempotente.
2. POST confirmado, mas comprovante indisponível: a tela informa **Estorno confirmado** e o botão passa a **Conferir comprovante**. Esta etapa faz somente GET; não envia o estorno de novo, inclusive depois de reconectar ou recuperar a sessão na mesma página.

Quando o comprovante atualizado chega, a tela mostra a venda cancelada, libera a visualização histórica e mantém a trilha anterior. Se um ajuste já foi confirmado e apenas a atualização da lista falhar, a mensagem conserva o saldo confirmado e identifica separadamente a falha de consulta. Não transforma um efeito conhecido em uma nova tentativa de gravação.

Impressão pelo botão e CSS de impressão ficam bloqueados enquanto há pedido pendente, sessão recusada, desconexão ou comprovante vencido. O resultado de impressão continua sendo um comprovante do registro, sem valor fiscal. Os testes de mídia print não comprovam impressora ou PDF real.

## Escopo preservado

Controller/HTML/CSS de Operações, testes e documentação. Sem alteração do backend, schema, flags, credenciais, dependências ou instalação Google real. Apenas DEV; produção e home dos perfis permanecem preservadas. Saldo zero mantém cadastro editável; ajustes/estornos conservam o mesmo produto e histórico. Estorno integral registra devolução de unidades e acerto manual externo; não há cobrança ou devolução bancária nem estorno parcial. [QA do incremento](QA_RECONEXAO_OPERACOES.md).
