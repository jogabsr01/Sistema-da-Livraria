// Explicit provider doubles. These responses are not live editorial evidence.
export function isbnProviderFixture(mode='normal',calls=[]) {
  return async(input,options={})=>{
    const url=new URL(input),isbn=url.hostname==='brasilapi.com.br'?url.pathname.split('/').at(-1):url.hostname==='www.googleapis.com'?url.searchParams.get('q').slice(5):url.pathname.startsWith('/isbn/')?url.pathname.split('/').at(-1).replace('.json',''):url.searchParams.get('bibkeys').slice(5);
    calls.push({url:url.href,options});
    const wrong='9780306406157',match=mode==='wrong'?wrong:isbn;
    let value={},status=200;
    if(mode==='empty')status=404;
    else if(url.hostname==='brasilapi.com.br') {
      if(url.searchParams.get('providers')==='cbl')value={isbn:match,title:'Livro cristão fictício para QA',authors:['Autor fictício'],publisher:'Editora fictícia',year:2023,page_count:170,cover_url:mode==='broken'?'https://covers.example.org/missing.png':null};
      else value={isbn:match,title:'Título alternativo',edition:'2ª edição',cover_url:'https://covers.example.org/missing.png'};
    } else if(url.hostname==='www.googleapis.com'){
      if(mode==='rate-limited')status=429;
      else value={items:[{volumeInfo:{title:'Título Google',industryIdentifiers:[{identifier:match}],imageLinks:{thumbnail:mode==='normal'?'http://books.google.com/fixture-cover.png':'https://covers.example.org/missing.png'},description:'<b>Sinopse de teste</b>'}}]};
    } else if(url.pathname.startsWith('/api/'))value=mode==='wrong'?{['ISBN:'+isbn]:{title:'Edição errada',identifiers:{isbn_13:[wrong]},cover:{large:'https://covers.example.org/wrong.png'}}}:{};
    else value={title:'Título Open',isbn_13:[match],covers:mode==='open'?[123456]:[]};
    return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  };
}
