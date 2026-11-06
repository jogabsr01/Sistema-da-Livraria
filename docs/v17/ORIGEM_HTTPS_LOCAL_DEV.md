# Origem HTTPS local para integração DEV — pendente

O roteador HTTPS experimental está disponível sob opt-in local, mas o fluxo completo **ainda não está homologado**: operações Firestore de biometria e dispositivo continuam pendentes. Servir `dist` com `python3 -m http.server` permite apenas visualizar o protótipo.

Sem opt-in, existe uma prévia HTTPS exclusivamente visual em loopback. Com `mkcert` instalado e sua CA local instalada, gere um certificado fora do repositório e execute `node scripts/local-https-preview.mjs /caminho/cert.pem /caminho/key.pem`. Com `WORKSPACE_LOCAL_LAB=YES` e todas as demais travas da política satisfeitas, o mesmo servidor encaminha `/api/v1/*` às Functions locais. Não adicione chaves ou certificados privados ao Git.

O padrão publicado mantém a origem DEV e seu RP ID. No laboratório validado, os handlers usam `https://localhost:8443` e RP ID `localhost`; o servidor adapta os scripts apenas na resposta local, sem alterar o build publicado. Não remapear o domínio DEV real no arquivo hosts nem reescrever `Origin` para aparentar que a requisição veio do domínio publicado.

## Estrutura necessária antes do comando definitivo

1. Definir uma origem dedicada e controlada para o laboratório local, com TLS confiável no navegador, e um RP ID apropriado para ela. Não reutilizar uma passkey ou conta real do DEV publicado.
2. Implementar uma configuração de origem e RP ID **restrita ao processo local**, ativada explicitamente e recusada em deploys Netlify/produção. Vincular essa configuração ao emulador `127.0.0.1` e a projeto descartável `demo-*`; manter inalterados os padrões e as regras de produção. Validar também cookies Secure, Origin, CSRF e `clientDataJSON`/RP ID na mesma configuração.
3. Criar um servidor local que sirva UI e encaminhe as rotas `/api/v1/*` às Functions reais, com contexto de IP confiável, limites de requisição, encerramento limpo e acesso somente loopback. Não expor ao navegador segredos ou endpoints de inspeção da outbox.
4. Completar e testar as operações de autenticação Firestore ainda marcadas `FIRESTORE_OPERATION_NOT_READY`, a transição de primeiro acesso e a emissão da sessão; uma solicitação de código isolada não comprova login completo.
5. Testar via navegador real: origem incorreta, CSRF, cookies, expiração de código, cadastro e uso de passkey, revogação e ausência de acesso a projetos reais. Executar também a suíte de regressão sem alterar as garantias dos ambientes publicados.

Enquanto isso, o teste HTTP existente exercita o handler com cookie/CSRF e Firestore Emulator em projeto isolado, mas usa um adaptador de teste para a origem e **não é um servidor acessível para homologação manual**:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/backend/firestore-owner-access-http-emulator.test.mjs
```

O endpoint atual de primeiro acesso está em `netlify/functions/owner-access.mjs`. O inspetor `scripts/firestore-local-email-code.mjs` é uma ferramenta local separada e não deve ser publicado nem integrado a logs do servidor. Nenhuma configuração ou comando acima autoriza o uso de dados reais.