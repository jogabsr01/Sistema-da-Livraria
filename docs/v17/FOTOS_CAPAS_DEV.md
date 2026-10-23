# Fotos de capas no catálogo compartilhado DEV

Incremento em revisão sobre o PR #14, integrado somente em dev (`5b6b57668f79ef377c89183a7262fef8005e3eba`). As flags reais continuam desligadas; nenhuma configuração, usuário, imagem ou dado Google real foi alterado. O protótipo index.html, as 17 abas de negócio e seus schemas continuam iguais à base dev.

## Comportamento

O formulário de catalogo-dev.html oferece **Tirar foto**, usando webcam no computador ou câmera no celular, e **Escolher da galeria**, com seletor de arquivos separado. Requer HTTPS e permissão do navegador. Se não houver câmera/permissão, a galeria continua disponível. Cancelar, fechar o formulário, capturar ou sair da página encerra todos os tracks. Uma autorização de câmera que chega depois do fechamento também é descartada e encerrada.

A foto é comprimida no navegador, com prévia temporária em memória. Não há upload antes de Salvar livro nem armazenamento de imagem/credenciais em localStorage. Cancelar descarta a prévia. O cadastro salva metadados e referência da imagem no mesmo comando recuperável. Catálogo, detalhes e recarga usam a imagem pelo proxy autenticado; outra sessão autorizada recebe o mesmo arquivo. A edição apenas de metadados preserva a capa. Remoção ou troca por URL externa é explícita.

A implementação é para o **catálogo compartilhado**. A consulta automática por ISBN e o Caixa compartilhado ainda serão conectados; este PR não afirma ter resolvido a disponibilidade de capas nas APIs editoriais nem integrado a nova imagem no carrinho/relatórios do protótipo.

## Arquivos e limites

- `backend/cover-photo.mjs`: Sharp fixado em 0.35.5 decodifica JPEG/PNG/WebP, recusa SVG/PDF/GIF e bytes inválidos, remove EXIF/GPS, normaliza orientação e reencoda JPEG. Entrada do servidor: até 64 KiB, até 2.000 pixels por dimensão/3 MP; saída: até 48 KiB e 900 × 1.200 pixels. A galeria aceita até 12 MB antes da compressão local. O original não é enviado ao Google.
- `google-apps-script/CoverPhotos.gs`: salva na pasta privada COVERS_FOLDER_ID existente, confere marcador/vínculo/privacidade, MIME, hash e produto. Não cria links públicos nem substitui bytes de arquivos existentes. O nome determinístico por produto/comando permite retomar criação ou marcação cuja resposta se perdeu.
- `/api/v1/catalog/cover?id=<UUID>&v=<versão>`: sessão persistente, autorização products.read e validação Google sob lock. O navegador não escolhe nem recebe um Drive ID. JPEG sai com no-store/private, nosniff, CORP same-origin e sem redirecionamento para o Drive. `v` muda a URL ao editar; o servidor resolve sempre a foto atual pelo produto e nunca usa cache público.
- Gravação mantém origem exata, JSON, CSRF e permissão products.write; corpo até 135 KB para fotos (sem foto continua até 40 KB). Valida metadados/duplicidade/CAS antes de criar arquivo. O hash da foto faz parte do comando/journal. Falha após criação e antes do intent pode deixar arquivo privado sem vínculo; repetir o mesmo comando reaproveita o arquivo.

Nenhuma migração de cabeçalhos é necessária. After_JSON admite photoHash opcional; os comandos antigos sem esse campo continuam compatíveis. Recuperação valida a foto marcada antes de projetar a referência. Flags de foto desligadas bloqueiam novas operações de foto; não apagam arquivos nem interrompem deliberadamente a recuperação do journal já registrado.

