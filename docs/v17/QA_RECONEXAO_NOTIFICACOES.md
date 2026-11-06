# QA — reconexão de notificações e reposição

Validação local em 25/10/2026 (America/Sao_Paulo), com Google/Sheets/Drive/MailApp emulados e estado descartável. Sessão/PIN e assinaturas WebAuthn usam o código real com autenticador virtual Chromium. Não houve dados, credenciais ou mensagens reais.

## Navegador

**27 cenários Chromium únicos aprovados**: 14 novos em `test-notifications-reconnection.py`, 7 regressões de notificações e 6 de escalas/avisos pessoais.

- Resposta perdida de acompanhamento mantém o mesmo commandId/payload e um só efeito de auditoria; reconectar não envia POST automaticamente.
- Leitura pessoal reutiliza o mesmo alerta/conta sem novo armazenamento no navegador.
- Offline não cria pedido, atualiza alerta ou solicita relatório.
- Queda apaga relatório, texto e área imprimível; reconexão não regenera automaticamente o relatório.
- CSV atrasado que atravessa queda/retorno não baixa arquivo.
- Resposta de relatório de filtro anterior não substitui o filtro alterado, mesmo com mudança programática do seletor desabilitado.
- Conta diferente remove visualização, alertas, texto e fornecedores anteriores.
- Sessão expirada preserva pedido sem enviar; recuperar a conta original permite conferir.
- Rejeição 403 após resposta incerta não troca a chave nem abandona o pedido.
- Atualização conhecida como aceita permanece informada quando só a leitura da lista falha.
- Revisão do relatório não é interrompida pelo polling de 60 segundos; seu próprio prazo de 90 segundos apaga relatório/texto e bloqueia ações antigas.
- Página aberta sem rede retoma acesso ao reconectar, sem recarga.
- Alerta resolvido por entrada de estoque pode receber a conferência do comando anterior sem reabrir o alerta.
- Papel administrativo removido antes da ação é relido e impede POST; controles administrativos são escondidos.

Regressões preservam agrupamento por fornecedor, indicação de fornecedor ausente, fórmula sugerida, CSV com proteção de fórmulas, renderização como texto, impressão/texto manual, somente leitura para atendentes, origem PROD/flags fechadas, escalas pessoais e históricos. O refinamento final do painel troca o UUID técnico pelo título da operação em textContent e mantém descrição genérica quando a conta não está autorizada; build/sintaxe finais conferidos.

Fixtures explícitas alteram sinais de rede, retêm respostas e simulam sessão recusada/conta diferente/403. Respostas perdidas são abortadas depois de executar a operação no backend descartável. A reposição concorrente usa o endpoint autorizado real contra o emulador. O teste de prazo instala relógio antes de navegar e espera o texto estar pronto antes de avançá-lo; a primeira execução avançava com a requisição ainda em curso e foi corrigida a fixture. Um ensaio inicial também detectou ferramentas visíveis com módulo desativado; a disponibilidade agora exige resposta completa válida, e a regressão de flags passou.

## Backend, build e limites

**28 contratos aprovados em Node 24.19.0 e Node 22.23.4**, sem alteração do backend: notificações (12), escalas (13), build/schema (3). Runner local com `--test-isolation=none` em Node 24 e `--experimental-test-isolation=none` em Node 22, reporter TAP para contar contratos individuais.

`npm run build`, sintaxe JS, AST Python e `git diff --check` aprovados. Captura de celular inspecionada sem overflow; logs e imagens ficam em work/ ignorado. Publicação exclusiva DEV com preview aprovado no head exato; main/PROD e Google real preservados.

Não se comprova rede física, aparelhos reais, todos os comportamentos de suspensão/bfcache, impressora/PDF, quotas/IAM Google nem recuperação depois de perder a aba. A tela não remove arquivo já baixado ou texto já copiado. O v17 segue em andamento; [contrato e persistência](RECONEXAO_NOTIFICACOES_DEV.md).
