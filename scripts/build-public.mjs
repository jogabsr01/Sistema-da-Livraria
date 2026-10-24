import { mkdir, copyFile, rm, lstat, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export async function build(root = fileURLToPath(new URL('../', import.meta.url))) {
  const destination = resolve(root, 'dist');
  const stat = await lstat(destination).catch(e => { if (e.code !== 'ENOENT') throw e; });
  if (stat?.isSymbolicLink()) throw new Error('dist must not be a symlink');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination);
  const manifestPath = resolve(root,'data/editorial-covers.json');
  const manifestStat = await lstat(manifestPath).catch(error => {if(error.code !== 'ENOENT')throw error;});
  if(manifestStat){
    for(const folder of ['data','public','public/covers']){const info=await lstat(resolve(root,folder));if(!info.isDirectory()||info.isSymbolicLink())throw Error('Invalid cover directory');}
    if(!manifestStat.isFile()||manifestStat.isSymbolicLink())throw Error('Invalid cover manifest');
    const refs=JSON.parse(await readFile(manifestPath,'utf8')),publicRefs={},seen=new Set();
    if(!Array.isArray(refs)||refs.length>32)throw Error('Invalid cover manifest');
    await mkdir(resolve(destination,'covers'));
    for(const entry of refs){
      if(typeof entry.isbn!=='string'||!/^97[89]\d{10}$/.test(entry.isbn)||[...entry.isbn].reduce((sum,digit,index)=>sum+Number(digit)*(index%2?3:1),0)%10!==0||seen.has(entry.isbn)||!new RegExp('^/covers/'+entry.isbn+'-[a-f0-9]{16}\\.png$').test(entry.path)||!/^https:\/\//.test(entry.sourceUrl)||!/^https:\/\//.test(entry.referenceUrl)||typeof entry.source!=='string'||entry.source.length>160)throw Error('Invalid cover reference');
      const input=resolve(root,'public'+entry.path),info=await lstat(input);
      if(!info.isFile()||info.isSymbolicLink()||info.size>2097152)throw Error('Invalid cover asset');
      const bytes=await readFile(input),hash=createHash('sha256').update(bytes).digest('hex');
      if(bytes.length<33||bytes.length!==entry.bytes||hash!==entry.sha256||!entry.path.includes('-'+hash.slice(0,16)+'.png')||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==entry.width||bytes.readUInt32BE(20)!==entry.height||entry.width<30||entry.height<40||entry.width*entry.height>12000000)throw Error('Cover integrity mismatch');
      await copyFile(input,resolve(destination,entry.path.slice(1)));seen.add(entry.isbn);
      publicRefs[entry.isbn]={path:entry.path,source:entry.source,referenceUrl:entry.referenceUrl,sourceUrl:entry.sourceUrl};
    }
    await writeFile(resolve(destination,'cover-references.js'),'globalThis.LivrariaCoverReferences=Object.freeze('+JSON.stringify(publicRefs)+');\n');
  }
  // Explicit allowlist: backend, Apps Script, tests and configuration are never published.
  for (const file of ['index.html', 'teste-dev.txt', 'acesso-dev.html', 'acesso-dev.js', 'acesso-dev.css', 'catalogo-dev.html', 'catalogo-dev.js', 'catalogo-dev.css', 'caixa-dev.html', 'caixa-dev.js', 'caixa-dev.css', 'notificacoes-dev.html', 'notificacoes-dev.js', 'notificacoes-dev.css', 'notification-badge.js', 'nichos-dev.html','nichos-dev.js','nichos-dev.css','equipe-dev.html', 'equipe-dev.js', 'equipe-dev.css', 'meu-perfil-dev.html', 'meu-perfil-dev.js', 'meu-perfil-dev.css', 'account-menu.js', 'email-change-dev.js', 'account-menu.css', 'operacoes-dev.html', 'operacoes-dev.js', 'operacoes-dev.css']) {
    const input = resolve(root, file);
    const info = await lstat(input).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (!info && file !== 'index.html') continue;
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Invalid public asset');
    await copyFile(input, resolve(destination, file));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await build();
