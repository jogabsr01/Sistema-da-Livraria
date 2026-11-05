// One build-time header shared by every internal DEV page. No runtime lookup.
export function renderAppHeader(html,file){
 if(!file.endsWith('-dev.html')||file==='acesso-dev.html')return html;
 const match=html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i);if(!match)throw Error('Missing module header: '+file);
 let content=match[1].replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi,'').replace(/<a\b[^>]*class="[^"]*(?:church-brand|home-brand|brand)[^"]*"[^>]*>[\s\S]*?<\/a>/gi,'').replace(/<div class="module-brand-row">[\s\S]*?<\/div>/g,'').replace(/<div class="header-end">[\s\S]*?<\/div>/g,'').replace(/<a\b[^>]*class="home-link"[^>]*>[\s\S]*?<\/a>/g,'');
 // Headings remain in the document and keep their IDs used by page controllers.
 const heading=/<h1\b/i.test(content)?'<section class="module-page-heading">'+content+'</section>':'';
 html=html.replace(match[0],heading);
 const id=file==='home-dev.html'?'account-navigation':['catalogo-dev.html','caixa-dev.html'].includes(file)?'module-account':'app-navigation';
 const icon=path=>`<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
 const book=icon('M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z M4 5v16'),calendar=icon('M4 5h16v15H4z M8 3v4 M16 3v4 M4 9h16'),person=icon('M20 21a8 8 0 0 0-16 0 M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8'),people=icon('M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7'),chart=icon('M4 20h16 M5 17V9h3v8 M11 17V4h3v13 M17 17v-6h3v6');
 const header=`<header class="app-topbar" data-app-header><div class="app-topbar-inner"><a class="church-brand" href="/home-dev.html" aria-label="Livraria IPB — Início"><img class="church-brand-logo" src="/brand/ipb-jardim-bonfiglioli.png" width="252" height="81" alt="Igreja Presbiteriana JD Bonfiglioli"></a><button class="app-menu-toggle" type="button" aria-controls="${id}" aria-expanded="false" aria-label="Abrir navegação">${icon('M4 6h16 M4 12h16 M4 18h16')} Menu</button><nav id="${id}" class="app-navigation" aria-label="Navegação da livraria" hidden><a class="app-home-link" href="/home-dev.html">Início</a><details class="module-menu"><summary>${book}Catálogo</summary><div class="account-options"><a href="/catalogo-dev.html">Pesquisar produto</a><a href="/catalogo-dev.html?novo=1">Adicionar novo produto</a></div></details><details class="module-menu"><summary>${calendar}Rotina</summary><div class="account-options"><a href="/caixa-dev.html">Nova compra</a><a href="/operacoes-dev.html">Histórico e operações</a><a class="app-notification-link" href="/notificacoes-dev.html">Notificações <span data-notification-count></span></a><a href="/escalas-dev.html">${calendar}Minhas escalas</a><a href="/nichos-dev.html" data-navigation-admin hidden>Organizar nichos</a></div></details><details class="account-menu"><summary aria-label="Abrir menu da conta"><span data-account-avatar>Conta</span></summary><div class="account-options"><a href="/meu-perfil-dev.html">${person}Meu perfil</a><a href="/escalas-dev.html">${calendar}Minha escala</a><a href="/equipe-dev.html" data-navigation-admin hidden>${people}Gerenciar equipe</a><a href="/relatorios-dev.html" data-navigation-admin hidden>${chart}Relatórios</a><a href="/clientes-compras-dev.html" data-navigation-admin hidden>${people}Relatório de clientes</a><button type="button" data-account-logout>Sair</button><button type="button" data-account-logout-retry hidden>Tentar sair novamente</button><p role="status" data-account-status hidden></p></div></details></nav></div></header>`;
 const home=icon('M3 11 12 3l9 8 M5 10v10h14V10 M9 20v-6h6v6');
 const search=icon('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M17 17l4 4');
 const add=icon('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 8v8 M8 12h8');
 const cart=icon('M3 4h2l2 11h11l3-8H6 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2 M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2');
 const history=icon('M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9 M12 7v5l3 2');
 const bell=icon('M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9 M10 20a2 2 0 0 0 4 0');
 const grid=icon('M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z');
 const decoratedHeader=header.replace('>Início</a>','>'+home+'Início</a>')
  .replace('>Pesquisar produto</a>','>'+search+'Pesquisar produto</a>')
  .replace('>Adicionar novo produto</a>','>'+add+'Adicionar novo produto</a>')
  .replace('>Nova compra</a>','>'+cart+'Nova compra</a>')
  .replace('>Histórico e operações</a>','>'+history+'Histórico e operações</a>')
  .replace('>Notificações <span','>'+bell+'Notificações <span')
  .replace('>Organizar nichos</a>','>'+grid+'Organizar nichos</a>');
 html=html.replace(/(<body\b[^>]*>)/i,'$1'+decoratedHeader);
 if(!html.includes('href="/account-menu.css"'))html=html.replace('</head>','<link rel="stylesheet" href="/account-menu.css"></head>');
 if(file!=='home-dev.html'&&!html.includes('src="/account-menu.js"'))html=html.replace('</head>','<script src="/account-menu.js" defer></script></head>');
 return html;
}
