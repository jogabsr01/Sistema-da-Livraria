# Entrada e abertura dos módulos DEV

O acesso com chave salva abre o seletor nativo a partir do clique em “Entrar com biometria”, sem consultar o Google antes desse seletor. A escolha não depende do preenchimento do CPF/e-mail nem do PIN. A chave precisa ser reconhecida pelo gerenciador de credenciais do navegador/aparelho; sincronização entre aparelhos depende desse gerenciador. O aplicativo não armazena biometria nem chave privada.

O desafio é aleatório, curto e vinculado ao cookie de pré-acesso por recibo autenticado. Depois da resposta nativa, uma operação Google resolve a chave/usuário e revalida situação, versão e controles de tentativa. A assinatura WebAuthn, origem, RP, desafio e verificação do usuário continuam obrigatórios. A gravação da prova e a conclusão usam as operações existentes, com desafio de uso único. Nenhum cookie de sessão é emitido antes da conclusão. A política de administração permanece forte; esta mudança não libera administração apenas com PIN.

O acesso concluído substitui a página pela Home. Uma sessão ainda válida também leva à Home quando a página de acesso é revisitada. `?confirmar=1#entrar` solicita nova autenticação explicitamente para operações sensíveis; `#recuperar-pin` conserva o fluxo de recuperação. `?verificar=1` mantém a visualização de confirmação quando ela é solicitada explicitamente. O botão Voltar continua sujeito à validação da sessão no destino. Não foram ampliados os prazos de sessão nem desativadas revogações.

“Lembrar meu CPF ou e-mail neste navegador” guarda somente o identificador e uma validade de 30 dias no armazenamento local. A opção pode ser desmarcada para removê-lo. PIN, códigos, recibos e tokens não são gravados nesse armazenamento. A sessão usa cookie Secure/HttpOnly/SameSite.

## Menos consultas na abertura

Catálogo e Caixa usam `catalog.bootstrap`: uma operação assinada devolve sessão atual, nichos e primeira página, mantendo permissões e recuperação dentro da mesma trava. Abrir `catalogo-dev.html?novo=1` pede os nichos e o formulário, sem varrer os produtos antes de iniciar um cadastro. Ao fechar o formulário, a lista é consultada.

Perfil e equipe usam operações próprias de abertura com principal e dados validados. As páginas conservam a conferência final independente de sessão antes de exibir dados pessoais. Não existe cache de autorização entre solicitações. Gravações conservam suas verificações e confirmações.

Essas reduções eliminam consultas repetidas; não garantem tempo instantâneo do Google. Medir novamente o DEV publicado. A telemetria registra apenas fase, duração e resultado permitido, sem identificadores, PIN ou conteúdo das respostas.

## Ativação do catálogo e compras

Após publicar o código Google atualizado, a conta proprietária executa uma vez `activateDevelopmentStorefront` no editor Apps Script DEV. A função prepara o catálogo com os backups existentes, verifica esquema, vínculos privados e recuperação; então configura apenas `CATALOG_ENABLED=true` e `CHECKOUT_ENABLED=true`. Ela não é exposta como comando HTTP. Reexecução não apaga produtos nem recria o esquema.

No Netlify, configurar `WORKSPACE_CATALOG_ENABLED=true` e `WORKSPACE_CHECKOUT_ENABLED=true` no contexto da branch **dev**, e gerar novo Branch Deploy. Não aplicar esses valores à produção. A ativação das duas camadas é necessária; publicar código sozinho não ativa módulos. Serviços opcionais, como consulta ISBN externa, fotos e clientes, mantêm suas próprias configurações.

Confirmar em conta autorizada: Home → Adicionar novo produto → formulário → salvar um cadastro descartável → pesquisar → Nova compra. Não registrar uma venda real durante a homologação.
