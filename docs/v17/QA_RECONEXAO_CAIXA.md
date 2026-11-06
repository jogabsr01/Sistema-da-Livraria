# QA — reconexão do Caixa

Validação local em 25/10/2026 (America/Sao_Paulo), instalação descartável com Sheets/Drive/MailApp emulados. WebAuthn e sessão usam o código real e autenticador virtual Chromium. Não foram usados dados, e-mails ou credenciais reais.

## Navegador

**21 cenários do Caixa aprovados**, sendo 11 novos e os 10 anteriores. Incluem:

- Queda bloqueia envio até mesmo por submit programático, sem criar comando ou venda.
- Retorno da rede com erro de consulta permanece bloqueado; atualização completa libera.
- Venda com resposta perdida mantém comando e chave idempotente; reconectar não reenvia; conferência explícita retorna a mesma venda e uma única baixa.
- Resultado pendente pode ser conferido mesmo com catálogo indisponível.
- Consulta atrasada que atravessa queda/retorno não libera a confirmação.
- Preço alterado durante a desconexão é atualizado antes da confirmação.
- Operação administrativa real no emulador zera o saldo durante a desconexão; reconectar mantém livro/carrinho e bloqueia a venda.
- Sessão recusada na reconexão e na conferência explícita preserva comando sem outro envio de venda.
- Consulta parcial falha ao buscar livro do carrinho fora da página; nenhuma liberação parcial.
- Abertura offline retoma a verificação de acesso ao reconectar.
- Prazo de 90 segundos e restauração de página bloqueiam dados antigos.
- Layout de celular sem overflow e faixa de desconexão inspecionada visualmente.

Mais **19 cenários de regressão aprovados**: clientes/compra identificada (8), operações administrativas (6), nichos/filtros do Caixa (5). Total: **40 cenários Chromium** neste lote.

As mudanças de navigator.onLine e eventos de reconexão são fixtures explícitas; falhas reais de fetch são injetadas por abort de rota. A resposta atrasada é retida e liberada pelo teste. O teste de expiração instala o relógio Playwright antes da navegação para incluir os timers da aplicação. O primeiro ensaio instalava o relógio depois dos timers e falhou; foi corrigida a fixture, sem alterar o prazo da aplicação. A restauração usa PageTransitionEvent controlado, sem comprovar todos os comportamentos de suspensão/bfcache de aparelhos reais.

## Contratos e build

**25 contratos de backend aprovados em Node 24.19.0 e Node 22.23.4**: Caixa (13), operações (9), build/schema (3). Incluem proteção idempotente, concorrência, saldo, rejeição de preço, autorização e recuperação das projeções existentes. Não houve mudança no backend.

Comandos: `node --test --test-isolation=none --test-reporter=tap tests/backend/checkout.test.mjs tests/backend/operations.test.mjs tests/backend/build-schema.test.mjs`; Node 22 usa `--experimental-test-isolation=none`. Isolamento desativado apenas para o runner local emitir os 25 contratos individuais: o runner isolado deste ambiente havia reportado somente os três arquivos como unidades aprovadas. Não se contabilizaram esses três como 25.

`npm run build`, `node --check caixa-dev.js`, AST Python e `git diff --check` aprovados. Logs e captura ficam em work/ e artefatos locais ignorados, sem integrar dados de teste ao produto. A suíte completa do backend é exigida pelo build Netlify do PR.

Estes resultados não comprovam Internet física, múltiplos aparelhos reais, IAM/quotas Google, recuperação após perda da aba nem ativação privada. O v17 continua em andamento.
