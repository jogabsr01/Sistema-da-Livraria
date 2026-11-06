# Fase C: núcleo de proteção de credenciais

Registro histórico do núcleo de credenciais, já integrado em dev. Os helpers descritos abaixo continuam internos. Para o estado atual de sessões, limites, WebAuthn e primeiro acesso/login do proprietário em revisão, consultar [STATUS_V17.md](STATUS_V17.md) e [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md). O backend Google real permanece desligado.

`backend/credential-core.mjs` fornece:

- PIN estritamente textual de quatro dígitos, scrypt com N=32768, r=8, p=1, salt aleatório de 32 bytes por registro e pepper privado de 32 bytes no servidor. O pré-processamento HMAC vincula o verificador a usuário, instalação e ambiente. Comparação de hashes em tempo constante. Os parâmetros KDF são fixos, não controlados pelo registro recebido.
- Tokens de sessão com 256 bits de entropia e codificação base64url canônica. A persistência futura recebe apenas HMAC do token, vinculado à instalação/ambiente. Chave de sessão separada do pepper e da assinatura Google. O token bruto deve existir somente no retorno privado que emitirá cookie Secure/HttpOnly.
- Recusa de configuração ausente, formato de PIN/token inválido e registros KDF incompatíveis.

As chaves são recebidas por injeção no código servidor; não foram criadas variáveis de produção, cadastradas credenciais ou gravados segredos no repositório. Os testes geram chaves aleatórias e usam apenas dados fictícios. Nenhum dado pessoal fornecido em conversa foi incorporado.

## Limites obrigatórios antes da ativação

Quatro dígitos oferecem apenas 10.000 combinações; KDF e pepper não substituem limite persistente de tentativas, bloqueio e proteção contra enumeração. Implementar estado de tentativas compartilhado e atômico, matrícula com e-mail verificado, segundo fator em dispositivo novo, MFA/passkeys para administradores, autorização versionada e revogação de sessão. Não ligar este módulo diretamente ao login do protótipo.

Leitura/revogação persistente, cookies, expiração, CSRF e verificações fortes já foram integrados em incrementos posteriores. O novo controlador em revisão emite sessão após e-mail/PIN/passkey; o leitor só aceita estado persistente completo. Recuperação de conta e gestão/rotação de chaves continuam pendentes. Nenhum cookie ou sessão autenticada é criado por esses helpers isolados. Os PINs demonstrativos continuam restritos ao protótipo local.

A conta master não foi criada. O PIN divulgado em conversa não deve ser reutilizado na ativação. O responsável deverá comprovar a identidade por fluxo privado, sem publicar CPF, e-mail ou PIN em código, planilhas de teste, logs ou issues.

## Validação

Cinco testes de segurança verificam salt distinto, PIN incorreto, isolamento entre usuários/instalações/ambientes/peppers, recusa de registros malformados, configuração inválida e tokens canônicos exclusivos. São testes unitários reais do módulo crypto do Node, sem identidade Google real ou envio de e-mail.

## Incremento seguinte

O leitor/revogador de sessões persistentes, cookies, autorização e CSRF já estão implementados em revisão: [SESSOES_E_PERMISSOES.md](SESSOES_E_PERMISSOES.md). Primeiro acesso, emissor, prova de MFA e limites persistentes continuam pendentes. Esta nota atualiza o estado sem transformar as validações antigas em homologação real.
