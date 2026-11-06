# Perfil, navegação e entrada DEV

O código dos módulos estava publicado, mas o relatório real de configuração do proprietário mostrava PROFILE, STAFF, REPORTS e outros módulos como NOT_SET no Google. As respectivas flags Netlify também precisam estar habilitadas. Publicar código não ativa essas flags. O erro de perfil não era ausência do formulário implementado: a configuração interrompia o bootstrap antes de carregá-lo.

O menu administrativo dependia indevidamente do sucesso da personalização de perfil. Agora os módulos propagam o papel da sessão já validada para apresentação da navegação; se o perfil estiver fechado, o menu consulta a sessão em vez de perder as opções administrativas. Permissões continuam verificadas no servidor em cada operação. O menu superior reúne Meu perfil, Gerenciar equipe e Relatórios, respeitando o papel. Catálogo e Rotina agrupam as demais opções. A marca substituta em forma de letra foi removida.

Perfil e equipe recebiam o principal e CSRF no bootstrap autenticado e imediatamente faziam uma consulta adicional de sessão. Essa segunda leitura foi retirada da abertura, mantendo validação do principal do bootstrap, vínculo do usuário, controle de contexto e autenticação de todas as gravações no servidor. Não há cache de autorização entre requisições.

Na validação Google, um cabeçalho válido já lido no batch da própria requisição comprova que a primeira linha existe. Consultar getLastRow separadamente para cada uma das 17 tabelas era redundante. Essa consulta foi eliminada para cabeçalhos válidos; migração, todos os cabeçalhos, extensão de colunas, vínculos privados e conflitos continuam conferidos a cada requisição. A classificação de abas ausentes/vazias e conflitos foi preservada. Não há cache entre chamadas nem promessa de tempo instantâneo no Apps Script.

A transição após login deixa de exibir a tela de confirmação e o convite público de entrada enquanto a Home verifica a sessão. A tela de verificação explícita continua disponível. O contador opcional de notificações também não consulta o Google se estiver oculto num menu fechado ou se o módulo ainda não confirmou uma sessão, evitando concorrer com a abertura.

## Conclusão da ativação

1. Preservar as seis chaves privadas do backend. Confirmar WORKSPACE_PERSONAL_DATA_KEY e WORKSPACE_PERSONAL_INDEX_KEY no DEV/Functions. Não substituir chaves existentes: dados já cifrados dependem delas.
2. Importar somente as flags de ATIVACAO_COMPLETA_DEV.env.example no contexto DEV e Functions, preservando as demais variáveis. A configuração de produção não deve ser alterada.
3. No editor Google DEV, executar activateDevelopmentWorkspace uma vez com a conta proprietária. A função prepara os recursos existentes, cria somente as pastas privadas necessárias e habilita os módulos de negócio implementados. É idempotente; não altera PIN, usuários, credenciais ou sessões. A recuperação de emergência por códigos continua sendo uma opção separada.
4. Publicar novamente o Branch deploy DEV para aplicar as variáveis e verificar o perfil, equipe e relatórios.

O assistente conectado não possui acesso à configuração do Netlify nem execução do editor como proprietário; essas duas etapas não podem ser declaradas concluídas apenas porque um deploy terminou com sucesso.
