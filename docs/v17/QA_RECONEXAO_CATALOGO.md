# QA — reconexão do Catálogo e reposição

Validação local em 25/10/2026 (America/Sao_Paulo), com instalação Google descartável, sessão/PIN e assinaturas WebAuthn reais de autenticador virtual Chromium. Sheets/Drive/MailApp, fontes ISBN e sinais de rede são fixtures; nenhum dado ou e-mail real foi usado.

## Navegador

**13 cenários novos aprovados** em `scripts/test-catalog-reconnection.py`:

- Rascunho/fornecedor preservados, submit offline sem pedido e salvamento após reconectar.
- Resposta perdida de cadastro congela campos/fechamento/Escape, não reenvia automaticamente e repete o payload original apesar de alteração programática do DOM.
- Foto privada repete os mesmos bytes e produz um único arquivo, sem gravar foto/campos no armazenamento do navegador.
- Rejeição inicial conhecida libera correção; rejeição após resultado incerto conserva o pedido original até confirmar, sem segundo produto.
- Reposição com resposta perdida conserva sessionStorage/chave/payload e soma unidades apenas uma vez após conferência explícita.
- Submit offline da reposição não cria comando nem envia POST; quantidade permanece no formulário.
- Sessão recusada mantém a entrada pendente e não envia outro POST.
- Conta diferente não reenvia cadastro pendente; voltar à mesma conta permite conferir o pedido original.
- Resposta de lista iniciada antes da queda é descartada e falha da nova consulta mantém bloqueio.
- Exclusão com resposta perdida pode ser conferida após o livro desaparecer da lista, com um só efeito de auditoria e sem apagar o produto.
- Prazo de 90 segundos bloqueia salvamento sem limpar os campos; layout de celular inspecionado.
- Abertura sem rede retoma a verificação de acesso ao reconectar, sem recarregar.
- Edição administrativa por outro atendimento conserva o rascunho local, recusa a versão antiga e exige recarga explícita da versão atual.

Mais **30 cenários de regressão aprovados**: Catálogo (6), estoque/reposição (5), câmera/galeria/fotos privadas (6), nichos e filtros (5), ISBN (8). Total **43 cenários Chromium únicos** neste lote. Os fluxos anteriores continuam incluindo edição de livro esgotado, reposição no mesmo cadastro, somente administradores excluindo e entrada retomada por recarga.

Sinais online/offline são alterados explicitamente no navegador; falhas reais de fetch são representadas por aborts de rota, respostas perdidas ocorrem após executar o backend e a resposta atrasada é retida pelo teste. O prazo usa relógio Playwright instalado antes da navegação; a fixture inibe polling sem disparar visibilitychange para testar o vencimento de 90 segundos por si só. A sessão de conta diferente e a rejeição controlada são fixtures de contrato, não acesso a outra conta real. A edição concorrente usa o endpoint autorizado real no emulador.

## Backend e publicação

**42 contratos aprovados em Node 24.19.0 e Node 22.23.4**: catálogo (18), estoque (12), fotos privadas (9), build/schema (3). Sem alteração do backend. Runner local sem isolamento de processo para emitir os contratos individuais: `node --test --test-isolation=none --test-reporter=tap ...`; Node 22 usa `--experimental-test-isolation=none`.

`npm run build`, sintaxe JS, AST Python e `git diff --check` aprovados. Logs/captura permanecem em artefatos locais ignorados. A publicação DEV exige preview aprovado no head exato e preservação de main/PROD. Nenhuma flag privada ou instalação Google real foi alterada.

Não se comprova Internet física, dispositivos reais, todos os comportamentos de bfcache/suspensão, quotas/IAM Google, recuperação de rascunhos após perda da aba ou homologação de produção. A fronteira de persistência permanece descrita no [contrato](RECONEXAO_CATALOGO_DEV.md); o v17 não está concluído.
