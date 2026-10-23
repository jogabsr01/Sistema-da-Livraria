# Passkeys: verificação criptográfica e persistência DEV

Registro do incremento PR #12, já integrado em dev: verificador WebAuthn e armazenamento privado de desafios/credenciais. O controlador que conecta esse verificador ao primeiro acesso/login está no incremento seguinte, em revisão: [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md). Nenhuma conta real ou MFA de pessoa real foi configurada.

## Verificação Node

`backend/passkey-service.mjs` utiliza `@simplewebauthn/server` 14.0.3, versão exata no package-lock. A biblioteca mantida valida a estrutura WebAuthn, chave COSE e assinatura; a aplicação não implementa ECDSA/CBOR de autenticação manualmente.

RP ID é exclusivamente dev--merry-chimera-49a1f3.netlify.app e origem HTTPS exatamente correspondente. Registro usa ES256, attestation none, presença e verificação do usuário obrigatórias. Login usa apenas credenciais pertencentes ao usuário/versão resolvidos no servidor, exige confirmação do usuário e valida contador. Origem PROD, desafio incorreto, assinatura alterada, contexto de iframe e userHandle não correspondente são recusados. UUID é usado como userHandle/username, sem e-mail ou CPF nas opções.

Não significa prova de biometria específica ou de hardware certificado: passkeys podem usar biometria/PIN do aparelho, e attestation none minimiza identificação do dispositivo. O serviço verifica os sinais de presença/UV e a assinatura segundo WebAuthn. A chave privada permanece no autenticador; o servidor/Google recebem apenas a chave pública e metadados mínimos.

## Persistência assinada sob lock

O schema privado de controles evolui de v1 para v2 adicionando `_Passkey_Ceremonies` e `_Passkeys`. O schema público de 17 abas permanece v1, sem alterações. Migração valida o hash v1 conhecido, faz backup anterior, preserva contadores/códigos e permite retomada parcial. Instalação nova pode iniciar na v2 diretamente. Versão/histórico desconhecido ou hash incorreto recusam escritas.

Operações internas permitidas: identity.passkey.list/begin/take/register/counter. O envelope existente assina ação, instalação, recursos, tempo e nonce. O dispatcher exige DEV e a propriedade privada IDENTITY_PASSKEYS_ENABLED=true, ausente/desligada por padrão. Node tem trava WORKSPACE_IDENTITY_PASSKEYS_ENABLED adicional e valida branch/contexto/hostname. Não habilitar essas opções nesta entrega.

Desafios duram cinco minutos, têm finalidade e usuário/versão fixos, e são tomados uma vez antes da verificação criptográfica. Registro não pode associar duas credenciais ao mesmo desafio. Até cinco credenciais ativas por usuário/versão. O commit de autenticação confere a credencial escolhida, snapshot do contador e estado atual da conta/versão sob o lock. Credencial revogada e conta desativada recusam a conclusão mesmo depois da assinatura validada no Node.

Contador é monotônico quando o autenticador o fornece. Zero→zero é admitido para passkeys sincronizadas que não usam contador; o desafio de uso único permanece a proteção contra replay. Concorrência com snapshot antigo recusa a autenticação, exigindo novo desafio. Não aceitar papel, nível mfa ou resultado verified do navegador como evidência.

O Node só retorna verified depois do commit no armazenamento. Falha após consumir o desafio ou entre gravar chave/contador e concluir o marcador pode exigir novo desafio/recuperação; não devolver sucesso presumido. Pode haver registro de chave persistido mesmo se a resposta falhar: o controlador futuro precisa retomar com essa chave mediante identidade comprovada, sem duplicar cadastros. Aumentar a versão de autorização invalida as chaves vinculadas à anterior; será necessário fluxo verificado de recuperação/reinscrição.

## Testes executados

- 101 testes backend: Node 22 e 24, incluindo upgrade v1→v2, backup/idempotência/retomada, pertencimento da credencial, comparação atômica de contador, revogação/status/versão e flags fechadas.
- 7 cenários Playwright/Chromium com autenticador virtual: registro e assinatura reais, replay, origem PROD/desafio alterados, assinatura inválida, ausência de UV, desafio expirado/outro usuário e falha antes/depois da gravação do contador. Nesse teste, o Chromium gera a chave e a assinatura WebAuthn; o código Node verifica com a biblioteca real. O Google é um contrato descartável local, não um serviço real.
- 26 cenários de regressão do artefato público, incluindo celular, Caixa, Catálogo, capas e relatórios. HTML permanece idêntico.
- npm audit sem vulnerabilidades conhecidas no momento da consulta; não substitui atualização/revisão contínua.

Comandos reproduzíveis: npm test; npm run build; npm run test:passkeys; ZXING_JS=<arquivo ZXing verificado> npm run test:browser. O harness tests/helpers/passkey-harness.mjs é exclusivo de teste, usa identidades fictícias, escuta apenas localhost e não faz parte do artefato publicado. Emula armazenamento/controle de teste, sem substituir a criptografia do autenticador.

## Pendências antes de ativar login

O novo controlador do proprietário já conecta localmente limite persistente/origem confiável, e-mail/PIN, passkeys e emissão recuperável de sessão; tem revisão e homologação real pendentes. Para adicionar credenciais a conta já ativa, ainda será necessário reautenticação forte ou recuperação verificada. A lista de credenciais não pode ser exposta antes de comprovar o primeiro fator.

O resultado interno do verificador não é um login autônomo nem cookie. A emissão do novo controlador vincula a prova concluída a uma única sessão/fluxo/conta/versão, revalida permissões e recupera projeções sob lock. O schema privado atual desse novo incremento é v3; os resultados acima registram a entrega original do PR #12. Ainda faltam limpeza/retenção, limitação de tráfego/quota e testes em aparelhos físicos/Google DEV real. Não habilitar flags antes da revisão e combinação da homologação controlada.
