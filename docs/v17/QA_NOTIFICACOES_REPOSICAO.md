# QA — notificações e reposição, 23/10/2026

Base: `dev/dc0c5996393e425fc87643088caafe8abaefddd8` (PR #19). Branch: `feat/v17-stock-alerts-report`. Publicação DEV autorizada pelo usuário; produção e configurações privadas fora desta execução.

| Verificação executada | Resultado |
| --- | --- |
| Node 24.19.0 | 197 testes aprovados, sem falhas/skips |
| Node 22.23.4 | 197 testes aprovados, sem falhas/skips |
| Build / sintaxe JS / diff-check | Aprovados |
| Notificações/relatório Chromium | 7 testes aprovados |
| Reposição Chromium | 5 testes aprovados |
| Catálogo Chromium | 6 testes aprovados |
| Caixa Chromium | 10 testes aprovados |
| Fotos privadas Chromium | 6 testes aprovados |
| ISBN Chromium | 8 testes aprovados |
| Protótipo Chromium | 37 testes aprovados |
| Total navegador desta rodada | 79 testes aprovados |

Os 12 contratos Node novos cobrem leitura isolada entre usuários; deduplicação; escalada estoque baixo→zero com novo aviso não lido; resolução/reposição/recorrência; atendimento administrativo recuperável; falhas antes/depois da notificação/auditoria; entrada sem duplicidade após falha na resolução; agrupamento por fornecedor/ausente e sugestão pelo mínimo; exclusão de inativos e estoque suficiente; nomes de fornecedor que coincidem com propriedades de objetos; relatório completo com 400 livros além da página de alertas e do limite antigo de transporte; função administrativa/reauth/CSRF/DEV; flags fechadas, revogação e binding; respostas assinadas inconsistentes/oversized.

Nos sete cenários de navegador, a autenticação e as assinaturas WebAuthn são reais com autenticador virtual; Google/Drive/Mail/armazenamento são contratos emulados. Foram executados alerta/lida/atendimento/reposição/resolução/histórico; fornecedores e cadastros incompletos; CSV gerado e conteúdo conferido; impressão acionada sob teste; texto selecionado para cópia sem envio; proteção contra fórmulas e XSS com fixture hostil explícita; negação de API administrativa a atendente; layout 390×844 com rolagem da tabela dentro do relatório; flags/PROD fechados. Impressão é verificada por interceptação da função do navegador, não por impressora ou PDF externo.

Uma corrida de atualização encontrada durante os testes foi corrigida: trocar o filtro enquanto a carga inicial estava em andamento agora agenda nova consulta, em vez de ignorar a seleção. O sino também agenda uma nova atualização se houver gravação enquanto a contagem anterior está em trânsito. O teste de impressão foi ajustado para usar uma função compatível com a CSP; nenhuma permissão `unsafe-eval` foi adicionada.

Não há nova dependência de runtime. Nenhum teste envia mensagem, cria pedido de compra, acessa Google real ou afirma validação de hardware/Safari/quota/IAM. O módulo permanece atrás das flags até a atualização privada e homologação pelo proprietário. Consultar [NOTIFICACOES_REPOSICAO_DEV.md](NOTIFICACOES_REPOSICAO_DEV.md) para limites e roteiro.
