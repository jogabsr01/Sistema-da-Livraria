# Consulta por ISBN no catálogo compartilhado DEV

Incremento em revisão sobre dev após o PR #16 (`96b80b4c2cd45ea4ae5b36fe709ab673fcdec91c`). O PR #16 foi integrado sob autorização; a conferência externa do site continua HTTP 401 e não comprova que o proprietário já recebeu o novo HTML. O PR #15 de fotos privadas permanece separado e sem merge. Main permanece `365a80f0be90258c08f1e1cb42650f0c397902bb`.

## Entrega

O cadastro em catalogo-dev.html passa a oferecer **Consultar ISBN**, também acionado por Enter no campo (compatível com leitores USB que enviam Enter). ISBN-10/formatação são normalizados para ISBN-13 com dígito verificador. Códigos internos continuam pelo cadastro manual; não são ISBNs inventados. Não há captura de código por câmera neste incremento.

As consultas vão pelo servidor Netlify para cinco endpoints fixos: BrasilAPI/CBL, BrasilAPI/Mercado Editorial, Google Books, Open Library catálogo e Open Library edição. Somente o ISBN sai para os provedores; nenhum cookie, operador, PIN, dados de cliente ou configuração Google é enviado. URLs de serviço nunca são escolhidas pelo navegador e redirects não são seguidos.

As sugestões contêm somente título, autor, editora, edição, ano, páginas e sinopse. Outra edição/ISBN declarado é descartado, inclusive sua capa. Dados ausentes permanecem ausentes; não há exemplo fictício apresentado como resposta da internet. Google Books não fornece edição garantida e o módulo não a deduz.

O formulário preenche apenas campos vazios que não mudaram durante a consulta. Não altera preço, fornecedor, nichos, estoque ou capa já preenchida. Fechar, cancelar, trocar ISBN, sair da página ou salvar invalida resultados tardios. Falha de serviço/capa mantém o cadastro manual disponível. A confirmação de salvamento continua exigindo o recibo do servidor do catálogo.

Cada URL recebida é apenas candidata. O navegador testa Image.complete e dimensões de pelo menos 30 × 40 pixels, recusando placeholder 1 × 1, erro e timeout; somente uma imagem carregada é selecionada. A validação de pixels confirma carregamento; a correspondência visual com o exemplar ainda precisa ser conferida. A prévia/lista ainda têm fallback caso uma imagem deixe de estar disponível. Fontes e HTTP 429/404 ficam explícitos. O fallback Open Library Covers usa o endpoint documentado por ISBN, sem presumir que exista imagem para esse livro.

Para 9788543303932, o módulo preserva uma referência editorial já existente no protótipo. A página da Mundo Cristão foi reconferida nesta entrega e informa **978-8543303932**; a imagem é uma candidata identificada como **Referência editorial (Mundo Cristão)**, nunca como resposta das APIs. Não substitui metadados de API e continua sujeita à verificação de imagem no navegador.

Este incremento persiste **link externo**, não bytes no Drive. Armazenamento privado por câmera/galeria pertence ao PR #15. Sua integração futura precisa combinar os controles e repetir testes de preservação de foto; não se afirma que esses PRs já estejam homologados juntos. Caixa/Estoque compartilhados continuam na sequência do V17.

## Controles e ativação posterior à aprovação

`POST /api/v1/catalog/isbn` exige instalação DEV exata, catálogo/sessão verificada, products.write, origem/JSON/CSRF e corpo estrito de até 128 bytes contendo só isbn. WORKSPACE_ISBN_LOOKUP_ENABLED permanece false por padrão. As dependências privadas de identidade/guard precisam estar prontas; não há nova chave, ação Apps Script ou migração.

O serviço reutiliza contadores duráveis existentes com domínios HMAC próprios: bucket por usuário e por instalação. Consultas bibliográficas não consomem o bucket de login. Na homologação DEV, aplica a política existente de 5 tentativas por usuário e 30 por instalação na janela de 15 minutos; excesso retorna 429/Retry-After e espera progressiva de 60–3.600 segundos. Essa política inicial conservadora exige revisão própria antes de cadastro em lote/uso amplo. Trocar sessão/instância Netlify não reinicia o contador do usuário.

Cada provedor tem timeout de quatro segundos e resposta limitada a 192 KiB. Até quatro ISBNs distintos em andamento por instância; deduplica consultas simultâneas do mesmo ISBN. Cache limitado a 128 ISBNs com dados públicos por cinco minutos, reduzido a 30 segundos após falha parcial de provedor. Não armazena identidade nem uma afirmação de que a capa carregou. A interface informa cache recente e revalida as imagens. Recurso externo indisponível não deve manter o cadastro bloqueado. Ainda faltam limites de borda/concorrência global e homologação de quotas/latência Netlify/Google reais.

Após revisão/merge e homologação do lote de primeiro acesso/catálogo, cadastrar **WORKSPACE_ISBN_LOOKUP_ENABLED=true** somente no contexto Branch deploys limitado a dev e atualizar apenas esse branch deploy. Não alterar produção/previews, não habilitar o backend antes de concluir o lote privado e não promover pelo botão Publish deploy. Não é necessário atualizar Apps Script exclusivamente para a consulta ISBN: ela usa os controles já preparados pelo primeiro acesso. Desativar essa flag esconde o botão e fecha a consulta; o cadastro manual permanece disponível.

