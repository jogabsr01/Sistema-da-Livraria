// Public bibliographic data only. Fixed provider URLs; no caller URLs, cookies,
// Google installation credentials, customer data or redirects are forwarded.
import { ApiError } from './errors.mjs';
import { normalizedIsbn, normalizedCover } from './catalog-model.mjs';
// ISBN/edition confirmed on the publisher page on 2026-10-23. A curated
// candidate, never attributed to an API and never presumed to load successfully.
const EDITORIAL_COVERS = Object.freeze({
  '9788543303932':Object.freeze({url:'https://www.mundocristao.com.br/wp-content/uploads/2021/12/Examinando-as-escrituras.png',source:'Referência editorial (Mundo Cristão)',referenceUrl:'https://www.mundocristao.com.br/produto/examinando-as-escrituras/'}),
});
const MAX_BYTES=196608, FIELDS=['title','author','publisher','edition','year','pages','synopsis'];
function sameIsbn(value,isbn) { try { return normalizedIsbn(value) === isbn; } catch { return false; } }
function text(value,max) {
  if(typeof value!=='string')return '';
  const clean=value.replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
  return /^[=+@-]/.test(clean)?'':clean;
}
const names=(value,max)=>text(Array.isArray(value)?value.filter(item=>typeof item==='string'||item&&typeof item.name==='string').map(item=>typeof item==='string'?item:item.name).join(', '):value,max);
function coverUrl(value) {
  if(typeof value!=='string')return '';
  try { const url=new URL(value);if(url.protocol==='http:' && ['books.google.com','books.google.com.br','covers.openlibrary.org'].includes(url.hostname))url.protocol='https:';return normalizedCover(url.href); } catch { return ''; }
}
function metadata(value) {
  const year=String(value.year||'').match(/\b(\d{4})\b/), number=Number(year?.[1]);
  return {title:text(value.title,300),author:names(value.author,300),publisher:names(value.publisher,160),edition:text(value.edition,80),
    year:number>=1000&&number<=3000?number:0,pages:Number.isSafeInteger(value.pages)&&value.pages>0&&value.pages<=100000?value.pages:0,synopsis:text(value.synopsis,5000)};
}
function brasil(value,isbn) {
  if(!value || typeof value!=='object' || !sameIsbn(value.isbn||value.isbn13||value.isbn_13,isbn))return null;
  return {record:metadata({title:value.title,author:value.authors,publisher:value.publisher,edition:value.edition||value.edition_name,year:value.year,pages:value.page_count,synopsis:value.synopsis}),covers:[value.cover_url,value.coverUrl]};
}
function google(value,isbn) {
  const info=(Array.isArray(value?.items)?value.items.slice(0,5):[]).find(item=>Array.isArray(item?.volumeInfo?.industryIdentifiers)&&item.volumeInfo.industryIdentifiers.some(id=>sameIsbn(id?.identifier,isbn)))?.volumeInfo;
  if(!info)return null;
  return {record:metadata({title:info.title,author:info.authors,publisher:info.publisher,year:info.publishedDate,pages:info.pageCount,synopsis:info.description}),covers:['large','medium','thumbnail','smallThumbnail'].map(key=>info.imageLinks?.[key])};
}
function openCatalog(value,isbn) {
  const book=value?.['ISBN:'+isbn];if(!book || typeof book!=='object')return null;
  const ids=[...(Array.isArray(book.identifiers?.isbn_13)?book.identifiers.isbn_13:[]),...(Array.isArray(book.identifiers?.isbn_10)?book.identifiers.isbn_10:[])];
  if(ids.length&&!ids.some(id=>sameIsbn(id,isbn)))return null;
  return {record:metadata({title:book.title,author:book.authors,publisher:book.publishers,edition:book.edition_name,year:book.publish_date,pages:book.number_of_pages}),covers:[book.cover?.large,book.cover?.medium,book.cover?.small]};
}
function openEdition(value,isbn) {
  const ids=[...(Array.isArray(value?.isbn_13)?value.isbn_13:[]),...(Array.isArray(value?.isbn_10)?value.isbn_10:[])];
  if(!ids.some(id=>sameIsbn(id,isbn)))return null;
  return {record:metadata({title:value.title,publisher:value.publishers,edition:value.edition_name,year:value.publish_date,pages:value.number_of_pages,synopsis:typeof value.description==='string'?value.description:value.description?.value}),
    covers:(Array.isArray(value.covers)?value.covers:[]).slice(0,4).filter(id=>Number.isSafeInteger(id)&&id>0).map(id=>`https://covers.openlibrary.org/b/id/${id}-M.jpg?default=false`)};
}
export function isbnProviders(isbn) {
  const root='https://brasilapi.com.br/api/isbn/v1/'+isbn;
  return [
    {name:'BrasilAPI (CBL)',url:root+'?providers=cbl',normalize:brasil},
    {name:'BrasilAPI (Mercado Editorial)',url:root+'?providers=mercado-editorial',normalize:brasil},
    {name:'Google Books',url:'https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent('isbn:'+isbn)+'&maxResults=5&printType=books',normalize:google},
    {name:'Open Library (catálogo)',url:'https://openlibrary.org/api/books?bibkeys='+encodeURIComponent('ISBN:'+isbn)+'&jscmd=data&format=json',normalize:openCatalog},
    {name:'Open Library (edição)',url:'https://openlibrary.org/isbn/'+isbn+'.json',normalize:openEdition},
  ];
}
async function providerFetch(provider,isbn,fetchImpl,timeoutMs) {
  const controller=new AbortController();let timer;
  const unavailable=status=>({source:{name:provider.name,status},book:null});
  try {
    return await Promise.race([
      (async()=>{
        const response=await fetchImpl(provider.url,{method:'GET',redirect:'manual',signal:controller.signal,headers:{accept:'application/json'}});
        if(!response.ok)return {source:{name:provider.name,status:[404,422].includes(response.status)?'not_found':'http_error',httpStatus:response.status},book:null};
        if(!/application\/(?:[\w.+-]*\+)?json\b/i.test(response.headers.get('content-type')||'')){response.body?.cancel().catch(()=>{});return unavailable('invalid_response');}
        const reader=response.body?.getReader();if(!reader)return unavailable('invalid_response');
        let size=0,body='';const decoder=new TextDecoder('utf-8',{fatal:true});
        try { while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){reader.cancel().catch(()=>{});return unavailable('invalid_response');}body+=decoder.decode(value,{stream:true});}body+=decoder.decode(); }
        finally {reader.releaseLock();}
        let book;try { book=provider.normalize(JSON.parse(body),isbn); } catch { return unavailable('invalid_response'); }
        // A cover-only response may still be useful, but never supplies an
        // invented title. The browser must validate every image candidate.
        return {source:{name:provider.name,status:book?.record.title?'found':'not_found'},book};
      })(),
      new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(unavailable('timeout'));},timeoutMs);}),
    ]);
  }catch{return unavailable(controller.signal.aborted?'timeout':'unavailable');}
  finally {clearTimeout(timer);controller.abort();}
}
export function createIsbnLookupService({fetchImpl=(...args)=>globalThis.fetch(...args),timeoutMs=4000,now=Date.now}={}) {
  const cache=new Map(),pending=new Map();
  return {async lookup(raw) {
    let isbn;try{isbn=normalizedIsbn(raw);}catch{throw new ApiError(400,'INVALID_ISBN');}if(!isbn)throw new ApiError(400,'INVALID_ISBN');
    const key=isbn,hit=cache.get(key);if(hit&&hit.until>now())return structuredClone({...hit.data,cached:true});
    if(pending.has(key))return structuredClone(await pending.get(key));
    if(pending.size>=4)throw new ApiError(503,'ISBN_LOOKUP_BUSY');
    const request=(async()=>{
      const replies=await Promise.all(isbnProviders(isbn).map(provider=>providerFetch(provider,isbn,fetchImpl,timeoutMs)));
      const record=metadata({}),fieldSources={},covers=[];
      for(const {source,book} of replies){if(!book)continue;
        for(const field of FIELDS)if(!record[field]&&book.record[field]){record[field]=book.record[field];fieldSources[field]=source.name;}
        for(const raw of book.covers){const url=coverUrl(raw);if(url&&!covers.some(item=>item.url===url)&&covers.length<8)covers.push({url,source:source.name});}
      }
      const editorial=EDITORIAL_COVERS[isbn];if(editorial&&!covers.some(item=>item.url===editorial.url))covers.push({...editorial});
      const fallback=`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
      if(!covers.some(item=>item.url===fallback))covers.push({url:fallback,source:'Open Library Covers (ISBN)'});
      const result={isbn,metadata:record.title?record:null,fieldSources,sources:replies.map(reply=>reply.source),covers,cached:false};
      // Cache public metadata only, never credentials or a claim of loaded image.
      // Provider failures use a brief backoff; empty results remain retryable.
      cache.delete(key);if(cache.size>=128)cache.delete(cache.keys().next().value);
      const partialFailure=replies.some(reply=>['http_error','unavailable','invalid_response','timeout'].includes(reply.source.status));
      cache.set(key,{until:now()+(partialFailure?30000:300000),data:structuredClone(result)});return result;
    })();
    pending.set(key,request);try{return structuredClone(await request);}finally{pending.delete(key);}
  }};
}
