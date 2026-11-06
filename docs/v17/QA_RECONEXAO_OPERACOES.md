# QA — reconexão de Operações

Validação local em 25/10/2026 (America/Sao_Paulo), Google/Sheets/Drive/MailApp descartáveis emulados. Sessões e assinaturas WebAuthn usam o código real com autenticador virtual Chromium. Nenhum dado, pagamento ou e-mail real foi usado.

## Navegador

**20 cenários Chromium únicos aprovados**: 14 novos de `scripts/test-operations-reconnection.py` e 6 regressões de `scripts/test-operations.py`.

- Ajuste offline preserva motivo/saldo e não envia POST; reconectar exige confirmação explícita.
- Estorno offline preserva motivo e checkbox, sem envio automático.
- Ajuste com resposta perdida mantém payload original mesmo com DOM alterado e um único evento de domínio.
- Rejeição 403 posterior a estorno incerto não apaga o comando nem libera edição; conferência posterior usa a mesma chave e não duplica unidades.
- POST de estorno confirmado com falha do GET muda para **Conferir comprovante**. Reconectar e conferir não repetem o POST; mídia print esconde o comprovante pendente.
- Ajuste confirmado conserva a mensagem de sucesso/saldo quando só a lista falha.
- Sessão expirada preserva comando e bloqueia envio; retornar à mesma sessão autorizada permite conferir.
- Outra conta não pode reenviar o ajuste da página; recuperar a conta original conserva o pedido.
- Ajuste autorizado em outro atendimento muda a versão; formulário local é preservado, mas exige revisão explícita do novo saldo.
- Resposta de histórico anterior à queda não libera uma operação após falha da nova consulta.
- Comprovante ainda recente perde permissão de impressão na queda/retorno e só libera depois da nova leitura completa.
- Prazo de 90 segundos bloqueia estorno e impressão sem apagar motivo; tela de celular sem overflow e captura inspecionada.
- Página aberta offline retoma acesso/histórico ao reconectar, sem recarga.
- Papel administrativo removido antes do envio é relido e impede o POST de ajuste.

As seis regressões verificam permissões de atendente, flags fechadas, comprovante histórico, estorno integral, retry idempotente, motivo obrigatório, ajuste absoluto e impressão/teclado. Eventos online/offline, sessão recusada/conta diferente, rejeição 403 e falhas de rede são fixtures explícitas. Uma resposta perdida ocorre depois de executar a operação no backend descartável. A resposta atrasada é retida e liberada pelo teste. Concorrência usa uma operação administrativa real contra o emulador; o prazo usa relógio Playwright instalado antes da navegação.

## Backend e build

**25 contratos aprovados em Node 24.19.0 e Node 22.23.4**, sem alteração de backend: operações (9), Caixa (13), build/schema (3). Cobrem autorização/escopo, idempotência, versão/estoque, recuperação das projeções e persistência histórica. Runner local com `--test-isolation=none` em Node 24 e `--experimental-test-isolation=none` em Node 22, reporter TAP para emitir os contratos individuais.

`npm run build`, `node --check operacoes-dev.js`, AST Python e `git diff --check` aprovados. Logs/captura ficam em work/ ignorado. Preview precisa ser aprovado no head exato antes de integrar em DEV. Nenhum segredo, flag privada, Google real ou branch main/PROD foi alterado.

Não há prova de rede física, aparelhos reais, todos os comportamentos de suspensão/bfcache, impressora/PDF, quotas Google ou recuperação após perda da aba. O v17 continua em andamento; o [contrato](RECONEXAO_OPERACOES_DEV.md) explicita a persistência somente em memória e os demais limites.
