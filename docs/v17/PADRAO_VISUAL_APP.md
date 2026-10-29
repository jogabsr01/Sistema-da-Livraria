# Padrão visual do app

A Home define a identidade das 14 telas DEV do sistema. `app-theme.css` reúne a paleta, superfícies, tipografia, campos, botões, menus, foco de teclado e comportamento de movimento reduzido. Cada módulo mantém seu CSS de layout e seus controles de acesso. O tema é local: não baixa fontes ou imagens de serviços externos.

A direção visual usa papel claro, verde profundo e dourado de lombada. Títulos editoriais em Georgia convivem com fontes de sistema nos campos e textos operacionais. O símbolo de livro e as lombadas decorativas da Home são SVG/CSS sem conteúdo necessário à operação. A interface diferencia ações principais, secundárias, estados desabilitados e mensagens de erro. Não usar cor como único indicador de resultado.

“Nova compra” e “Pesquisar produto” continuam as primeiras ações. Em celular ficam empilhadas, com descrições curtas e ícones próprios; ambas foram verificadas acima da dobra entre 320×480 e 390×844. Em desktop aparecem lado a lado. “Adicionar novo produto” vem abaixo e os demais atalhos seguem em grade com rolagem normal. Texto ampliado e telas menores continuam podendo rolar: não cortar conteúdo para forçar um encaixe.

O endereço raiz do domínio exato `dev--merry-chimera-49a1f3.netlify.app` redireciona para `/home-dev.html` com 302. O protótipo permanece acessível em `/index.html`; as ligações que antes apontavam à raiz para abri-lo foram corrigidas. Os cabeçalhos dos módulos oferecem “Início”; a marca também retorna à Home. O redirecionamento não corresponde a outros domínios.

## Continuidade

Novas telas do app devem carregar `/app-theme.css` após seus estilos de módulo e usar `app-shell` no body. Respeitar as classes de variante existentes e `[hidden]`, rótulos acessíveis, foco visível, navegação por teclado e `prefers-reduced-motion`. Aumentar o destaque por hierarquia e espaçamento; evitar animações decorativas, excesso de cores e dependências externas. As regras de layout, autorização e confirmação de operações permanecem nos módulos.

## Verificação

`test-app-design.py` percorre as 14 telas em viewport móvel, confere o carregamento do tema e a ausência de rolagem horizontal, além de teclado e movimento reduzido. A suíte da Home verifica ações acima da dobra, busca e câmera. Os fluxos de acesso, catálogo, venda e perfil foram exercitados com o tema carregado. Capturas locais em `work/qa-home`, `work/qa-profile` e `/workspace/qa-v17-owner-access` servem para revisão visual; os dados das capturas são fictícios dos emuladores.