**Retenção:** troca/remoção retira a referência do produto, preservando os arquivos anteriores privados. Arquivos órfãos e versões antigas ainda não têm limpeza automática. Não apagar manualmente arquivos referenciados por comandos pendentes. A retenção e o arquivamento/backup dos arquivos exigem política e homologação próprias; o backup de planilha não duplica os bytes das fotos.

## Instalação posterior à aprovação

Não é necessário configurar arquivo por arquivo a cada PR. O kit `scripts/package-google-dev.py` reúne todo o código e guias para um lote único. Após revisar e integrar esta entrega:

1. Concluir o lote descrito em PRIMEIRO_ACESSO_OWNER.md e CATALOGO_COMPARTILHADO_DEV.md. Atualizar todos os arquivos `.gs` do kit no projeto Google **DEV**, incluindo o novo **CoverPhotos.gs** e as versões atuais de Code.gs e Catalog.gs. Preservar propriedades e a URL existente. Não copiar ferramentas de teste para o Apps Script.
2. A pasta COVERS_FOLDER_ID já é criada no provisionamento original. Preservar seu ID, marcador e compartilhamento privado. Não criar outra instalação nem compartilhar a pasta publicamente. Não há novo escopo OAuth, chave ou aba de negócio neste incremento.
3. Atualizar a implantação Apps Script existente para a nova versão. Durante homologação controlada, definir **COVER_PHOTOS_ENABLED=true** nas propriedades Google e **WORKSPACE_COVER_PHOTOS_ENABLED=true** no Netlify exclusivamente em Branch deploys limitado à branch dev. As dependências de identidade/catálogo também precisam estar configuradas e homologadas. Manter produção/previews sem esses valores.
4. Atualizar somente o branch deploy DEV. Entrar pela conta verificada, abrir `/catalogo-dev.html`, usar um livro descartável e testar câmera/galeria, salvar, recarregar e abrir em outra sessão autorizada. Conferir que o arquivo permanece privado no Drive. Não usar Publish deploy para promover a produção.
5. Se necessário, desativar as duas flags de foto para interromper novas fotos/leitura; isso não apaga cadastros, arquivos ou journal. A edição de metadados sem foto continua preservando a referência.

Esta sessão não tem acesso às propriedades privadas/conta Google. O acesso externo ao site DEV retornou HTTP 401; merge e preview Netlify não comprovam homologação real.

## Evidências

144 testes backend aprovados em Node 22 e 24 (135 anteriores e nove novos). Build aprovado; npm audit sem vulnerabilidades conhecidas. 51 cenários Playwright/Chromium: seis de fotos, seis de catálogo, seis de primeiro acesso/login, sete de WebAuthn e 26 de regressão do protótipo. As suítes protegem os testes de conexões externas mesmo se o build herdar configuração privada.

Novos testes exercitam reencodificação/remoção EXIF, entradas inválidas, flags, CSRF, privacidade/vínculo, corrupção, duas sessões, retentativa após falhas de Drive/journal/produto/relação/auditoria/recibo, preservação de metadados e remoção explícita. Chromium usa imagem gerada e câmera sintética declarada, autenticação/passkey virtual com assinatura real, o handler/Sharp real e a ponte Google emulada. Confere `img.complete && naturalWidth > 0`, galeria separada, permissão negada/tardia, encerramento de tracks, recarga, resposta perdida e layout celular.

Não foram validados câmera física, iOS/Safari, Google IAM, quota/latência de Drive, e-mail real, APIs editoriais ou dados compartilhados. Capturas locais: `/workspace/qa-v17-owner-access/foto-formulario.png`, `foto-catalogo.png`, `foto-camera-celular.png`. Uma imagem sintética carregada não é evidência de capa editorial encontrada por ISBN.

Comandos: `npm test`, `npm run build`, `npm run test:photos`, `npm run test:catalog`, `npm run test:access`, `npm run test:passkeys` e `ZXING_JS=<arquivo verificado> npm run test:browser`. Netlify externaliza Sharp no bundle para incluir seus binários nativos.
