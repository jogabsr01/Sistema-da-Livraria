# Entrada administrativa com PIN no DEV

Em 29/10/2026, o proprietário autorizou explicitamente administrador com PIN de quatro números, após ser informado da proteção menor. Essa escolha se aplica somente à instalação DEV. A biometria continua disponível como alternativa de entrada; cadastro de chaves, recuperação e alteração de e-mail mantêm suas provas específicas.

`WORKSPACE_ADMIN_PIN_LOGIN_ENABLED` (Netlify) e `ADMIN_PIN_LOGIN_ENABLED` (Google) aceitam `true` ou `false`. Na instalação DEV vinculada, a ausência significa a política autorizada, habilitada. `false` em qualquer lado impede concessão administrativa por PIN; para retornar ao fluxo com biometria, defina ambos como `false`. Produção não habilita essa política.

O PIN continua verificado por scrypt com segredo privado e tentativas limitadas persistentemente por conta e origem. Um recibo cifrado, vinculado ao cookie de pré-acesso e com validade curta, permite concluir a gravação numa segunda chamada Google. A conclusão verifica novamente conta ativa, versão de autorização e registro atual do PIN. A sessão declara autenticação `pin`, nunca `passkey` ou `mfa` artificial.

A sessão mantém limite absoluto de oito horas, inatividade de trinta minutos e revogação persistente. O cookie é Secure, HttpOnly e SameSite. A confirmação do transporte do cookie acontece antes de abrir a Home. Falhas parciais são retomadas pelo mesmo identificador de operação, sem emitir sessões duplicadas.

Validação automatizada: contrato Node/Google em armazenamento descartável e Chromium com WebAuthn virtual. Inclui entrada por PIN, biometria alternativa, prova forte explicitamente solicitada, cookie ausente, retorno do navegador e abertura do cadastro de produto. Esses testes não equivalem a uma sessão real do proprietário no Netlify: o navegador remoto disponível encontra o bloqueio de acesso da hospedagem.
