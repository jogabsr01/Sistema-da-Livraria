# Livraria IPB Jardim Bonfiglioli

A interface existente em `index.html` continua sendo uma **demonstração local**, com PINs fictícios 1357/2468 e dados por navegador. Não usar dados pessoais reais.

A V17 está em desenvolvimento incremental. Esta entrega cobre a **Fase A — Fundação**: contrato da API, esquema de dados, provisionamento DEV e migrações, transporte autenticado entre servidores e configuração por ambiente. Não ativa autenticação real, compartilhamento entre aparelhos ou vendas no Google Sheets.

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Para a regressão do artefato publicado: `npm run build` e `npm run test:browser`, com Python/Playwright/Pillow/Chromium e a biblioteca ZXing conforme `tests/README.md`.

Node 22 ou superior. Sem dependências de runtime adicionais. O build publica somente os arquivos estáticos explicitamente permitidos em `dist/`; não publica backend, Apps Script, testes ou `.env`.

- [Arquitetura e auditoria](docs/v17/ARQUITETURA.md)
- [Segurança e identidade](docs/v17/SEGURANCA.md)
- [Instalação e autorização Google DEV](docs/v17/INSTALACAO_GOOGLE.md)
- [Contrato da API](docs/v17/API.md)
- [Schema completo](schema/workspace-v1.json)
- [Backup e recuperação](docs/v17/BACKUP_RECUPERACAO.md)
- [Testes, limites e aceite da Fase A](docs/v17/ACEITE_FASE_A.md)
- [Regressão do protótipo](tests/README.md)

O PR da câmera (#4) é uma entrega separada; não foi integrado à V17 por este trabalho. Todas as fases seguem em PR para `dev`, com aprovação antes de integrar e avançar. Nenhuma alteração de produção é automática.
