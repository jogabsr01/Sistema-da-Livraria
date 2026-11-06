# Sessão entre a confirmação de acesso e a Home

O teste de transporte reproduziu o relato de confirmação seguida de novo pedido de login. A resposta anterior enviava dois Set-Cookie: criar a sessão e apagar o cookie de pré-acesso. No Chromium, os cabeçalhos separados funcionaram; juntá-los em um único cabeçalho com vírgula fez o cookie de sessão desaparecer. A etapa seguinte retornou 401 e exibiu a entrada pública. Isso comprova o mecanismo no teste; não confirma que o Netlify efetivamente juntou os cabeçalhos na tentativa do proprietário. A gravação enviada ultrapassou o limite de transferência e não foi analisada.

O cliente atualizado solicita `x-access-cookie-mode: separate` ao concluir o acesso. A resposta final emite somente o cookie da sessão. Antes de apresentar sucesso ou abrir a Home, o navegador faz POST `/api/v1/access/cookie`. Esse comando exige origem e CSRF corretos, o cookie de pré-acesso e o cookie de sessão recebido pelo navegador. Compara em tempo constante o token de sessão esperado, derivado da chave privada e do pré-acesso. Somente depois dessa correspondência a resposta apaga o cookie de pré-acesso, em um único Set-Cookie separado.

A conferência de recebimento não consulta Google, não cria sessões nem concede autorização. A conclusão anterior continua exigindo a prova de identidade; todas as funções protegidas continuam consultando a sessão no servidor. Um cookie ausente, errado, duplicado ou de outro fluxo não é confirmado. Cabeçalhos inválidos não recebem exclusão de cookies. O protocolo de clientes antigos permanece disponível.

Se o navegador não guardar a sessão, a tela fica na conclusão com diagnóstico e possibilidade de reemitir a mesma concessão já gravada; não chama novamente a biometria. Se a resposta que apagou o pré-acesso ficar ilegível, a recuperação confere a sessão existente antes de mostrar sucesso. Contadores WebAuthn, desafios de uso único, versões e prazo de sessão não foram alterados.

A Home recebe `entrada=confirmada` apenas como indicação visual de uma navegação após confirmação. Esse parâmetro não autoriza acesso. Se a consulta de sessão falhar, a Home oculta as ações protegidas e oferece “Conferir sessão” e um diagnóstico de abertura, em vez de induzir outro login sem explicar a perda. O diagnóstico contém apenas etapa, horário, HTTP, duração e códigos permitidos. Na abertura pública normal, a entrada continua disponível.

## Identidade da igreja

A logo original foi extraída dos dois elementos PNG embutidos em `index.html`, `pin-church-logo` e `church-logo`; os bytes eram idênticos. É a sarça com “Igreja Presbiteriana JD Bonfiglioli”, em sua cor original. A imagem está em `public/brand/ipb-jardim-bonfiglioli.png` e foi restaurada nas 14 páginas DEV. O protótipo foi preservado byte a byte. O build publica somente esse arquivo de marca, com validação de caminho e integridade, junto dos demais ativos permitidos.

SHA-256 da imagem original: `5b1e9aa6d4efbd19a3ae7324146ec835a8e1899eff73d93af99c001f7165a091`.

## Verificação

`test-session-cookie-transport.py` usa Chromium, autenticador virtual WebAuthn e backend real com Google simulado. Cobre junção dos cabeçalhos, ausência do cookie, resposta ilegível da limpeza e rejeição da Home depois de uma confirmação. Os testes do servidor verificam vínculo criptográfico/CSRF/origem, ausência de chamadas Google na limpeza e que apenas o cookie de pré-acesso é apagado. A velocidade e o comportamento da hospedagem real ainda precisam da evidência do ambiente publicado.
