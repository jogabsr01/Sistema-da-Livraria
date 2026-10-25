# Reconexão de notificações e reposição — DEV

Este lote protege o centro de notificações e o relatório por fornecedor contra respostas perdidas, mudanças de conta e relatórios antigos. Não cria novos tipos de notificações administrativas ou encerra a pendência geral de sincronização do v17.

## Conferência e atualização de alertas

A faixa mostra conexão e necessidade de conferência. Novas atualizações exigem sessão da mesma conta, listagem/resumo completos e conferência de até 90 segundos. Offline, o submit não cria nem envia uma atualização. O prazo e os controles da página são auxiliares; sessão, papel, acesso pessoal, CSRF e permissão administrativa continuam validados no backend.

Se marcar como lida ou alterar para em atendimento perder a resposta, a página guarda em memória o pedido original. O painel **Atualização aguardando confirmação** identifica a operação e o título enquanto a conta estiver autorizada. Outros pedidos ficam bloqueados; atualizar a lista e reconectar fazem somente leituras. **Conferir atualização pendente** repete explicitamente a mesma referência pessoal ou o mesmo commandId/conteúdo de acompanhamento administrativo. Nenhum comando novo substitui o incerto ao renderizar novamente os cards.

O painel permanece disponível mesmo se o alerta sair da lista ativa após uma reposição. O servidor resolve a repetição idempotente sem reabrir um alerta resolvido nem duplicar auditoria. A marca pessoal de leitura continua distinta do acompanhamento compartilhado. Avisos de escala continuam pessoais.

Uma primeira rejeição conhecida permite nova conferência/correção; uma rejeição posterior a uma resposta incerta não apaga automaticamente o pedido. Sessão expirada ou conta diferente também não o substitui. É necessário voltar à mesma conta autorizada; perder o papel administrativo bloqueia o POST de acompanhamento e esconde seus controles. Situações que permaneçam inconsistentes exigem análise administrativa, preservando journals.

Um POST confirmado continua informado como **Atualização confirmada** se somente a leitura posterior da lista falhar. Não se apresenta esse resultado conhecido como uma nova gravação pendente.

## Privacidade e relatórios

Queda de conexão, ocultação da página ou falha de transporte remove relatório, linhas, resumo e texto para copiar. Recusa da sessão ou conta diferente também remove alertas e opções de fornecedor da visualização anterior. O pedido pendente permanece somente em memória, com descrição genérica até recuperar a mesma conta.

Os botões de visualizar, baixar CSV, imprimir e preparar texto consultam novamente o relatório completo no servidor, com os filtros atuais, permissão administrativa e autenticação forte recente já existentes. A resposta é descartada se atravessou mudança de conexão, ocultação da página ou alteração dos filtros: não mostra o relatório, baixa arquivo, imprime ou prepara texto daquele resultado antigo. Não usa o relatório anterior como fallback de erro. A impressão pelo menu do próprio navegador usa a visualização já recebida, enquanto estiver disponível no prazo de revisão.

O relatório e o texto ficam disponíveis para revisão por até **90 segundos após a consulta**. Depois, são apagados da tela e precisam ser gerados novamente. Esse prazo é independente da idade da lista de alertas: gerar um novo relatório faz sua própria conferência de conta/servidor. A tela não consegue apagar um arquivo já baixado ou texto já copiado pelo operador.

Reconexão, foco, retorno à aba, restauração da página e clique reconferem listagem/resumo. Respostas anteriores a mudanças de contexto não liberam a página. As requisições, inclusive sessão, têm timeout de 30 segundos. O polling de 60 segundos continua apenas enquanto não há relatório em revisão, pedido pendente ou operação em andamento; não interrompe a leitura do relatório nem reenvia o pedido incerto.

CSV mantém BOM/quoting e proteção contra fórmulas. Texto permanece manual para revisar, copiar e escolher a pessoa destinatária; nenhum e-mail, WhatsApp, pedido de compra ou mensagem automática é enviado. Quantidades sugeridas continuam calculadas pelo contrato anterior, sem previsão de demanda ou compra confirmada. Limites seguros continuam recusando relatório parcial.

## Persistência e escopo

Pedidos pendentes ficam somente na memória desta página: **mantenha a aba aberta**. O aviso de saída depende do navegador e não garante impedir recarga/fechamento nem recuperar o pedido depois. Não há fila offline, autosave ou armazenamento novo de pedidos, títulos, relatórios ou dados pessoais em localStorage/sessionStorage/IndexedDB.

Somente HTML/CSS/controller, testes e documentação. Sem nova flag, schema, backend, dependência, segredo ou ativação Google real. Relatórios só aparecem depois de confirmar que o módulo está disponível, além da sessão/papel. Origem DEV obrigatória; main/produção e home dos perfis preservadas.

As regras de cadastro editável com saldo zero, venda bloqueada, reposição no mesmo ID e exclusão lógica administrativa continuam. Demais notificações, outros módulos de reconciliação, backup/restauração, retenção, rotação e homologação real permanecem na lista original. [Evidências deste incremento](QA_RECONEXAO_NOTIFICACOES.md).
