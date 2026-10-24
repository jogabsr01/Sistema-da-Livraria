# Testes V16

Os testes usam `unittest`, Playwright/Chromium e Pillow, sem dependências de runtime novas na livraria. O HTML testado é o `index.html` do checkout atual.

Pré-requisitos de desenvolvimento: Python 3, `playwright`, `Pillow` e Chromium. Se necessário, instale as dependências de teste em um ambiente virtual: `python3 -m pip install playwright Pillow`.

Obtenha a mesma versão ZXing usada pelo aplicativo, mantendo a validação TLS ativa:

```sh
curl --fail --location --show-error \
  https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js \
  --output /tmp/livraria-zxing-0.21.3.js
```

A partir da raiz do repositório:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

`ZXING_JS` permite indicar uma cópia local da biblioteca obtida pela mesma fonte HTTPS. `CHROMIUM` permite selecionar o executável (padrão `/usr/bin/chromium`).

Os testes não acessam serviços de produção nem enviam fotos ou dados de clientes. O HTML e a biblioteca são servidos por interceptação de requisições no navegador. APIs bibliográficas, imagens remotas e falhas HTTP são simuladas; qualquer outra requisição recebe 404. As imagens EAN-13 e de capa são geradas localmente. A leitura de EAN-13 pela galeria utiliza o decodificador ZXing real, sem simular seu resultado. O Chromium fornece câmera virtual; testes de roteamento usam detecção nativa simulada para provocar resultados determinísticos e respostas tardias.

Isso não substitui uma verificação em Android/iOS físico de foco, iluminação, permissões e formatos específicos do dispositivo. A emulação mobile verifica layout, eventos, escolha de arquivo e regressão funcional.

## Diagnóstico e isolamento do transporte local

`npm run build` seguido de `npm run test:diagnostics` executa cinco cenários Chromium sobre o HTML publicado: coexistência com scripts que usam window.google, namespace somente leitura, cadastro/recarga, relatório de erro com arquivo/pilha e preservação de falhas reais. Scripts e erros injetados são fixtures explícitas; não identificam uma extensão real. A execução por unittest discover também inclui esses cenários e requer dist atualizado pelo build.

## Teste aprofundado de capas

Após npm run build, executar ZXING_JS=<biblioteca verificada> npm run test:cover-hardening. A suíte usa o PNG editorial real incluído no build, verifica persistência nas telas, quota cheia e corrupção, e executa câmera virtual. Metadados de APIs são fixtures/replays explícitos; o cenário de fotografia manual não significa que uma capa editorial foi encontrada. O experimento com consultas externas reais e seus limites está em docs/v17/QA_CAPAS_HARDENING.md.

### Fotos privadas e ISBN combinados (PR #15 atualizado)

`npm run test:photos` executa seis cenários originais; `npm run test:photo-isbn` acrescenta seis de preservação de fotos durante consultas atrasadas, remoção explícita, arquivo inválido e câmera/pagehide. Um cenário usa o PNG editorial real verificado, com upload/Sharp e persistência Google emulados e descartáveis; não afirma acesso ao Google real. O restante usa fixtures identificadas. A revisão combinada totaliza 160 testes backend e 86 Chromium, mantendo o protótipo do PR #17.

### Caixa compartilhado DEV

Após `npm run build`, `npm run test:checkout` executa a tela anônima com cookies/sessões/WebAuthn, API e Apps Script reais sobre armazenamento Google descartável emulado. Cobre formas de pagamento, recarga após resposta perdida, falha de projeção, preço alterado, conexão indisponível, quota local, escopo por conta, sessão independente e layout móvel. As rotas `/test/*` existem somente no harness, nunca nas Functions. Resultado local não comprova integração Google remota nem hardware/Safari. Pré-requisitos e limites operacionais: [CAIXA_COMPARTILHADO_DEV.md](../docs/v17/CAIXA_COMPARTILHADO_DEV.md).

### Reposição e livros esgotados

`npm run test:stock` executa cinco cenários: vender/esgotar/editar/repor/vender o mesmo cadastro, recuperar entrada após resposta perdida/recarga, restrição administrativa, bloqueio do checkout por quantidade e quota local. A suíte pública acrescenta três testes contra override/linhas duplicadas e verifica edição/reposição no protótipo. Contratos Node cobrem falhas entre gravações e checkpoints mistos, inclusive foto privada após venda. Guia: [ESTOQUE_REPOSICAO_DEV.md](../docs/v17/ESTOQUE_REPOSICAO_DEV.md).

### Notificações e relatório de reposição

Após build, `npm run test:notifications` executa sete cenários de alertas/leitura/atendimento/resolução, fornecedor ausente, filtros, CSV, impressão interceptada, texto sem envio, XSS/fórmulas, permissões e celular. Os 12 contratos Node novos cobrem recuperação, deduplicação, escalada e um relatório completo de 400 livros além da paginação. Google é emulado; não há pedido, mensagem, cobrança ou integração Google real. Evidência: [QA_NOTIFICACOES_REPOSICAO.md](../docs/v17/QA_NOTIFICACOES_REPOSICAO.md).

### Equipe DEV

`npm run test:staff` cobre seis cenários browser, inclusive primeiro acesso/login por CPF com assinaturas do autenticador virtual. `tests/backend/staff.test.mjs` cobre cifra/autorização/idempotência e falhas em projeções. Tudo usa chaves e contatos fictícios, Google/MailApp emulados; nunca habilita instalações reais. Ver `docs/v17/QA_EQUIPE.md`.

### Clientes e Caixa identificado

`npm run test:customers` cobre seis cenários browser com Google emulado; `tests/backend/customers.test.mjs` cobre recuperação, concorrência, cifra, consentimento e pagamentos. CEP/endereço são manuais; não há envio para provedor externo. Ver `docs/v17/QA_CLIENTES_CAIXA.md`.

### Operações e CEP

`npm run test:operations` cobre seis cenários browser financeiros, somente com emulação. `test:customers` agora cobre oito, incluindo consulta de CEP por clique e fallback manual. Backend: `operations.test.mjs` / `postal-code.test.mjs`, falhas, concorrência e isolamento de dados. Ver `docs/v17/QA_OPERACOES_CEP.md`.

### Perfil e recuperação de PIN

Após build, `npm run test:profile` cobre cinco cenários Chromium, incluindo assinatura WebAuthn real com autenticador virtual, PIN novo/antigo, sessão revogada, avatar em celular e repetição após resposta perdida. `profile.test.mjs` e `recovery.test.mjs` exercitam autorização, cifra, Drive privado, concorrência e falhas antes/depois das projeções. Provas de armazenamento dos contratos Node são fixtures descartáveis; não substituem assinaturas. Google/MailApp/Drive emulados; ver [QA_PERFIL_RECUPERACAO.md](../docs/v17/QA_PERFIL_RECUPERACAO.md).
