# Teste aprofundado de capas — protótipo e catálogo DEV

Autorização: testar com maior rigor, corrigir, publicar o PR #17 somente em dev e continuar as implementações. O incremento inclui o componente de câmera/galeria anteriormente separado no PR #4, pois ele atende a alternativa segura quando não existe capa automática. Main e produção não são alteradas. O PR #15 de fotos privadas Google permanece uma próxima integração, não uma ativação implícita do Google real.

## Resultado verificável

| ISBN | Livro | Fonte dos dados/capa | Imagem carregou? | Persistiu e reapareceu? |
| --- | --- | --- | --- | --- |
| 9788543303932 | Examinando as escrituras — Charles R. Swindoll | Referência editorial Mundo Cristão e cópia local da imagem oficial, conferida pelo ISBN da página editorial | **Sim: complete=true, naturalWidth=660, naturalHeight=1008** | **Sim no protótipo descartável**, após recarga, no Catálogo, detalhes, Frente de Caixa e carrinho; catálogo compartilhado também testado com essa imagem e armazenamento emulado |
| 9786589806691 | Mulher real — Junia Hayashi — Quatro Ventos | CBL fornece metadados, sem capa; fontes automáticas acessíveis continuam sem imagem válida | **Não automaticamente**. Alternativa manual por câmera/galeria testada, com imagem sintética explicitamente identificada | Foto manual persistiu e reapareceu após recarga/carrinho no teste descartável; isso **não é evidência de que uma capa editorial desse ISBN foi encontrada** |

O caminho manual aceita foto do próprio exemplar em vez de associar uma imagem de outra edição. Não há promessa de encontrar automaticamente uma capa que as fontes não disponibilizam. Não se usa imagem genérica para declarar o livro aprovado.

## Cópia editorial real, sem dependência do certificado da editora no navegador

Página oficial: https://www.mundocristao.com.br/produto/examinando-as-escrituras/ (ISBN visível **978-8543303932**).

Imagem original: https://www.mundocristao.com.br/wp-content/uploads/2021/12/Examinando-as-escrituras.png

A imagem original respondeu HTTP 200 ao cliente HTTP com TLS verificado; é um PNG de **189.992 bytes**, **660 × 1.008 pixels**. Foi copiada sem edição para `public/covers/9788543303932-f4aea498fff4b981.png`.

SHA-256: `f4aea498fff4b9811d239cc9e0604762bcfc3419a391706c49649a183e692b55`.

Referência e integridade: data/editorial-covers.json. O build confere ISBN/dígito verificador, nome/hash, tamanho, assinatura PNG, dimensões, limites, duplicidade e caminhos. Recusa symlinks, travessia de diretórios e bytes divergentes. Só publica os arquivos explicitamente referenciados e um mapa mínimo; nenhuma ferramenta de teste, documentação, segredo ou código Google é exposto.

O endereço da aplicação é `/covers/9788543303932-f4aea498fff4b981.png`, servido na mesma origem com nosniff, CORP same-origin e cache immutable por hash. O mapa de referências tem no-cache. A imagem só é solicitada ao consultar/exibir esse livro; o carregamento inicial adiciona somente o pequeno mapa local. Não há proxy que aceite URLs arbitrárias nem download dinâmico de imagens no servidor, portanto não foi criada uma superfície SSRF ou decoder público.

As duas interfaces priorizam essa cópia local; se ela não carregar, continuam os candidatos remotos. A capa corrupta é recusada mesmo com HTTP 200. O catálogo compartilhado continua verificando pixels antes de usar a imagem. O artefato não depende de CORS, hotlink ou certificado remoto da editora em cada exibição. A origem editorial permanece identificada e a associação não é generalizada para outros ISBNs.

## Execução com requisições reais aos provedores

No experimento separado, o Chromium executou o HTML real de dist. Só documento/arquivos próprios e a versão verificada de ZXing foram servidos por interceptação local, pois o site DEV externo retorna HTTP 401 nesta sessão. **As consultas aos provedores não foram simuladas**: elas falharam por ERR_CERT_AUTHORITY_INVALID neste Chromium. O fluxo usou a referência editorial claramente identificada, carregou o PNG oficial local, salvou em localStorage descartável e o recuperou no Catálogo/carrinho. Nenhuma validação TLS foi desativada nem confiança de certificados alterada.

