# Diagnóstico real e correção da capa — 9788543303932

## Resultado

A falha relatada foi reproduzida com respostas reais: o formulário preenchia título e autor, mas não recebia imagem. A correção inclui a capa editorial verificada na referência específica já existente e permite que essa referência participe da seleção/validação de capas, depois das fontes bibliográficas.

Não há scraping no cadastro nem um banco fictício de capas. O URL foi obtido da página pública oficial que já era referenciada no código, e foi verificado manualmente nesta investigação. A imagem só é aceita pelo mecanismo existente quando carrega e passa na validação. Se a imagem editorial ficar indisponível, continua sendo exibida a opção de cadastro sem capa.

## Causa observada nas fontes reais

| Fonte para 9788543303932 | Resposta real |
| --- | --- |
| BrasilAPI/CBL | HTTP 200, título e autor; `cover_url: null`; formato `DIGITAL` |
| BrasilAPI/Mercado Editorial | HTTP 404 |
| Google Books | HTTP 429, quota diária de consultas excedida (`RESOURCE_EXHAUSTED`) |
| Open Library catálogo | HTTP 200, objeto vazio |
| Open Library edição | HTTP 404 |
| Open Library Covers | HTTP 404 |
| Mundo Cristão, página editorial e imagem | HTTP 200; ISBN confirmado na página; PNG 660×1008 |

Página editorial: https://www.mundocristao.com.br/produto/examinando-as-escrituras/

Imagem oficial: https://www.mundocristao.com.br/wp-content/uploads/2021/12/Examinando-as-escrituras.png

O código tinha a referência do título, com `capaUrl` vazio, e não incluía a referência na chamada de `buscarCapa`. Por isso, a imagem disponível no site oficial não podia ser aproveitada. CBL, Mercado Editorial e Google Books são fontes externas independentes: receber metadados não significa receber a capa.

## Antes e depois no Chromium

| ISBN | Livro | Fonte dos dados | Fonte da capa | Imagem carregou? | Persistiu? |
| --- | --- | --- | --- | --- | --- |
| 9788543303932 — antes | Examinando as escrituras | CBL + referência editorial | Nenhuma | Não | Não salvo |
| 9788543303932 — corrigido, digitado | Examinando as escrituras | CBL + referência editorial | Mundo Cristão oficial | Sim, `complete=true`, `naturalWidth=660`, `naturalHeight=1008` | Sim |
| 9788543303932 — corrigido, imagem EAN-13 | Examinando as escrituras | CBL + referência editorial | Mundo Cristão oficial | Sim, mesmas dimensões | Sim |
| 9788543303550 — controle | Ande com fé | CBL | Nenhuma das fontes consultadas | Não | Não salvo |

O controle foi confirmado na página editorial https://www.mundocristao.com.br/produto/ande-com-fe/. Sua CBL também não retornou capa, Mercado Editorial/edição Open Library/Covers retornaram 404, catálogo Open Library veio vazio e Google Books retornou 429. Não foi acrescentado um fallback para esse segundo livro, evitando confundir a correção específica com cobertura universal do catálogo.

Nos dois cadastros bem-sucedidos, foram usados contextos novos e descartáveis. Após salvar com fornecedor/preço fictícios, a página foi recarregada e a capa e sua origem permaneceram salvas. A imagem carregada foi conferida no Catálogo, nos detalhes, nos resultados do Caixa e no carrinho. Nenhum cliente ou venda foi criado, e nenhum cadastro compartilhado foi modificado. O PNG de código de barras foi gerado localmente, com ISBN real, e decodificado pelo ZXing real; não se trata de leitura por câmera física.

Evidências:

- [Formulário com a capa oficial](evidencias-capas/formulario-9788543303932.png).
- [Catálogo após salvar e recarregar](evidencias-capas/catalogo-9788543303932.png).
- [Valores e respostas reais registrados](evidencias-capas/resultados-reais.json).

## Método e limites

As restrições de rede da primeira tentativa deixaram de impedir as consultas. Foram realizadas novas requisições reais, com verificação TLS ativa, sem respostas simuladas, imagens substitutas ou desativação de certificados.

O DEV publicado continuou indisponível para acesso autorizado nesta sessão (HTTP 401), e o Chromium tem um problema de confiança no certificado do proxy. Para testar a aplicação com dados reais sem alterar o armazenamento de certificados, o checkout foi servido localmente e as requisições HTTPS do navegador foram encaminhadas ao upstream real por `APIRequestContext` do Playwright, usando o proxy e a confiança TLS já configurados nesse cliente. Status, cabeçalhos e bytes reais foram repassados ao navegador; não foram usados fixtures nessa etapa.

Isso comprova obtenção, decodificação, renderização e persistência da imagem real no protótipo local. Não comprova o acesso direto do navegador do usuário aos serviços, o deploy Netlify ou o comportamento de cache/CORS sem esse encaminhamento. A liberação do PR e um teste no DEV publicado pelo responsável continuam necessários.

A CBL identifica o ISBN consultado como DIGITAL; a própria página da editora apresenta esse ISBN e essa capa. O usuário deve conferir se o código pertence à edição efetivamente cadastrada. A solução não deve trocar automaticamente por um ISBN físico diferente.

## Regressão

A suíte completa passou com **26 testes Playwright/Chromium**. Os dois testes novos cobrem o fallback editorial e a indisponibilidade da imagem oficial; são testes simulados, separados da validação real acima. PINs, leitor, capas alternativas, persistência, Estoque, Caixa, Catálogo, Relatórios e indicador DEV permanecem cobertos.

## Próximos passos para outros livros

Esta correção resolve a referência verificada de 9788543303932. Não promete imagens para todo ISBN. Quando nenhuma fonte fornece capa, é necessário usar uma fonte editorial autorizada/verificada ou a foto manual. Para melhorar a cobertura automática de forma geral, é necessário tratar a disponibilidade/quota do Google Books e avaliar uma integração bibliográfica/editorial autorizada. O aplicativo não deve inventar imagens nem usar capa de outra edição silenciosamente.
