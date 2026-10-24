# Perfil e recuperação de PIN — DEV

`meu-perfil-dev.html` mostra somente o perfil da sessão: nome, CPF mascarado (ausente no bootstrap do proprietário), e-mail, papel, último acesso, telefone e avatar. Funcionários alteram telefone/foto; nome e CPF permanecem administrativos. O proprietário pode definir nome de exibição, preservando seu e-mail privado de autenticação. E-mail não é editável neste lote.

O menu da conta aparece no catálogo, Caixa, equipe, operações e notificações quando o módulo está habilitado. Inclui perfil, recuperação de PIN, notificações e saída. No perfil há revogação das outras sessões. Alterações exigem CSRF, origem DEV exata e autenticação forte de até cinco minutos, validada também no Apps Script. O servidor deriva a conta da sessão; não aceita usuário, papel, CPF ou e-mail no formulário de alteração.

## Dados e fotos

Contatos usam as chaves AES-GCM/índice de dados pessoais já existentes. Para funcionários preserva-se o contato cifrado em `Usuarios.Nome`; o proprietário mantém o nome de bootstrap vazio e usa registro cifrado `profile.owner.<id>` em Configuracoes. Revisão `staff.revision.<id>` impede sobrescrever edições administrativas concorrentes.

Avatar: JPEG/PNG/WebP selecionado é recortado para 256×256 no navegador; o backend valida e reprocessa em JPEG, retirando metadados. Limites: seleção até 8 MB/24 milhões de pixels, entrada do backend até 64 KiB, JPEG final até 48 KiB. Fonte excessiva deve ser reduzida antes de enviar. A pasta `profiles` e seus arquivos permanecem privados; `/api/v1/profile/photo` serve apenas a foto da própria conta, com `private, no-store`. Não retorna link público/ID Drive. Remover foto limpa a referência; arquivos antigos são preservados privados até existir política de retenção.

`profile.command.<UUID>` registra intenção cifrada, revisão, fingerprint e snapshots antes das projeções. Repetição do mesmo comando/fingerprint não duplica auditoria ou foto; outra carga conflita. Recuperação conclui intenções mesmo com flag desligada. Formulário mantém comando incerto somente em memória para repetir, bloqueando alteração até confirmar; não persiste contato/foto em localStorage/IndexedDB. Fechar a página pode perder a confirmação; reabrir consulta o estado autoritativo.

## PIN esquecido

`acesso-dev.html#recuperar-pin` exige código enviado ao e-mail já vinculado **e uma passkey previamente cadastrada**. CPF pode localizar funcionário, mas entrega sempre usa seu e-mail cifrado cadastrado. Conta inexistente/inativa/não ativada e falha de envio têm resposta inicial genérica; guardas persistentes limitam tentativas. E-mail sozinho não permite cadastrar passkey substituta.

Após os dois fatores, intenção durável incrementa a versão de autorização antes de atualizar o PIN scrypt, preserva a passkey comprovada nessa nova versão, revoga outras passkeys, fluxos e sessões e emite uma sessão nova. Auditoria não contém PIN/código/contato. Reexecução mantém sessão e prazo originais; não renova acesso por repetir. Falhas intermediárias são recuperadas antes de aceitar sessões antigas, inclusive após desligar a flag de recuperação. Atualizar todos os arquivos Apps Script juntos é obrigatório.

Este lote não implementa recuperação do proprietário sem nenhuma passkey nem alteração autônoma de e-mail. Não há desvio por e-mail apenas. Para funcionários, o procedimento administrativo existente de desativar/reativar exige nova inscrição e revoga o acesso anterior. O procedimento excepcional do proprietário e gestão completa de credenciais permanecem pendentes de definição/homologação.

## Implantação posterior

Flags Netlify DEV: `WORKSPACE_PROFILE_ENABLED`, `WORKSPACE_RECOVERY_ENABLED`. Flags Apps Script: `PROFILE_ENABLED`, `RECOVERY_ENABLED`. Todas fechadas por padrão. Requerem identidade/sessões e, para recuperação, acesso/guardas/passkeys; acesso de funcionários requer ainda o módulo de equipe. Perfil usa as chaves de dados pessoais existentes e `PROFILES_FOLDER_ID` privado com marcador original. Sem escopo ou aba novos; propósitos da tabela privada `_Identity_Flows` passam a admitir RECOVER. Não rotacionar chaves nem reinicializar recursos existentes.

Publicação de código em DEV não configura propriedades, Google, MailApp ou Drive reais. Esses testes usam emulação e contatos fictícios. Home dos perfis e configuração Google real continuam na etapa posterior solicitada.
