// One build-time header shared by every internal DEV page. No runtime lookup.
export function renderAppHeader(html,file){
 if(!file.endsWith('-dev.html')||file==='acesso-dev.html')return html;
 const match=html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i);if(!match)throw Error('Missing module header: '+file);
 let content=match[1].replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi,'').replace(/<a\b[^>]*class="[^"]*(?:church-brand|home-brand|brand)[^"]*"[^>]*>[\s\S]*?<\/a>/gi,'').replace(/<div class="module-brand-row">[\s\S]*?<\/div>/g,'').replace(/<div class="header-end">[\s\S]*?<\/div>/g,'').replace(/<a\b[^>]*class="home-link"[^>]*>[\s\S]*?<\/a>/g,'');
 // Headings remain in the document and keep their IDs used by page controllers.
 const heading=/<h1\b/i.test(content)?'<section class="module-page-heading">'+content+'</section>':'';
 html=html.replace(match[0],heading);
 const id=file==='home-dev.html'?'account-navigation':['catalogo-dev.html','caixa-dev.html'].includes(file)?'module-account':'app-navigation';
 const header=`<header class="app-topbar" data-app-header><div class="app-topbar-inner"><a class="church-brand" href="/home-dev.html" aria-label="Livraria IPB — Início"><img class="church-brand-logo" src="/brand/ipb-jardim-bonfiglioli.png" width="252" height="81" alt="Igreja Presbiteriana JD Bonfiglioli"></a><nav id="${id}" class="app-navigation" aria-label="Navegação da livraria" hidden><a class="app-home-link" href="/home-dev.html">Início</a><details class="module-menu"><summary>Catálogo</summary><div class="account-options"><a href="/catalogo-dev.html">Pesquisar produto</a><a href="/catalogo-dev.html?novo=1">Adicionar novo produto</a><a href="/nichos-dev.html" data-navigation-admin hidden>Organizar nichos</a></div></details><details class="module-menu"><summary>Rotina</summary><div class="account-options"><a href="/caixa-dev.html">Nova compra</a><a href="/operacoes-dev.html">Histórico e operações</a><a href="/notificacoes-dev.html">Notificações</a><a href="/escalas-dev.html">Escalas</a></div></details><details class="account-menu"><summary aria-label="Abrir menu da conta"><span data-account-avatar>Conta</span></summary><div class="account-options"><a href="/meu-perfil-dev.html">Meu perfil</a><a href="/equipe-dev.html" data-navigation-admin hidden>Gerenciar equipe</a><a href="/relatorios-dev.html" data-navigation-admin hidden>Relatórios</a><button type="button" data-account-logout>Sair</button><p role="status" data-account-status hidden></p></div></details></nav></div></header>`;
 html=html.replace(/(<body\b[^>]*>)/i,'$1'+header);
 if(!html.includes('href="/account-menu.css"'))html=html.replace('</head>','<link rel="stylesheet" href="/account-menu.css"></head>');
 if(file!=='home-dev.html'&&!html.includes('src="/account-menu.js"'))html=html.replace('</head>','<script src="/account-menu.js" defer></script></head>');
 return html;
}
