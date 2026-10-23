# Fase C: núcleo de proteção de credenciais

Entrega independente de ativação Google; depende da fundação e carrega os incrementos anteriores ainda não integrados. Não conclui autenticação nem libera o backend.

`backend/credential-core.mjs` fornece:

- PIN estritamente textual de quatro dígitos, scrypt com N=32768, r=8, p=1, salt aleatório de 32 bytes por registro e pepper privado de 32 bytes no servidor. O pré-processamento HMAC vincula o verificador a usuário, instalação e ambiente. Comparação de hashes em tempo constante. Os parâmetros KDF são fixos, não controlados pelo registro recebido.
- Tokens de sessão com 256 bits de entropia e codificação base64url canônica. A persistência futura recebe apenas HMAC do token, vinculado à instalação/ambiente. Chave de sessão separada do pepper e da assinatura Google. O token bruto deve existir somente no retorno privado que emitirá cookie Secure/HttpOnly.
- Recusa de configuração ausente, formato de PIN/token inválido e registros KDF incompatíveis.

As chaves são recebidas por injeção no código servidor; não foram criadas variáveis de produção, cadastradas credenciais ou gravados segredos no repositório. Os testes geram chaves aleatórias e usam apenas dados fictícios. Nenhum dado pessoal fornecido em conversa foi incorporado.

## Limites obrigatórios antes da ativação

Quatro dígitos oferecem apenas 10.000 combinações; KDF e pepper não substituem limite persistente de tentativas, bloqueio e proteção contra enumeração. Implementar estado de tentativas compartilhado e atômico, matrícula com e-mail verificado, segundo fator em dispositivo novo, MFA/passkeys para administradores, autorização versionada e revogação de sessão. Não ligar este módulo diretamente ao login do protótipo.

Ainda faltam emissão/leitura de cookies, expiração e revogação persistente, CSRF, fluxo de recuperação, gestão/rotação de chaves e integração com identidade comprovada. Nenhum cookie ou sessão autenticada é criado por esses helpers. `backend/auth.mjs` continua recusando autenticação real. Os PINs demonstrativos continuam restritos ao protótipo local.

A conta master não foi criada. O PIN divulgado em conversa não deve ser reutilizado na ativação. O responsável deverá comprovar a identidade por fluxo privado, sem publicar CPF, e-mail ou PIN em código, planilhas de teste, logs ou issues.

## Validação

Cinco testes de segurança verificam salt distinto, PIN incorreto, isolamento entre usuários/instalações/ambientes/peppers, recusa de registros malformados, configuração inválida e tokens canônicos exclusivos. São testes unitários reais do módulo crypto do Node, sem identidade Google real ou envio de e-mail.