Tempo observado desse fluxo completo de consulta, prévia, preenchimento de teste, salvamento, recarga, Catálogo e carrinho: **1.611 ms**. Esse valor é uma observação do build local com falhas rápidas dos provedores, não um benchmark do site publicado ou de todos os cenários de rede. As provas locais estão em `/workspace/qa-capas-hard-live/resultado.json`.

Capturas com a **capa editorial real**, sem dados de clientes reais:

- `/workspace/qa-capas-hard-live/formulario-capa-editorial-real.png`
- `/workspace/qa-capas-hard-live/catalogo-capa-editorial-real.png`

O domínio da editora Quatro Ventos, buscas públicas e Mercado Editorial direto não foram acessíveis por este ambiente (403 no túnel). Não se inventou URL de capa para Mulher real. As consultas reais anteriores CBL/Google/Open Library estão documentadas em ISBN_COMPARTILHADO_DEV.md; fotos da câmera virtual não são atribuídas à editora.

## Bug de armazenamento corrigido

O protótipo ignorava exceções de localStorage.setItem e podia informar sucesso mesmo com quota cheia. Agora mantém o último estado confirmado em memória; se a gravação falhar, restaura esse estado e retorna erro. O formulário/foto continuam abertos e os dados anteriores do armazenamento permanecem intactos. Após recuperar a capacidade de gravação, repetir o pedido cria um único cadastro. Não há limpeza automática ou reset de dados.

O teste força QuotaExceededError, comprova ausência de novo produto/recibo de sucesso, igualdade dos dados anteriores e manutenção do formulário; depois reabilita a gravação, salva e confirma persistência após recarga. Esse ajuste se aplica ao banco demonstrativo, não equivale à implementação da fila offline completa do V17.

## Regressão e cenários adversos

**151 testes backend aprovados em Node 22 e 24; 74 cenários Chromium aprovados**, além do experimento com provedores reais:

- 34 do protótipo, incluindo oito casos de webcam/galeria antes separados no PR #4.
- Oito de hardening: capa editorial real em desktop/celular, catálogo/detalhes/Caixa/carrinho/recarga, quota cheia com retomada, imagem corrompida, câmera para ISBN sem capa, arquivo de galeria inválido e 20 ciclos abrir/fechar câmera com todos os tracks em ended.
- Oito ISBN compartilhado, seis catálogo, cinco diagnóstico, seis primeiro acesso e sete WebAuthn.

Os testes automatizados de APIs usam fixtures explícitas. A imagem editorial servida nos casos de cache é o PNG real conferido, não uma imagem gerada. O cenário de Mulher real usa replay dos metadados públicos capturados e vídeo sintético do Chromium; não afirma validação da webcam física do proprietário.

Os 20 ciclos de câmera terminaram com tracks liberados; uma execução sob as demais suítes em paralelo levou 3.618 ms. Metadados, preço, nichos e capa existente são preservados em erro/cancelamento. PINs, Caixa, Estoque, Relatórios, leitura de código e proteção contra o conflito listeners continuam cobertos.

Comandos: npm test; npm run build; npm run test:browser; npm run test:cover-hardening; npm run test:isbn; npm run test:catalog; npm run test:diagnostics; npm run test:access; npm run test:passkeys. Para as suítes de código/câmera, usar ZXING_JS apontando para a versão verificada. As imagens/reportes locais de teste não são publicados pelo build.

## Publicação e próximos passos

A autorização desta rodada cobre o PR #17 endurecido e a alternativa de câmera/galeria incluída nele. O merge deve ser exclusivamente em dev após o novo preview passar. Não confundir aprovação do build com validação do site real ou com ativação do backend Google: a inspeção externa continua HTTP 401, e as flags reais permanecem fechadas.

Após a integração, seguir com a combinação de fotos privadas do PR #15 com o catálogo/consulta atuais, repetindo a preservação de foto manual durante respostas tardias. Não publicar esse próximo PR sem a aprovação específica prevista pelo fluxo anterior. O lote Google real e a homologação por dois aparelhos continuam pendentes; os testes não gravam dados compartilhados.

Livros antigos sem capa também podem usar **Buscar capa pelo ISBN** dentro do formulário de edição. A ação só prepara uma capa quando os campos de imagem estão vazios; não altera título, preço ou saldo, exige Salvar para persistir e descarta resultados após foto/link manual ou fechamento. O teste cria um cadastro sem capa, busca a cópia verificada, salva, recarrega e comprova um único produto com estoque preservado e imagem no carrinho.
