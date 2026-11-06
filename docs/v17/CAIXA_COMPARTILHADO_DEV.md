# Caixa compartilhado DEV — venda sem cadastro

Esta entrega liga o núcleo de vendas ao Apps Script e à tela `/caixa-dev.html`, partindo de `dev/7108cf0` (fotos privadas já integradas pelo PR #15). É um incremento das fases B/E; não conclui o PROMPT MASTER v17. `index.html` e produção são preservados.

Atualização posterior ao PR #18: regras vigentes de reposição, edição após vendas/esgotamento e exclusão administrativa em [ESTOQUE_REPOSICAO_DEV.md](ESTOQUE_REPOSICAO_DEV.md). O novo incremento também remove a exceção de estoque negativo do protótipo.

## Comportamento

- Conta verificada com permissão `sales.create`; atendentes, administradores e proprietário. Administradores exigem autenticação forte. O operador é resolvido novamente dentro do ScriptLock do Google, sem aceitar papel/usuário no corpo da compra.
- Pesquisa e paginação do catálogo compartilhado, capas por rotas existentes, carrinho com quantidades, total em reais e estoque atualizado a cada 30 segundos, ao recuperar foco/visibilidade/conexão e após venda.
- Checkout exclusivamente sem cliente: `customerId: null`, sem nome/CPF/contato. Identificação de clientes será uma entrega própria. Compras novas limpam carrinho e pagamento anterior.
- PIX, DINHEIRO, DEBITO ou CREDITO, sem dados de cartão. É um registro administrativo da forma de pagamento, não uma integração de cobrança ou confirmação bancária.
- Preço obtido no servidor, centavos inteiros, validação do total que o operador confirmou. Mudança de preço exige revisão e nova confirmação; não há alteração silenciosa do valor cobrado pelo endpoint.
- Evento durável antes de Vendas/Itens_Venda/Movimentacoes_Estoque/Logs_Auditoria/Produtos. Recuperação idempotente e estoque/versão escritos juntos na linha. Não confirmar a venda antes da resposta completa do servidor.
- Auditoria append-only da confirmação e das rejeições por preço alterado, produto indisponível ou estoque insuficiente. Nenhum token, PIN, CPF ou dado de pagamento entra nesses eventos.

## Recuperação de conexão e resposta perdida

Antes do envio, a tela guarda em `sessionStorage` apenas o comando anônimo (UUID, produtos, quantidades, pagamento e total esperado), em chave separada pelo ID técnico da conta. Não guarda cookie, token CSRF, PIN, nome, CPF ou contato. Isso não autentica nem autoriza: o backend revalida tudo a cada tentativa.

Enquanto houver resultado incerto, os itens e o pagamento ficam bloqueados. O botão **Verificar resultado / tentar novamente** repete o comando original. Após recarga e novo login na mesma conta, a aba recupera essa referência e exige confirmação explícita. Outra conta não consome o comando anterior. Falta de espaço local impede o primeiro envio.

Uma rejeição de negócio comprovada permite ajustar a compra, com nova chave; falhas de transporte/servidor e problemas de acesso mantêm a chave original. A leitura do catálogo recupera projeções de vendas interrompidas antes de expor o estoque. O recibo repetido conserva valor, pagamento, itens e data originais. Chave reutilizada por outro operador ou outro conteúdo é recusada.

Esta fila é limitada à aba e ao perfil do navegador. Fechar a aba, apagar os dados, duplicar abas ou utilizar outro aparelho não equivale à recuperação garantida da referência. Não recriar manualmente uma compra de resultado desconhecido. A consulta operacional de vendas por operador/período e uma reconciliação entre aparelhos ainda precisam ser implementadas antes do uso real.

## Contrato HTTP

`POST /api/v1/checkout`, JSON no mesmo domínio DEV, sessão HttpOnly válida, Origin exato e cabeçalho `X-CSRF-Token` da sessão atual. Limite de corpo: 16.000 bytes; até 100 linhas, normalizadas por produto. Campos extras são recusados.

```json
{
  "idempotencyKey": "UUID-v4-da-compra",
  "items": [{"productId": "UUID-v4-do-produto", "quantity": 1}],
  "paymentMethod": "PIX",
  "customerId": null,
  "expectedTotalCents": 3290
}
```

Resposta `data`: `saleId`, `totalCents`, `createdAt` UTC, `paymentMethod`, `customerId: null`, `items` com preço/subtotal autoritativos. Interface usa `America/Sao_Paulo`. Cookies/segredos e colunas internas do Google não são expostos. O adaptador valida assinatura, correlação e correspondência completa do recibo com o comando.

Erros de negócio usam HTTP 409 (`WORKSPACE_INSUFFICIENT_STOCK`, `WORKSPACE_PRODUCT_UNAVAILABLE`, `WORKSPACE_SALE_PRICE_CHANGED`, `WORKSPACE_IDEMPOTENCY_CONFLICT`). Instalação inativa/inconsistente, journal corrompido, capacidade ou projeção conflitante recusam a operação. Nenhum erro inesperado do Google é devolvido cru.

## Preparação do lote privado e homologação

Não alterar flags agora: a entrega deve ser revisada no PR para `dev`. A homologação depende do proprietário no Google e de acesso ao DEV protegido. Não enviar segredos no chat/GitHub.

1. Revisar e integrar o PR exclusivamente em `dev`, mediante aprovação. Preservar PROD.
2. Fazer backup dos recursos DEV antes da atualização. Atualizar **em conjunto todos os arquivos** da pasta `google-apps-script`, conservando propriedades privadas e recursos existentes. Implantar nova versão do Apps Script e conferir a URL privadamente no Netlify.
3. Não há nova aba ou migração de cabeçalhos: os eventos de checkout usam `Versao_Esquema = 2` na aba existente. A recuperação continua aceitando os eventos legados v1, sem reescrevê-los. Não instalar somente Sales.gs: Code.gs e Catalog.gs precisam estar compatíveis.
4. Concluir os pré-requisitos de identidade/catálogo dos guias [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md), [CATALOGO_COMPARTILHADO_DEV.md](CATALOGO_COMPARTILHADO_DEV.md) e [FOTOS_CAPAS_DEV.md](FOTOS_CAPAS_DEV.md). A confirmação antiga de schema/conexão não valida login, vendas ou IAM.
5. Quando autorizado para homologação isolada, configurar `CHECKOUT_ENABLED=true` no Apps Script DEV e `WORKSPACE_CHECKOUT_ENABLED=true` no contexto DEV/Functions do Netlify, além das flags de backend/sessões/catálogo. Padrão documentado: **false**. Não adicionar chaves novas nem reutilizar credenciais de PROD.
6. Usar somente estoque fictício importado/controlado pelo proprietário em uma instalação descartável DEV. Esta entrega não oferece endpoint de entrada/ajuste; não manipular manualmente o histórico para fabricar uma homologação. Validar quantidade/preço importados antes do teste.
7. Autenticar duas sessões reais: conferir visibilidade do livro e preço/estoque; efetuar venda anônima em cada forma de pagamento; confirmar atendente, itens, totais, auditoria e saldo no Google. Testar disputa da última unidade, resposta perdida, recarga e recuperação sob o mesmo lock.
8. Não liberar operação com clientes reais até resolver os limites abaixo e concluir a aceitação das fases B–E. Para suspender novas vendas, desligar a flag de checkout; não apagar os comandos locais/journal. Recuperar eventos já registrados usando os procedimentos do proprietário antes de reconciliar o estoque.

## Limites que continuam abertos

- Ajustes/estornos de estoque, cancelamento financeiro, clientes identificados, recibos imprimíveis e consulta operacional seguem pendentes. Entradas positivas foram acrescentadas no incremento de reposição.
- A reposição permite editar livros após vendas/esgotamento por checkpoints de catálogo validados junto das entradas/saídas. Não alterar estoque/versões manualmente na planilha.
- Capacidade explícita: 2.000 eventos de venda e 5.000 auditorias. Sem compactação versionada/backup, atingir a capacidade bloqueia novas operações. A recuperação varre o histórico e pode ser limitada por quotas/tempo do Apps Script; não há garantia de throughput comercial.
- Proteção de borda/tráfego, retenção, reconciliação entre abas/aparelhos, recuperação de conta e homologação real permanecem necessárias. Não existe promessa de transação ACID entre abas do Sheets.
- Testes locais usam Google/Drive/Mail emulados e usuários fictícios; Chromium executa WebAuthn real com autenticador virtual. Não representam Google IAM/quota reais, hardware móvel, Safari/WebKit, cobrança bancária nem ativação do proprietário.

## Verificação reproduzível

```sh
npm ci
npm test
npm run build
npm run test:checkout
npm run test:catalog
npm run test:photos
```

Python requer Playwright, Pillow e Chromium, conforme [tests/README.md](../../tests/README.md). Consulte o relatório de QA desta entrega para resultados executados, em vez de inferir homologação pelo sucesso do build.
