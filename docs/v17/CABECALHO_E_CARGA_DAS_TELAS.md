# Cabeçalho compartilhado e carga principal das telas

A gravação de 30/10/2026 (95 segundos, analisada por quadros de toda a sequência) mostrou aproximadamente quarenta segundos de entrada, outra espera ao abrir a Home, perfil sem campos carregados e avisos de operação concorrente em perfil/notificações. Os cabeçalhos tinham larguras, posições e conteúdo diferentes entre Home, perfil, notificações e catálogo.

## Correções

O build agora usa um único template de cabeçalho para as 13 telas internas DEV, antes do conteúdo principal. Mantém a logo original, Início, Catálogo, Rotina e Conta, em posição sticky e com dimensões compartilhadas. Títulos e IDs dos controladores de cada página permanecem no conteúdo. A entrada pública não recebe menus internos. O protótipo original permanece intacto. Os grupos duplicados abaixo da Home foram retirados.

O controlador do cabeçalho é somente apresentação: não busca perfil nem sessão ao abrir menus e não remove/recria a navegação no foco da janela. Recebe o papel já validado pelo bootstrap da página, atualiza as opções administrativas e aproveita dados de perfil quando a própria página os fornece. Apenas a ação explícita de sair consulta/revoga a sessão. Menus abrem localmente, apenas um por vez; Escape e clique externo fecham o grupo. O conteúdo das operações continua protegido no servidor, independentemente dos links visíveis.

A abertura de notificações antes consultava sessão, lista e resumo por caminhos separados, inclusive com operações concorrentes no Google. O novo bootstrap assinado retorna principal, lista e resumo numa só operação, mantendo filtros por destinatário, papel, revogação e versão, com CSRF derivado do cookie da sessão. O backend Node valida o principal e os DTOs antes de responder. Operações de leitura, mudança de estado e exportação continuam com suas autorizações anteriores.

A alteração de e-mail do perfil deixou de iniciar três consultas de segurança em segundo plano logo após carregar os dados. A seção é expansível e carrega somente por ação explícita; provas fortes e confirmação de código permanecem. O perfil também não inicia consultas repetidas por foco enquanto ainda está carregando ou tem dados recentes, nem faz polling periódico sem ação do usuário.

Sessão e bootstraps de perfil/equipe reutilizam metadados e linhas apenas dentro da mesma requisição assinada sob ScriptLock. As gravações de recuperação usam os invalidadores centrais antes de tocar nas planilhas. Nada é armazenado como autorização entre requisições; todas as leituras continuam verificando a conta, sessão, revogação, versão e permissões.

Uma resposta BUSY assinada, emitida antes de obter o lock e antes de registrar nonce/operar dados, permite somente uma nova tentativa dos bootstraps e da leitura de sessão, com envelope novo e prazo total limitado. Falhas de transporte, autenticação rejeitada e gravações não são repetidas automaticamente. As métricas Google identificam as leituras de sessão e cada bootstrap com nomes fechados, sem dados pessoais.

## Verificação e limites

502 testes Node completos; testes adicionais do código Google gerado; Chromium com Google simulado carrega Home, perfil, notificações e cadastro de produto, compara a geometria do mesmo cabeçalho e comprova zero chamadas ao abrir menus. Verifica campo de e-mail, contato e formulário de produto, além de viewport mobile e menu fixo após scroll. Testes de perfil, notificações, alteração de e-mail e reconexão validam dados e recuperação de comandos pendentes.

Esses testes não substituem o E2E autenticado do proprietário na hospedagem. Não há promessa de entrada instantânea: a instalação usa Sheets/Apps Script, com ScriptLock e validações de armazenamento. A latência real após a publicação precisa das métricas de uma nova tentativa no DEV. Nenhum dado ausente foi preenchido artificialmente e nenhuma alteração de permissões ou produção foi feita.
