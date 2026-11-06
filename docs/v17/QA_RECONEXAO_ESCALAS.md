# QA — reconexão das escalas

Validação local em 26/10/2026 (America/Sao_Paulo), com dados descartáveis, Google/Sheets/Drive/MailApp emulados e autenticador virtual Chromium. Não representa homologação com instalação Google ou aparelhos reais.

## Como interpretar os números

A suíte completa do backend passou com **332 testes no Node 24.19.0 e os mesmos 332 no Node 22.23.4**, sem falhas, cancelamentos ou testes ignorados. São 332 casos distintos executados em duas versões, não 664 casos distintos. Comando: `node --test --test-concurrency=2 --test-reporter=tap tests/backend/*.test.mjs`. Logs locais: `work/schedules-reconnection-full24.log` e `work/schedules-reconnection-full22.log`.

O build Netlify está configurado como `npm test && npm run build`: executa todos os arquivos `tests/backend/*.test.mjs` antes de gerar os arquivos públicos. As contagens menores dos incrementos anteriores eram dos contratos selecionados e cenários de navegador do bloco. Não indicam remoção de testes e não devem ser comparadas diretamente ao total global. Os testes de navegador deste lote são selecionados por área; não são uma execução de todos os fluxos de navegador do sistema.

## Navegador deste bloco

**26 cenários Chromium únicos aprovados**: 13 novos em `scripts/test-schedules-reconnection.py`, 6 regressões em `scripts/test-schedules.py` e 7 em `scripts/test-notifications.py`.

- Rascunho sem envio é ocultado offline e recuperado na mesma conta, sem POST automático.
- Publicação e cancelamento com resposta perdida repetem o mesmo conteúdo e commandId, sem duplicar notificações ou escala.
- Sessão expirada limpa o editor e mantém a pendência genérica; outra conta não envia o pedido original.
- Resposta posterior de acesso proibido não descarta pedido já incerto; retorno autorizado confere o pedido original.
- Gravação conhecida continua salva quando falha somente a leitura seguinte do calendário.
- Revisão concorrente bloqueia salvamento e exige descarte explícito do rascunho para abrir a versão atual.
- Resposta antiga do calendário não libera publicação após mudança de contexto.
- Retirada de papel antes do envio limpa os campos e impede POST.
- Validade de 90 segundos vence sem apagar o rascunho ou iniciar gravação.
- Abertura offline retoma leitura, sem alteração automática.
- Celular sem overflow, formulário privado oculto offline e captura inspecionada.

Regressões preservam calendário mensal/semanal, horários de Brasília, escopo pessoal, rascunhos administrativos, publicação/edição/cancelamento com histórico, horários adjacentes e sobreposição, alteração em outra aba, notificações pessoais, leitura individual e relatório de reposição autorizado.

Rede, conta alternativa, acesso recusado e respostas atrasadas são fixtures explícitas. A perda de resposta é simulada depois que o backend descartável executa o pedido, verificando os efeitos persistidos. Os testes esperam a conclusão da primeira tentativa antes de simular reconexão. Dois cenários inicialmente falharam por antecipar essa conclusão ou trocar a fixture de conta antes da resposta; a sincronização foi corrigida, sem relaxar as verificações de efeito único ou de acesso.

Build final, sintaxe JS, AST Python e diff check aprovados. Logs e captura `work/qa-schedules-reconnection/rascunho-protegido.png` ficam ignorados. Integração somente DEV, condicionada a preview aprovado no head exato; main/PROD e Google real preservados.
