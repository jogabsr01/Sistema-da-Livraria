# Segurança e plano de identidade

## Controles já implementados na fundação

- Configuração restrita a `branch-deploy/dev/hostname DEV` ou `production/main/hostname PROD`. Deploy previews, contexto desconhecido e chaves/bindings ausentes recusam o backend.
- Backend desativado por padrão. Leitor de sessões persistentes implementado e desativado por padrão; primeiro acesso/emissor ainda não implementados. Todas as chamadas administrativas reais permanecem fechadas. Nenhuma credencial fixa ou conta SUPER_ADMIN foi criada.
- Contrato administrativo exige ADMIN/SUPER_ADMIN, identidade UUID e MFA/passkey recente. Mesmo uma identidade válida de ATENDENTE é rejeitada no servidor.
- Bridge HMAC-SHA256 com chave aleatória de 256 bits privada, mensagens UTF-8/base64, domínios separados para request/response e comparação de assinatura constante para tamanho fixo.
- Envelope assina ambiente, instalação, IDs de recursos, ação, identidade afirmada pelo backend, timestamp, ID e nonce. Janela de 120 segundos e tolerância futura de 30 segundos. Nonce é armazenado em hash sob lock por cinco minutos; replay é recusado. Cache volátil não é a única defesa.
- Resposta também é assinada e correlacionada ao request. Redirect de ContentService aceita somente HTTPS `script.googleusercontent.com`, por GET sem reenviar o POST assinado. Redirect 307/host não confiável é recusado. Timeout e conteúdo inválido falham fechados.
- Apps Script confirma os marcadores de propriedade dos recursos. Um ID de planilha PROD em configuração DEV não é relabelado, migrado ou escrito. Compartilhamento público ou de domínio é recusado; permissões nominais e ausência de acesso DEV a PROD ainda exigem revisão do proprietário.
- Build por allowlist. Backend, Apps Script, testes, configuração e arquivos de ambiente não são publicados como conteúdo estático. Nenhuma autorização depende de esconder menus.
- Erros da API só contêm código seguro e ID aleatório de correlação. Não retornam exceções, payloads, e-mails, URLs privadas ou segredos.

Esses controles não equivalem a autenticação de usuário pronta nem a verificação de IAM no Google. O cliente HMAC e o emulador não são prova de instalação Google real.

## Identidade para a Fase C — parcialmente implementada, sem ativação

O PIN de quatro dígitos tem apenas 10.000 possibilidades; hash com salt não resolve sozinho sua baixa entropia. O desenho exige:

1. Funcionário ativo previamente cadastrado, com convite/challenge de posse de e-mail de uso único e prazo curto. Armazenar somente hash do token; limitar tentativas e não revelar existência da conta em respostas públicas.
2. Verificadores de PIN em armazenamento privado separado de Usuarios, com KDF adequado (scrypt/Argon2id de biblioteca mantida), salt individual e pepper fora desse armazenamento. Não registrar PIN, hash ou fator em logs.
3. Verificação adicional em dispositivo novo. Para ADMIN/SUPER_ADMIN, exigir passkey/WebAuthn ou outro MFA forte em cada acesso; não inferir MFA apenas de um e-mail verificado ou de um claim não validado. WebAuthn deve usar biblioteca mantida e RP ID/origem por ambiente.
4. Rate limiting persistente por conta e origem, contadores atômicos, bloqueio progressivo e recuperação segura. Os nonces da Fase A não substituem esse controle.
5. Sessão aleatória de alta entropia em cookie `__Host-...` Secure, HttpOnly, SameSite e Path=/, sem Domain. Guardar somente SHA-256 do token no servidor, com expiração, revogação, nível de autenticação e versão de autorização. Não usar localStorage como prova de identidade.
6. Proteção CSRF em mutações autenticadas, origem exata, token apropriado, reautenticação para PIN/e-mail/privilégios e revogação de outras sessões. Nunca aceitar `role`, `userId` ou preço autoritativo vindo do browser.
7. Bootstrap de SUPER_ADMIN por procedimento privado, identidade verificada e execução de uso único auditada. `OWNER_EMAIL` do provisionamento Google não cria uma conta administrativa da livraria.

Leitura/revogação persistente de sessões, cookies, autorização e CSRF estão implementados conforme [SESSOES_E_PERMISSOES.md](SESSOES_E_PERMISSOES.md). Cadastro verificado, emissor, limites persistentes, prova de MFA/passkeys e recuperação continuam pendentes na fase C. A fundação não oferece um modo de contornar esse bloqueio por variável de ambiente.

## Separação e privacidade

DEV e PROD precisam de contas/principais, projetos Apps Script, instalações UUID, chaves HMAC, chaves de cifragem/índice, planilhas e pastas distintos. A identidade DEV não pode ter permissão de edição de recursos PROD. Esse controle depende do proprietário Google, além das validações de código.

Antes de aceitar dados pessoais, implementar cifragem AEAD com nonces únicos e rotação/versionamento; manter chaves fora do Git, do frontend e da planilha. CPF/e-mail/endereços e contatos devem ser minimizados, mascarados nas respostas e acessíveis somente por autorização específica. Índices HMAC são pseudonimização, não anonimização. Definir retenção e eliminação legítima também em backups.

Logs operacionais não devem receber corpos de requisição, cookies, tokens, PINs ou CPF. O journal de vendas usa referências mínimas a clientes; auditoria registra campos alterados e IDs, evitando duplicar PII em Antes/Depois. Exportação deve ser autorizada e auditada, neutralizar fórmulas e usar arquivos privados temporários.

O validador de importação desta fase recusa dados de clientes/vendas, identificadores duplicados, relações inválidas e strings suspeitas de fórmulas. Não é o importador de produção nem uma garantia automática de ausência de PII em texto livre. Escritas de negócios ainda precisam de validação/escape no servidor.

## Riscos não resolvidos nesta fase

Quotas e latência Google não medidas; bloqueio é por projeto e não um banco transacional; IAM/sharing não verificados; KDF, leitor/revogador de sessões e CSRF implementados, porém emissão/MFA/limites persistentes e homologação Google de identidade ainda pendentes; auditoria não é imutável contra o dono da planilha; front continua demo e armazena dados fictícios localmente. Não habilitar operação real ou carregar PII com essa entrega.
