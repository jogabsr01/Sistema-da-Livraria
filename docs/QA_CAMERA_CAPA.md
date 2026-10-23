# Capa por webcam/câmera e galeria

## Problema e solução

O campo anterior era apenas um `input type=file`: no computador, ele abre o seletor de arquivos e não inicia a webcam. A mesma escolha em celular depende do navegador/sistema e não garantia um acesso explícito à câmera.

Cadastro e edição agora reutilizam um único componente com duas ações:

- **Tirar foto da capa**: solicita vídeo por `getUserMedia`, sem áudio, preferindo a câmera traseira em celulares. Mostra a prévia dentro do próprio formulário, com “Usar esta foto” e “Fechar câmera”. A captura usa o frame real do vídeo e o mesmo processamento/otimização das fotos selecionadas, preservando os campos preenchidos. Em navegadores sem essa API, há um seletor nativo alternativo com `capture=environment`.
- **Escolher da galeria**: abre um campo separado de arquivos, sem `capture`.

As fotos continuam locais, com otimização JPEG, limite de tamanho, prévia e persistência como `capaUrl`/`capaFonte`. Nada é enviado a um serviço externo. Cancelar uma seleção mantém a capa anterior. Capturar, fechar o painel/modal, substituir o formulário ou sair do perfil libera as trilhas de vídeo. Uma permissão concedida depois do fechamento não deixa a câmera ligada.

Câmera ausente, permissão negada, frame ainda indisponível e falha de captura recebem feedback sem apagar o cadastro. O leitor de código de barras permanece independente e não mudou.

## ISBN da captura do usuário

Consulta real de `9786589806691`: **Mulher real**, Junia Hayashi, Editora Quatro Ventos (CBL, edição física, 2023, 170 páginas).

| Fonte | Resposta real |
| --- | --- |
| BrasilAPI/CBL | 200, dados do livro e `cover_url: null` |
| BrasilAPI/Mercado Editorial | 404 |
| Google Books | 429 |
| Open Library catálogo | 200, `{}` |
| Open Library edição | 404 |
| Open Library Covers por ISBN | 404 |

Respostas reais registradas em [fontes-9786589806691.json](evidencias-camera/fontes-9786589806691.json).

Não foi encontrada uma imagem nas fontes automáticas consultadas. Isso não é uma falha de renderização da capa: essas fontes não forneceram uma imagem utilizável. Não foi inventado um URL de imagem ou acrescentada uma associação editorial não verificada para esse livro. A alternativa manual agora permite usar a webcam no computador, além da galeria.

## Testes

Resultado: **34 testes Playwright/Chromium aprovados**, além de análise sintática dos scripts inline e `git diff --check`. Após o ajuste de rolagem da prévia, o teste de captura/galeria em cadastro e edição foi repetido e aprovado.

A suíte inclui regressões existentes e cenários de:

- Prévia e captura de vídeo, seleção pela galeria, salvamento e recarga em cadastro e edição.
- Preservação da capa ao cancelar, botões em 320/390 px e fallback nativo `capture=environment`.
- Permissão negada, câmera ausente, concessão tardia de permissão, encerramento/alteração de formulário e logout, verificando trilhas em estado `ended`.
- Falha ao gerar a foto, preservação do título e recuperação pela galeria.
- PINs, fluxo do leitor, capas automáticas, Estoque, Catálogo, Caixa, venda fictícia, Relatórios e indicador DEV.

Os testes de captura usam vídeo real de câmera **virtual do Chromium**. As imagens de galeria e respostas de APIs nos testes de regressão são simuladas; a tabela de HTTP acima foi obtida em consultas reais separadas. Não se afirma validação em hardware físico Android/iOS ou webcam do usuário. O teste final no computador do usuário ainda deve confirmar a permissão da webcam e eventuais restrições do navegador/sistema.

Capturas da câmera virtual (o padrão verde é o vídeo de teste do Chromium, não uma capa editorial):

- [Prévia da câmera](evidencias-camera/previa-camera-virtual.png).
- [Foto capturada e aplicada à capa](evidencias-camera/foto-capturada.png).

Esta mudança deve seguir por PR para `dev`, sem merge automático ou alteração de `main`/produção.

## Integração nesta rodada

O componente deste PR #4 foi incorporado ao PR #17 sob a autorização de testar capas com maior rigor e publicar em dev. Regressão e associação da capa editorial estão em [QA_CAPAS_HARDENING.md](v17/QA_CAPAS_HARDENING.md). As medições e 34 cenários acima são a evidência original do componente; os testes combinados foram repetidos nesta rodada.
