# QA — reconexão da equipe e dos clientes

Validação local em 26/10/2026 (America/Sao_Paulo), com dados descartáveis, Google/Sheets/Drive/MailApp/BrasilAPI emulados e autenticador virtual Chromium. Não é homologação com instalação Google ou aparelhos reais.

## Suíte completa do backend

**332 testes aprovados em cada versão Node 22.23.4 e Node 24.19.0**, sem falhas, cancelamentos ou testes ignorados. São os mesmos 332 casos em dois runtimes, não 664 casos distintos. Comando: `node --test --test-concurrency=2 --test-reporter=tap tests/backend/*.test.mjs`. Logs locais em `work/people-reconnection-full22.log` e `work/people-reconnection-full24.log`.

O build Netlify continua executando `npm test && npm run build`, incluindo todos os arquivos `tests/backend/*.test.mjs`. Não houve remoção de testes. A contagem de navegador abaixo corresponde a este bloco e suas regressões selecionadas, não a todos os fluxos de navegador do sistema.

## Navegador: 62 cenários únicos aprovados

| Grupo | Casos |
| --- | ---: |
| Reconexão da equipe | 12 |
| Reconexão dos clientes | 15 |
| Regressões da equipe | 6 |
| Regressões dos clientes | 8 |
| Regressões do Caixa, incluindo reconexão | 21 |

Equipe: rascunho protegido offline sem POST; corpo original preservado mesmo com alteração do DOM; sessão expirada limpa dados e mantém pendência; outra conta não reenvia; papel retirado impede POST; gravação conhecida continua salva quando falha a leitura; revisão concorrente exige descarte explícito; lista antiga não libera gravação; acesso proibido posterior conserva pedido incerto; saída e restauração da mesma aba conservam o pedido; validade de 90 segundos; celular sem overflow e campos ocultos.

Clientes: rascunho protegido e restaurado na mesma conta; repetição com conteúdo original; sessão expirada limpa editor e conserva pedido; outra conta bloqueada; salvamento conhecido com leitura seguinte falha não gera outro POST; leitura atrasada não restaura dados; busca atrasada após mudança de CPF é descartada; sessão revogada antes da resposta remove dados; CEP atrasado não sobrescreve endereço manual; acesso proibido posterior mantém pedido incerto; saída e restauração da aba conservam pedido; nova compra não descarta pendência; dados da seleção removidos offline no celular; revisão concorrente exige nova busca; conferência vencida bloqueia novo salvamento.

As regressões preservam criação/edição/desativação da equipe, CPF mascarado, formulário inválido/duplicado, restrições de acesso, primeiro login com assinatura WebAuthn, navegação por teclado e nome tratado como texto. Clientes preservam venda identificada/anônima, opt-out, seleção explícita, recuperação técnica da venda sem dados pessoais, CEP opcional/falha manual e limpeza ao cancelar. Caixa preserva preços/estoque autoritativos, saldo zero bloqueado, venda incerta idempotente, carrinho protegido, conferência completa dos livros fora da página e recuperação vinculada à conta.

Os 15 casos novos de cliente foram executados como 13 cenários iniciais e 2 adicionais de revisão concorrente e prazo, todos aprovados. Scripts completos: `scripts/test-staff-reconnection.py` e `scripts/test-customers-reconnection.py`. Logs ficam em `work/people-reconnection-*.log`, ignorados.

Rede, conta alternativa, negativas de sessão e respostas retidas são fixtures explícitas. A perda de resposta ocorre depois de o backend descartável executar a gravação, permitindo comparar o pedido e a revisão persistida. A saída/retorno usa eventos simulados; não comprova preservação de memória por todos os navegadores ou recuperação após fechamento. Nenhuma credencial, e-mail, contato ou mensagem real foi usada.

Build final, sintaxe JS, AST Python e diff check aprovados. Capturas de celular `work/qa-people-reconnection/equipe-protegida.png` e `cliente-protegido.png` inspecionadas sem overflow e sem dados de cadastro expostos após invalidar o contexto. Preview aprovado no head exato é requisito de integração DEV; main/PROD e configuração Google permanecem preservados.
