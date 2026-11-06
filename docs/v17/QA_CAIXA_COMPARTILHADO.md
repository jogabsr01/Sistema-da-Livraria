# QA — Caixa compartilhado DEV, 23/10/2026

Base recuperada do GitHub: `dev/7108cf07429b7cecb1f99c7ce4b298c1f71fd768`, com PR #15 já integrado. Branch de entrega: `feat/v17-shared-checkout`. Sem modificação de `main`, merge ou ativação de flags Google/Netlify nesta retomada.

## Resultados executados

| Verificação | Resultado |
| --- | --- |
| Backend Node 24.19.0 | 173 testes aprovados, sem skips |
| Backend Node 22.23.4 | 173 testes aprovados, sem skips |
| Build público | Aprovado; `index.html` preservado, novos assets por allowlist |
| Protótipo (`test-public-build.py`) | 34 testes Chromium aprovados |
| Catálogo compartilhado | 6 testes Chromium aprovados |
| Fotos privadas | 6 testes Chromium aprovados |
| Consulta ISBN compartilhada | 8 testes Chromium aprovados |
| Caixa compartilhado | 10 testes Chromium aprovados; o cenário de pagamento executa as quatro formas |
| Total de navegador nesta retomada | 64 testes aprovados |
| Sintaxe JS e `git diff --check` | Aprovados |

Não foram somados testes de rodadas anteriores a esses resultados. As demais suítes opcionais de browser não foram reexecutadas nesta entrega. Dependências mantidas conforme lockfile, sem nova biblioteca de runtime.

## Garantias exercitadas

O código HTTP e o Apps Script da aplicação foram executados sobre recursos de contrato descartáveis: sessões persistentes, autorização, CSRF, assinatura/correlação, schema e binding DEV, lock, journal, preços em centavos, produtos ativos e estoque. Nenhuma rota de teste é incluída nas Functions/public build.

Os testes novos de backend cobrem quatro pagamentos sem cliente, recibo idempotente, duas sessões concorrentes disputando a última unidade, conteúdo/operador conflitante, normalização de linhas duplicadas, mudança de preço, campos extras/PII/identidade/preço injetado, corpo grande, gates fechados, PROD, revogação/perfil/binding/lock, journal corrompido, colisão deliberada com ID de auditoria do catálogo, auditoria da rejeição e recibos assinados inconsistentes.

Falhas são injetadas antes e depois de cada append do evento/venda/item/movimento/auditoria e da escrita de estoque. A recuperação pela leitura do catálogo ou repetição do comando deve resultar em uma venda, uma baixa e uma auditoria de confirmação. O histórico legado v1 continua coberto pela suíte existente. O teste de journal incompleto do catálogo passou a esperar `JOURNAL_INVALID`, pois agora o histórico é validado antes de qualquer leitura/gravação do produto.

No navegador, os dez cenários verificam pagamentos/reset da compra, perda da resposta e recarga com a mesma chave, falha de projeção, preço atualizado exigindo nova confirmação, conexão indisponível, armazenamento sem espaço impedindo o envio, conta diferente/flags/PROD, indisponibilidade de estoque e quantidades por teclado. Duas sessões independentes fazem login com assinatura WebAuthn de autenticadores virtuais, observam o saldo ao recuperar foco e registram duas vendas sem saldo negativo. Layout de 390×844 e 412×915 é exercitado em Chromium com toque/emulação mobile; não é Safari físico.

## Limites da evidência

Google Sheets, Drive, Mail e persistência são emulados. Testes não provam Google IAM real, atomicidade remota, quotas, e-mail entregue, passkey/aparelho físico, sincronização por navegador fechado, conciliação bancária ou prontidão de produção. O protótipo usa ZXing 0.21.3 obtido pela fonte HTTPS documentada, câmera sintética e fixtures de APIs.

Houve falhas iniciais de infraestrutura dos testes por rede local restrita e biblioteca ZXing ausente; foram resolvidas habilitando a rede permitida na execução e obtendo a biblioteca fixa documentada. O primeiro teste de quota do Caixa tinha uma injeção Playwright executada imediatamente; o teste foi corrigido e reexecutado com sucesso. Nenhuma validação TLS foi desativada.

Homologação e bloqueios funcionais: [CAIXA_COMPARTILHADO_DEV.md](CAIXA_COMPARTILHADO_DEV.md). Entradas/ajustes/estornos e edição de produto com venda histórica continuam pendentes. A v17 não está concluída.
