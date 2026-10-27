# Identidade da publicação nas Functions Netlify

O erro real `CONFIGURATION_UNAVAILABLE` no primeiro acesso revelou uma incompatibilidade: o backend exigia CONTEXT, BRANCH e DEPLOY_PRIME_URL em runtime, mas esses metadados pertencem ao build. O diagnóstico anterior passou no build e não exercitou esse cenário das Functions. A documentação oficial distingue os ambientes e lista apenas URL, SITE_NAME e SITE_ID entre as variáveis automáticas garantidas nas Functions: [Netlify](https://docs.netlify.com/build/functions/environment-variables/).

A correção captura somente versão de formato, contexto, branch, URL canônica da publicação e SITE_ID durante o build Netlify. Gera `backend/deployment-metadata.mjs` antes do empacotamento das Functions. A cópia versionada é um marcador nulo; o build local sem NETLIFY=true restaura esse marcador. O gerador não usa chaves, flags, dados pessoais ou IDs dos recursos Google.

O backend exige que o SITE_ID do runtime coincida com a identidade empacotada. Dados de contexto presentes no runtime precisam concordar com o pacote; somente campos ausentes recebem a identidade do build. Contexto, branch, ambiente, domínio HTTPS fixado e bindings Google continuam validados. Request, Host e headers encaminhados não definem essa identidade. Previews, branches diferentes e outro site permanecem bloqueados.

As chaves e flags continuam exclusivamente nas variáveis privadas das Functions. O módulo não é incluído em dist, não altera propriedades Google nem exige nova colagem no Apps Script. Uma nova publicação DEV aplica a correção; não configurar CONTEXT/BRANCH/DEPLOY_PRIME_URL manualmente na interface.

Validar a execução real abrindo `/api/v1/access/state` no navegador autorizado do proprietário. Estado INITIAL confirma somente a configuração inicial, não entrega de e-mail, PIN, passkey ou homologação dos módulos. Os testes emulam runtime sem variáveis de build e conferem importação do módulo gerado, isolamento de site/contexto/hostname e exclusão de conteúdo privado do frontend.

Validação local desta correção (27/10/2026, São Paulo): 370 testes completos aprovados em Node 22.23.4 e 24.19.0, sem falhas/skips/cancelamentos. Quatro novos casos cobrem runtime sem metadados de build, recusa de origem/site/contexto divergentes, lista estrita de dados não secretos e importação real do módulo gerado. O teste do build público também exclui explicitamente o arquivo de identidade. Build e diff check aprovados; sem alteração de interface ou de GAS. O aceite no runtime Netlify permanece pendente até nova publicação e resposta do proprietário.
