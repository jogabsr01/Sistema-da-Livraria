# Investigação do aviso “listeners” no protótipo DEV

O diagnóstico enviado pelo proprietário contém duas ocorrências de `Cannot read properties of undefined (reading 'listeners')`, no Chrome 154/macOS, acima do cabeçalho. O relatório antigo só copiava a mensagem; não incluía arquivo, linha ou pilha. Não permite atribuir a origem a uma extensão específica ou ao código publicado.

## Achado confirmado e limite da conclusão

Nem index.html nem a biblioteca ZXing usada pelo protótipo acessam uma propriedade `listeners`. Porém, o emulador local sobrescrevia **todo** `window.google` ao inicializar. Qualquer script que mantivesse estado nesse namespace poderia perder suas propriedades. Também falhava ao iniciar quando outro script definia o namespace como somente leitura.

Foi reproduzido um conflito controlado no Chromium: um hook fictício previamente instalado em `window.google.browserHook.listeners` é perdido pela versão atual da branch dev. Seu callback então lança exatamente o TypeError informado e ativa a faixa. Com o transporte isolado, o mesmo callback termina sem erro nem faixa. **O hook é uma fixture de teste explícita; isso não identifica a extensão ou o script existente no navegador do proprietário.**

O proprietário informou que o aviso **não aparece em janela anônima**. Isso reforça uma diferença de contexto da janela normal (scripts/extensões/dados), sem identificar um componente específico.

O acesso direto ao DEV desta sessão continua retornando HTTP 401, sem permitir inspecionar o HTML/contexto efetivamente executado no Chrome do proprietário. Nenhum reset, leitura ou edição do armazenamento desse navegador foi realizado.

## Alteração preparada

- O transporte da demonstração passa a ser `DemoRPC`, em escopo próprio da página, sem criar, ler como transporte ou sobrescrever `window.google`/`google.script.run`. Cadastro, PINs, Caixa, Catálogo, Estoque e Relatórios continuam usando o mesmo dispatcher local. O backend verificado compartilhado permanece separado.
- “Copiar diagnóstico” passa a informar versão do relatório, origem/caminho da página, arquivo, linha, coluna e pilha, quando fornecidos pelo navegador. Rejeições assíncronas preservam o objeto Error. Origens desconhecidas continuam identificadas como desconhecidas; não se adivinha qual extensão está instalada.
- Erros reais continuam exibidos, inclusive quando contêm a palavra `listeners`. Não há filtro genérico para esconder esse erro. Falhas simples de carregamento de imagens/recursos seguem o tratamento existente.
- O relatório limita quantidade e tamanho dos registros e remove query strings, fragmentos, credenciais de URLs e data URLs. Não coleta o banco local, PINs ou configurações privadas.
- Não muda chaves/formatos de armazenamento nem executa reinicialização de dados. Não altera main, produção ou configurações Google/Netlify.

## Testes

Cinco cenários Playwright/Chromium verificam coexistência com namespace/hook existente nos dois logins demonstrativos; namespace somente leitura e cadastro/persistência local; inicialização sem criar o global Google nem apagar armazenamento alheio; erro externo controlado com a mesma mensagem, pilha/localização e URL privada removida; erro da página/rejeição assíncrona preservados no diagnóstico. Os hooks e erros externos são fixtures explícitas.

Regressão do protótipo: `npm run test:browser` (26 cenários, incluindo celular, venda, catálogo, estoque, relatórios, câmera/galeria e ISBN). Backend: `npm test` (135 testes da base dev). Build: `npm run build`. Diagnóstico: `npm run test:diagnostics`. Os testes usam dados descartáveis e serviços externos simulados; não validam a conta Google nem extensões reais.

## Conferência pelo proprietário após aprovação/merge em dev

1. Abrir https://dev--merry-chimera-49a1f3.netlify.app e atualizar a página. Não usar “Reiniciar somente dados de teste”.
2. Entrar e repetir a ação em que a faixa apareceu; conferir os cadastros existentes.
3. Se a faixa reaparecer, clicar “Copiar diagnóstico” e enviar o relatório que começa com **diagnóstico v2**. Ele permitirá localizar o script/linha. Não enviar PIN, cookies ou chaves.
4. Como comparação opcional antes/depois, abrir o mesmo endereço numa janela anônima. Isso não apaga os dados da janela normal. Ausência do aviso ali sugere diferença de contexto/extensões/dados, sem provar qual componente causou a falha.

Este ajuste deve seguir em PR próprio direcionado a dev e aguardar aprovação para merge. O PR #15 de fotos permanece separado e não foi integrado automaticamente.
