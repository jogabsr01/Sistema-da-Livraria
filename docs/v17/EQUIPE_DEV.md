# Equipe e primeiro acesso de funcionários — DEV

Incremento do v17, iniciado a partir da árvore de `dev/2528ca0636976d4d5c6833ce44d07d2681d12150`. Não cria contas reais nem altera `main`, a home ou a instalação Google.

## Produto e permissões

`/equipe-dev.html` apresenta cartões de funcionários, CPF mascarado, perfil, estado de ativação, e-mail/celular, paginação de 25 e edição em diálogo acessível. O administrador informa nome, CPF válido, e-mail, celular opcional, perfil, status e motivo obrigatório. Não existe exclusão definitiva de usuário.

- ADMIN cadastra/edita/desativa atendentes; não promove, altera ou desativa administradores.
- SUPER_ADMIN pode também cadastrar/gerenciar ADMIN. Esta tela não cria SUPER_ADMIN, não modifica a conta proprietária nem permite alterar o próprio acesso.
- Alteração de CPF de um funcionário exige SUPER_ADMIN e motivo registrado. O campo permanece vazio na edição para conservar o CPF existente; o navegador não recebe o CPF integral.
- Desativação, reativação ou mudança de perfil, CPF ou e-mail aumentam a versão de autorização, invalidam sessões e provas antigas e exigem novo primeiro acesso. Mudança somente de nome/celular conserva a ativação.
- Todos os controles são repetidos no Apps Script, sob ScriptLock e com a sessão corrente, nunca com papel enviado pelo navegador. Listagem e mudanças exigem passkey/MFA recente (cinco minutos).

## Primeiro acesso e login

A página existente `/acesso-dev.html` passa a aceitar CPF ou e-mail de funcionários previamente cadastrados. O código de uso único é entregue ao e-mail já cadastrado, nunca a um destino fornecido no formulário de acesso. A conta permanece pendente até comprovar o e-mail, definir PIN e cadastrar uma passkey. O login exige PIN **e** passkey para todos os papéis, inclusive atendentes. A conta proprietária conserva seu fluxo e endereço privados.

Respostas públicas não confirmam a existência da conta. Limites persistentes por identificador/origem, cooldown de entrega, tentativas do código, validade de dez minutos, CSRF, cookies HttpOnly e idempotência do commit permanecem aplicados. O CPF passa pelo mesmo orçamento de login que o e-mail, com validação de dígitos no servidor.

A recuperação de PIN/passkey, perfil/avatar e troca autônoma de e-mail **não** fazem parte deste incremento. A nova entrada aceita funcionários; a home com escolha de perfis será construída na etapa posterior solicitada pelo proprietário.

## Proteção dos dados pessoais

Novas chaves privadas, exclusivas de DEV e distintas das chaves existentes:

- `WORKSPACE_PERSONAL_DATA_KEY`: 32 bytes aleatórios em hexadecimal (64 caracteres).
- `WORKSPACE_PERSONAL_INDEX_KEY`: outros 32 bytes aleatórios em hexadecimal.

Não enviar esses valores no chat, repositório ou navegador. Configurar somente no gerenciador privado do ambiente DEV. Chaves iguais entre si ou iguais a assinatura, sessão, limite de login ou pepper de PIN são recusadas.

O contato completo fica em envelope `pd1` com AES-256-GCM, IV aleatório de 96 bits e autenticação associada ao ambiente, instalação, entidade e ID. Por compatibilidade com o schema v1, `Usuarios.Nome` contém o envelope do contato `{name,cpf,email,phone}`; `CPF`, `Email` e `Whatsapp` ficam vazios. Não editar essas células manualmente. Os índices de CPF/e-mail usam HMAC com domínio separado e servem apenas à busca exata/unicidade. Nome/celular/e-mail são descriptografados exclusivamente no backend autorizado. Não há busca global de nomes ou exposição de CPF completo na tela.

O motivo administrativo é cifrado no diário; a auditoria pública registra somente que o motivo foi registrado e os metadados de versão/perfil/status. Listagens também geram auditoria. Nem PIN, token, código de e-mail, CPF completo ou contato entram no log de mudança. Dados pessoais não são persistidos em localStorage/sessionStorage. A listagem administrativa tem `no-store`.

A perda das chaves torna os dados cifrados ilegíveis. Backup das chaves e rotação planejada devem usar um cofre privado; não trocar uma chave em uma instalação com registros sem um procedimento de migração. Ainda há pendências gerais de retenção, rotação e restauração do v17; este incremento não declara essas rotinas concluídas.

## Diário e recuperação

Entradas `staff.command.<UUID>` em Configuracoes guardam intenções com contato/motivo cifrados, versões antes/depois, ator e hash de integridade. `staff.revision.<ID>` controla edição concorrente; `identity.version.<ID>` revoga a identidade. Não adiciona abas ou escopos Google.

A intenção precede toda projeção. A versão de autorização é aplicada antes do usuário; sessão/autenticação e gestão recuperam intenções pendentes antes de ler. Cada fase é repetível, com um único log por comando. A mudança é recusada se há mais de uma intenção pendente, corrupção, edição concorrente, índices duplicados, contato da conta proprietária ou falta de capacidade.

O fingerprint privado usa HMAC e é estável com nova cifra/IV no reenvio. A tela conserva o comando **somente em memória** enquanto o resultado for incerto, bloqueia alterações e permite tentar o mesmo comando novamente. Se o navegador for fechado, confira o cadastro na lista antes de criar outro; não há fila offline de dados pessoais.

Limites atuais: 1.000 comandos de equipe; 5.000 usuários/configurações/logs nas tabelas compartilhadas. Há recusa explícita ao atingir a capacidade. Compactação/arquivamento geral continuam pendentes; não são simulados como uma capacidade ilimitada.

## API

- `GET /api/v1/staff/list?offset=0`: lista administrativa paginada, campos seguros e CPF mascarado.
- `POST /api/v1/staff/save`: `{commandId,id,expectedRevision,contact:{name,cpf,email,phone},role,status,reason}`. Em edição, `cpf:""` conserva o CPF atual.
- RPCs privados assinados `staff.list/get/save` e `identity.staffAccess.lookup/start`; não há rota pública de consulta do verificador de PIN ou do contato cifrado.

O formulário de acesso mantém os nomes de campos HTTP existentes (`email` pode conter CPF) para preservar compatibilidade. Os contratos internos existentes de `identity.access.read/email/pin/bind/commit/login` passam a validar também sujeitos funcionários cadastrados, conservando a prova WebAuthn e o papel autoritativo.

## Ativação posterior

Nenhuma flag foi habilitada por este trabalho. Após revisar os testes e somente na instalação DEV:

1. Atualizar o lote completo de Apps Script, incluindo **Staff.gs**, **Stock.gs** e **Notifications.gs**, preservando as propriedades/IDs.
2. Configurar privadamente as duas novas chaves em Netlify DEV. Não pertencem ao Apps Script.
3. Manter as flags existentes de backend/sessões/guardas/passkeys/acesso vinculadas ao DEV correto.
4. Após homologação combinada, ativar `WORKSPACE_STAFF_ENABLED=true` em DEV e `STAFF_ENABLED=true` no Apps Script DEV.
5. Homologar com contas de teste autorizadas, sem publicar dados pessoais; verificar MailApp, nova conta em outro aparelho, desativação e nova ativação.

Não requer novo provisionamento/migração nem OAuth adicional. O empacotador do kit agora inclui os arquivos de estoque/notificações/equipe que faltavam na lista de distribuição. Integração real, IAM, entrega Google e aparelhos reais serão tratados na etapa Google posterior.
