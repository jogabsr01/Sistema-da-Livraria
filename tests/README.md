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
