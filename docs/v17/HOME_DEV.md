# Home do app DEV

A entrada “Entrar no app Livraria” abre `/home-dev.html`. A Home consulta a sessão no servidor; não usa dados locais para autenticar ou autorizar o usuário. Administradores e atendentes têm “Nova compra” e “Pesquisar produto” no topo. “Adicionar novo produto” vem abaixo, seguido dos atalhos existentes. Equipe e relatórios aparecem somente para administradores; as APIs continuam aplicando as permissões reais.

As duas ações principais abrem o mesmo seletor acessível: câmera de código de barras ou busca pelo nome. O resultado segue para o Caixa ou para o catálogo, respectivamente. Ler um código apenas pesquisa; adicionar ao carrinho e confirmar a venda continuam ações explícitas. Não limpa compras pendentes. “Adicionar novo produto” abre o formulário somente após a verificação normal do catálogo.

A câmera exige um clique e permissão do navegador, sem áudio. Os quadros são decodificados no aparelho, sem upload. Fecha e encerra as trilhas ao cancelar, navegar, ocultar a página ou trocar para busca por nome, inclusive se a autorização chegar atrasada. Se a câmera falhar, permanece a busca digitada. Leitor local ZXing 0.21.3, pacote oficial `@zxing/library`, UMD minificado com licença Apache-2.0 incluída em `vendor/zxing-LICENSE.txt`. SHA-256: `d7cc8f69dd70bdcf3ac00c9ae572bf2acb9f4132ba379c72df842e4db918652d`. Formatos EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39 e ITF; QR não é usado para navegação.

Layout verificado em viewports 320×480, 320×568, 360×640, 390×844 e 1280×900. As duas ações ficam acima da dobra nessas dimensões. A página permite rolagem normal e ampliação de texto, sem cortar opções. Teste: `python3 scripts/test-home.py`, incluindo câmera negada, autorização tardia, leitura real de EAN-13 em stream local, navegação, sessão ausente e perfil atendente. A suíte não usa Google ou câmeras reais.

## Login

O novo comando privado `identity.access.loginLookup` reúne a reserva durável de tentativa e a resolução de conta numa única operação sob o lock existente. E-mail e índice protegido de CPF seguem os vínculos já cadastrados; não cria vínculo pelo formulário de login. Para equipe, exige as flags existentes e valida o contato criptografado também em Node. O verificador de PIN permanece privado e o scrypt continua em Node. A abertura do fluxo após PIN correto revalida conta e versão no Google; nenhum cookie de sessão é emitido até confirmar a chave de acesso.

Login reduzido para duas RPCs em caso de sucesso, com orçamento compartilhado de 27 segundos para produzir erro estruturado antes do limite observado de 30 segundos da hospedagem. Não aumenta os prazos das provas nem reenvia tentativas automaticamente. A recuperação mantém somente o cookie de pré-acesso em falhas incertas. O tempo real continua dependendo da latência do Google e precisa ser medido após a publicação.