## Consulta real em 23/10/2026

As linhas abaixo são respostas reais consultadas nesta sessão; não são fixtures. Metadados em consultas paralelas: **887 ms** para 9786589806691 e **759 ms** para 9788543303932, usando o serviço fora do fluxo autenticado para acessar somente endpoints públicos. Não são tempos do site DEV, do login, do Google privado ou do salvamento. Nenhum cadastro compartilhado foi criado.

| ISBN | Livro / fonte dos dados | Fonte candidata da capa | Imagem carregou no Chromium? | Persistência real |
| --- | --- | --- | --- | --- |
| 9786589806691 | Mulher real — Junia Hayashi — Editora Quatro Ventos; BrasilAPI/CBL | Open Library Covers | Não: endpoint HTTP 404, complete=true e naturalWidth=0 | Não executada; sem capa válida |
| 9788543303932 | Examinando as escrituras — Charles R. Swindoll — Mundo Cristão; BrasilAPI/CBL | Referência editorial Mundo Cristão; Open Library Covers | Não nesta sessão: referência com ERR_CERT_AUTHORITY_INVALID; Open Library HTTP 404 | Não executada; navegador não carregou a candidata real |

Para ambos: CBL retornou a ficha sem URL de capa; Mercado Editorial respondeu HTTP 404; Google Books HTTP 429; Open Library catálogo respondeu sem registro; Open Library edição respondeu HTTP 404.

Referências exatas:

- https://brasilapi.com.br/api/isbn/v1/9786589806691?providers=cbl
- https://brasilapi.com.br/api/isbn/v1/9788543303932?providers=cbl
- https://covers.openlibrary.org/b/isbn/9786589806691-M.jpg?default=false
- https://covers.openlibrary.org/b/isbn/9788543303932-M.jpg?default=false
- https://www.mundocristao.com.br/produto/examinando-as-escrituras/
- https://www.mundocristao.com.br/wp-content/uploads/2021/12/Examinando-as-escrituras.png

A imagem editorial respondeu HTTP 200 ao cliente HTTP, com PNG válido de 660 × 1.008 pixels/189.992 bytes. No Chromium, tanto em about:blank quanto em documento de teste na origem DEV, a requisição real falhou por **net::ERR_CERT_AUTHORITY_INVALID**, complete=true/naturalWidth=0. Download HTTP 200 não foi contado como aprovação visual. Não foram desativadas validações TLS nem alterada a confiança de certificados. A página editorial respondeu com User-Agent de navegador; uma tentativa sem ele recebeu HTTP 403, outra limitação de acesso identificada.

Artefato local das consultas: `/workspace/live-shared-isbn-results.json`. O acesso à página real DEV continua HTTP 401 nesta sessão; os testes do formulário usam a distribuição local interceptada e dados descartáveis.

## Testes automatizados

147 testes backend aprovados em Node 22 e 24 (135 da base e 12 de ISBN). 58 cenários Playwright/Chromium: 8 de ISBN compartilhado, 6 catálogo, 5 diagnóstico, 6 primeiro acesso, 7 WebAuthn e 26 regressão do protótipo. Build aprovado. index.html, backend Google e schemas permanecem iguais à base dev após PR #16.

Testes novos cobrem fontes/edições, normalização, HTTP 429, payload inválido/excessivo, timeout/cancelamento, cache/deduplicação/concorrência, sessão/CSRF, quotas persistentes separadas do login, fórmula/URL insegura, seleção da primeira capa efetivamente carregada, placeholder 1px, capa externa/campos existentes preservados, Enter/leitor USB, fechamento/consulta cancelada/ISBN alterado e gravação/recarga dos metadados/link.

Nas suítes automatizadas, APIs bibliográficas, Google/MailApp e imagens externas são **fixtures explícitas**; metadados gerados não são atribuídos a livros reais. A entrega tardia usa o handler real e retém apenas a entrega da resposta na fixture do navegador. Captura local `/workspace/qa-v17-owner-access/isbn-compartilhado-formulario.png` mostra uma imagem gerada, não a capa editorial real. A persistência no formulário é validada em armazenamento Google descartável/emulado, sem dados reais de cliente/venda.

Comandos: npm test; npm run build; npm run test:isbn; npm run test:catalog; npm run test:diagnostics; npm run test:access; npm run test:passkeys; ZXING_JS=<arquivo verificado> npm run test:browser.

## Atualização desta rodada: cópia editorial local e teste aprofundado

[QA_CAPAS_HARDENING.md](QA_CAPAS_HARDENING.md) registra a correção do bloqueio de carregamento da capa conhecida por meio de uma cópia editorial verificada no build. As medições/tabela anteriores documentam as tentativas remotas originais. A capa de 9788543303932 agora carrega efetivamente pela mesma origem; o ISBN 9786589806691 continua sem capa automática e usa a alternativa manual. O PR #17 também inclui câmera/galeria no protótipo e correção de confirmação indevida com localStorage cheio.
