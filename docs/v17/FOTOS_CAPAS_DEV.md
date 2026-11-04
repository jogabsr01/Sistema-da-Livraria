# Fotos de capas e imagens de nichos no Firestore

Este guia descreve o modelo Firestore atual. A migração operacional e a reconciliação são etapas separadas: não é necessário criar novas mídias para iniciá-las. Testes locais não comprovam homologação em uma instalação real.

## Persistência e leitura

- Capas: `products/{id}/media/cover`; imagens de nichos: `niches/{id}/media/image`. Os subdocumentos guardam `bytes` em base64, `sha256` e `updatedAt`. Os documentos principais mantêm `hasPhoto` e `hasImage`, respectivamente; os bytes não são carregados nas listagens.
- As operações de leitura buscam o subdocumento sob sessão e autorização. Capas são servidas pelo endpoint autenticado `/api/v1/catalog/cover?id=<UUID>&v=<versão>`.
- Gravação ou remoção explícita da mídia e atualização do indicador ocorrem na mesma transação. Uma edição sem campo de imagem preserva a mídia existente; a remoção explícita exclui o subdocumento. Links externos de capa são distintos de bytes privados.
- O backend valida base64 canônico e SHA-256, limitando os bytes decodificados a 48 KiB; `backend/cover-photo.mjs` normaliza imagens recebidas. A prévia é temporária e a captura depende de permissão do navegador.

## Migração e verificação

A importação de produtos e nichos deve preservar mídias existentes e manter os indicadores coerentes com seus subdocumentos. Transferir mídias legadas é trabalho separado; não presumir que o importador de dados as transfira. Antes de escrever, conferir destino isolado, backup, identificação dos registros e plano de reconciliação. `schema/workspace-v1.json` descreve cabeçalhos legados das planilhas, não o schema Firestore; seus campos históricos não representam o modelo atual de mídia.

Os contratos implementados estão em `backend/firestore-catalog.mjs`, `backend/firestore-niches.mjs` e nos testes correspondentes. Consulte também `ISBN_COMPARTILHADO_DEV.md`; resultados históricos de QA não substituem validação do destino.