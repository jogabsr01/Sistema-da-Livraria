# QA — reconexão dos nichos

Validação local em 26/10/2026 (America/Sao_Paulo), dados descartáveis, Google/Sheets/Drive/MailApp emulados e autenticador virtual Chromium. Não constitui homologação com a instalação Google ou aparelhos reais.

## Backend completo

**332 testes aprovados em cada versão Node 22.23.4 e Node 24.19.0**, sem falhas, cancelamentos ou testes ignorados. São os mesmos 332 casos executados nos dois runtimes, não 664 casos distintos. Comando: `node --test --test-concurrency=2 --test-reporter=tap tests/backend/*.test.mjs`. Logs em `work/niches-reconnection-full22.log` e `work/niches-reconnection-full24.log`, ignorados pelo Git.

O build Netlify continua executando `npm test && npm run build`, com todos os arquivos `tests/backend/*.test.mjs`. Não houve remoção de testes. A contagem de navegador abaixo corresponde ao bloco e às regressões selecionadas, não a todos os fluxos de navegador do sistema.

## Navegador deste bloco

**18 cenários Chromium únicos aprovados:** 13 novos em `scripts/test-niches-reconnection.py` e 5 regressões em `scripts/test-niches.py`.

- Rascunho oculto offline e recuperado pela mesma conta, sem POST automático.
- Resposta perdida conserva os campos e a imagem originais mesmo após alteração programática do formulário; repetição mantém um nicho com revisão 1.
- Sessão expirada limpa editor e prévia, mas conserva o pedido para conferência explícita.
- Outra conta não reenvia o pedido original; retorno à conta original permite conferir a mesma chave.
- Perda do papel antes do envio impede POST e limpa os campos.
- Gravação confirmada permanece salva quando falha somente a leitura seguinte da lista.
- Edição concorrente preserva o rascunho, bloqueia salvar e exige abertura explícita da versão atual; alteração seguinte usa a revisão correta.
- Resposta antiga da lista não libera salvamento após mudança de contexto.
- Acesso proibido em uma conferência não descarta pedido já incerto.
- Validade local de 90 segundos vence sem apagar o rascunho ou iniciar gravação.
- Decodificação de imagem atrasada após queda não restaura a prévia nem inclui imagem no pedido seguinte.
- Celular sem overflow e formulário oculto offline; captura inspecionada.
- Abertura offline retoma leitura sem gravação automática.

As cinco regressões preservam imagem de fundo, ordenação, cards/filtros do Caixa, repetição de pedido sem duplicação, livro vinculado a nicho desativado ainda editável, múltiplos vínculos preservados, atualização do catálogo após criação em outra aba, bloqueio de atendente e nome duplicado com formulário recuperável.

Rede, conta alternativa, negativas de sessão, atrasos e perda de resposta são fixtures explícitas. A resposta perdida é simulada depois de o backend descartável executar a gravação. Sessão, PIN, assinatura WebAuthn e handlers usam o código real com serviços externos emulados. Nenhuma credencial ou mensagem real é usada.

Build, sintaxe JS, AST Python e diff check aprovados. Logs e captura `work/qa-niches-reconnection/rascunho-protegido.png` ficam ignorados. Integração exclusiva DEV condicionada ao preview aprovado no head exato; main/PROD e Google real preservados.
