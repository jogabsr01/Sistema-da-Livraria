# Revisão de mensagens e desempenho do DEV

## Critérios de experiência

Erros de validação identificados pelo servidor indicam somente o campo que falhou. O navegador destaca o campo e associa a mensagem por `aria-describedby`, preservando o conteúdo digitado. Erros de primeiro acesso ficam dentro desse formulário. Diálogos de equipe, clientes, catálogo, perfil, nichos e escalas mantêm seus erros no próprio diálogo/formulário, sem duplicá-los no topo da página.

Falha de leitura significa que os dados não puderam ser carregados; não significa que uma gravação ocorreu. Falha de transporte depois de uma alteração pode deixar o resultado incerto. Nesse caso preserva-se o comando para conferir/repetir pelo mecanismo idempotente existente; não se informa sucesso nem se cria outra operação. Somente uma resposta validada do servidor confirma a conclusão.

Manutenção, fila ocupada, capacidade temporária, serviço indisponível, falha de configuração, erro de formato e conflito de edição são causas distintas. Não interpretar uma falha de leitura ou resposta inválida como PIN incorreto. Dados inválidos recuperados do armazenamento são uma falha do serviço, não um erro nos campos que a pessoa acabou de digitar.

`ui-messages.js` centraliza mensagens compartilhadas e campos seguros. O build incorpora o arquivo aos controladores existentes; não adiciona uma requisição para carregar essa tabela. As mensagens específicas de cada operação continuam nos controladores. Valores, mensagens de exceções, corpos HTML de provedores, chaves, PINs e códigos de e-mail não são interpolados nas mensagens públicas. O protótipo local também trata falhas inesperadas com texto seguro; os diagnósticos técnicos permanecem separados do fluxo do usuário.

## Cadastro master e identificação

O cadastro inicial do proprietário contém somente e-mail. Uma pessoa não pode associar um CPF arbitrário apenas digitando-o na entrada pública. O primeiro acesso do master continua por esse e-mail, código de uso único, PIN e confirmação pelo aparelho.

Depois da autenticação forte, Meu perfil permite vincular o CPF do proprietário uma vez. O CPF é validado, cifrado com AES-GCM e indexado por HMAC no backend; somente a máscara volta ao navegador. A vinculação não substitui e-mail, PIN, passkey, papel ou versão de autorização. Duplicatas são recusadas e as projeções interrompidas se recuperam com o mesmo comando. O diário protege também o marcador de vinculação. Não gravar CPF integral em células, logs ou armazenamento do navegador.

Para funcionários previamente cadastrados, CPF/e-mail localizam o cadastro protegido. O código é enviado ao endereço desse cadastro. Para o proprietário com CPF já vinculado, a busca resolve o endereço privado atual de autenticação. Não aceitar um endereço de entrega livre junto com o CPF.

Por solicitação do proprietário, primeiro acesso diferencia cadastro inexistente, já ativado, entrega recente e falha de entrega. Isso confirma a existência/elegibilidade de um identificador nessa entrada. Login e recuperação conservam suas respostas genéricas e o mesmo trabalho de verificação de PIN para credenciais desconhecidas; permanecem os limites duráveis por identificador/origem, cooldown, prazo de dez minutos e limites das provas. Não retornar o endereço de entrega na busca pública por CPF.

## Matriz de cenários automatizados

| Fluxo | Falhas e comportamento verificados | Evidência executável |
| --- | --- | --- |
| Abertura do acesso | Consulta indisponível, HTML inesperado, timeout e nova leitura: mensagem de carregamento, zero POST, zero sessão criada | `scripts/test-owner-access.py` |
| Primeiro acesso | E-mail incompleto sem POST; CPF com formato inválido; CPF sem configuração; cadastro inexistente/já ativo; entrega recente/falha de envio; erro no próprio box, sem deslocar o usuário para o login | `scripts/test-owner-access.py`, `tests/backend/owner-access.test.mjs`, `tests/backend/user-messages.test.mjs` |
| Código recebido | Código errado, vencido, reutilizado ou de outro navegador; espera limitada incluindo corpo da resposta; confirmação perdida exige leitura, nunca reenvio da prova | `scripts/test-owner-access.py`, `tests/backend/owner-access.test.mjs` |
| PIN | Quatro números, confirmação igual, repetição adjacente proibida para PIN novo; visibilidade acessível; gravação perdida conserva a etapa real | `scripts/test-owner-access.py` |
| Aparelho e sessão | Erro ao preparar opções distinguido do cancelamento da janela; assinatura alterada nunca concede sessão; confirmação interrompida/recarregada não duplica sessão | `scripts/test-owner-access.py`, `tests/backend/passkeys.test.mjs` |
| Equipe | CPF/e-mail inválidos identificados por campo; CPF duplicado separado de e-mail duplicado; cadastro inativo/conflito; proibição de alterar a própria autorização | `scripts/test-staff.py`, `tests/backend/staff.test.mjs`, `tests/backend/user-messages.test.mjs` |
| Perfil | CPF do master cifrado/mascarado, duplicado, imutável após vínculo; campo inválido no formulário; falha antes/depois das projeções; armazenamento inválido não culpa a pessoa | `scripts/test-profile.py`, `tests/backend/profile.test.mjs`, `tests/backend/experience.test.mjs`, `tests/backend/user-messages.test.mjs` |
| Troca de e-mail | Código errado/vencido, conflito de cadastro, confirmação perdida, cancelamento, retorno à etapa confirmada; mantém destino atual até confirmar | `scripts/test-email-change.py` |
| Catálogo | ISBN/título/preço/estoque mínimo inválidos; duplicata; edição concorrente; foto inválida; perda de resposta não duplica livro | `scripts/test-catalog.py`, `tests/backend/user-messages.test.mjs` |
| Caixa e clientes | Cliente inexistente/CPF duplicado; CPF/e-mail/telefone/CEP/UF inválidos; contato sem consentimento; estoque/preço alterado; venda pendente permanece conferível | `scripts/test-checkout.py`, `scripts/test-customers.py`, `tests/backend/user-messages.test.mjs` |
| Operações e estoque | Ajuste sem motivo ou saldo inválido; saldo sem mudança; venda não encontrada; reversão/conflito; autorização e recuperação sem baixa duplicada | `scripts/test-operations.py`, `tests/backend/operations.test.mjs` |
| Escalas | Data e horários inválidos; pessoa indisponível, sobreposição e edição concorrente; erros no formulário | `scripts/test-schedules.py`, `tests/backend/schedules.test.mjs` |
| Nichos | Nome duplicado, conflito, imagem inválida e perda de resposta; erro no próprio diálogo | `scripts/test-niches.py` |
| Notificações | Filtro/estado inválido, notificação ausente ou alterada e acesso recusado; sem movimentação automática de estoque | `scripts/test-notifications.py` |
| Relatórios, auditoria e perfil de compra | Filtros inválidos, CPF/ISBN inválidos, fonte alterada, consulta vencida, capacidade e resposta malformada; não liberar exportação/texto parcial | `scripts/test-reports.py`, `scripts/test-audit.py`, `scripts/test-customer-insights.py` |
| Chaves e recuperação | Última chave, capacidade, confirmação recusada, conta alterada, provas antigas e modo de recuperação; nenhuma liberação baseada na aparência da tela | `scripts/test-key-management.py`, `scripts/test-account-reconnection.py`, `tests/backend/recovery.test.mjs` |
| Manutenção/fila | Manutenção ativa não é PIN incorreto nem falha de rede; bloqueio concorrente preservado, sem escrita antes de obter exclusividade; reconciliação usa o comando original | `scripts/test-maintenance.py`, `tests/backend/maintenance.test.mjs`, `tests/backend/experience-performance.test.mjs` |
| Mensagem desconhecida | Código não reconhecido, campo forjado e texto privado do provedor nunca viram mensagem pública; mantém orientação segura e não exibe sucesso | `tests/backend/user-messages.test.mjs`, `scripts/test-owner-access.py` |

Os testes usam dados sintéticos, Google/MailApp emulados e autenticação WebAuthn com assinaturas reais de um autenticador virtual. Não enviam e-mails reais, não executam operações de produção e não homologam biometria de um aparelho físico.

## Reduções de trabalho verificadas

| Operação | Antes | Depois |
| --- | --- | --- |
| Solicitar código do proprietário por e-mail | 2 RPCs Google | 1 comando fixo com guarda durável |
| Confirmar código | 2 RPCs Google | 1 comando fixo com guarda durável |
| Salvar PIN | 3 RPCs Google | 2 RPCs; leitura/guarda reunidas antes do hash |
| Validação de sessão numa alteração autenticada | 2 RPCs idênticos de sessão | 1 RPC; CSRF derivado somente do principal/cookie desta instância de serviço |
| Cabeçalhos numa consulta de estado | 30 leituras no cenário de controle | 24 leituras, todas as tabelas ainda validadas |
| Leituras de dados para preparar confirmação do aparelho | 23 leituras no controle sem snapshots | 8 leituras no mesmo comando com exclusividade e invalidação nas escritas |
| Consulta opcional de sessão ao retomar código/PIN/aparelho | 1 consulta concorrente com a etapa | 0 consultas concorrentes; só confere sessão ao concluir acesso |
| Menu da conta ao carregar a página | 3 consultas HTTP automáticas | 0 consultas automáticas |
| Abrir o menu sem dados de perfil carregados | 3 consultas HTTP | 1 consulta autorizada de perfil |
| Menu dentro de Meu perfil | Outra sequência de consultas | Reutiliza o DTO que a página acabou de carregar, somente para apresentação |

As otimizações não guardam sessões, usuários, permissões ou linhas de negócio entre solicitações. O reaproveitamento de cabeçalhos/handles existe somente dentro da operação com bloqueio e é descartado inclusive nas falhas. Todas as novas solicitações revalidam as tabelas. A operação de negócio no Google continua recusando revogação ou alteração de papel ocorrida depois da autenticação no Node.

Os novos comandos são fixos (`startGuarded`, `emailGuarded`, `pinReadGuarded`), sem lista de ações arbitrárias, com assinatura, nonce, flags de identidade e bloqueio. Tentativas de PIN/código continuam reservadas de forma durável antes da verificação. Não repetir automaticamente uma alteração após um timeout.

Solicitações de runtime aguardam no máximo cinco segundos pelo bloqueio, retornando uma causa de fila ocupada antes do timeout de transporte; as rotinas administrativas conservam sua espera anterior. Isso não encerra nem desfaz uma operação que já obteve o bloqueio. O prazo de transporte continua em 20 segundos por RPC e o orçamento total de acesso continua em 55 segundos; aumentar prazos não foi usado como otimização.

`Server-Timing` no acesso contém somente duração total, duração acumulada do Google e contagem de RPCs. O Google registra somente números de fila, vinculação, schema e trabalho. Não registrar payloads, cookies, contatos, PINs, códigos de e-mail ou segredos. Essas medidas permitem separar lentidão de fila/armazenamento da inicialização e da rede do provedor.

## Aplicação e homologação real

1. Atualizar o arquivo único e a implantação existente do Apps Script primeiro, conservando URL e propriedades. O backend novo usa comandos que a implantação antiga não conhece.
2. Para permitir o vínculo do CPF do master, executar `provisionDevelopmentProfile` pelo proprietário no editor, se esse módulo ainda não estiver preparado. A função só prepara a pasta privada existente e a flag de perfil; não recria usuário, PIN, sessão ou passkey.
3. No Netlify DEV, conservar as duas chaves pessoais independentes e habilitar `WORKSPACE_PROFILE_ENABLED=true` para disponibilizar Meu perfil. Não substituir outras chaves. Não copiar chaves pessoais para o Apps Script.
4. Publicar o backend/frontend na branch DEV, validar os tempos reais e concluir o primeiro acesso com aparelho físico. O master inicial continua por e-mail até autenticar e vincular seu CPF.

Os números acima medem requisições/leituras eliminadas, não uma latência de produção em milissegundos. A inicialização do Apps Script, as chamadas Drive/Sheets e o tempo do autenticador continuam sujeitos ao provedor. A meta de resposta visual imediata é coberta pelo estado de carregamento; conclusão instantânea de uma operação remota não é garantida. Esta revisão exige homologação na implantação real antes de declarar a lentidão resolvida.

## Confirmação do aparelho sem espera de rede no clique

A preparação do desafio ocorre ao chegar à etapa do aparelho, antes de habilitar seu botão. O clique chama `navigator.credentials.create/get` antes de qualquer `await`, preservando a ativação do usuário. A preparação vale no navegador por no máximo dois minutos; depois disso é renovada e exige novo clique explícito. Nenhum diálogo de biometria é aberto automaticamente. A renovação não estende o prazo do fluxo, não dispensa PIN/e-mail e não cria sessão.

Cancelamento/expiração/diálogo que não abriu (`NotAllowedError`), falta de suporte, bloqueio de origem, chave existente e interrupção possuem mensagens distintas. Não atribuir cancelamento ou bloqueio do navegador a PIN errado. A referência de suporte utiliza códigos fixos, sem texto de exceções. Ausência de janela não identifica sozinha a causa no aparelho físico.

Snapshots de linhas são cópias restritas a uma única operação assinada de identidade com `ScriptLock`. `accessSaveMain_`, `authControlSave_` e atualização de atividade invalidam antes de gravar, inclusive em falhas. Não aplicar snapshots aos comandos de negócio. Não reaproveitar usuário, epoch, guarda, sessão ou chave entre requisições. Todos os cabeçalhos continuam validados. Testes: `tests/backend/identity-row-snapshots.test.mjs` e regressões de identidade/recuperação.

Cenários adicionais do navegador: chamada nativa no turno do clique com ativação presente e nenhuma nova consulta de opções; preparação expirada exige novo clique; cancelamento sem criar sessão nem refazer PIN; falha de preparação permanece na etapa certa; texto curto de primeiro acesso sem instruções de conta proprietária. CPF de funcionário busca o contato cifrado e envia o código somente ao e-mail vinculado (`tests/backend/staff.test.mjs`, `scripts/test-staff.py`). Um CPF ausente não é associado a uma conta apenas porque foi digitado na entrada pública. A instalação continua permitindo somente o proprietário configurado como SUPER_ADMIN; a interface pública não descreve esse procedimento administrativo.

Os números acima medem trabalho eliminado no contrato emulado, não segundos de Google real. Validar duração por etapa via Server-Timing e métricas numéricas do Google após atualizar a implantação. Acesso público do executor pode retornar 401 da proteção da hospedagem; isso não comprova uma falha do login da aplicação nem autoriza contornar a proteção.

## Privacidade sem bloqueio aleatório da publicação

Os testes de auditoria não procuram um PIN de quatro números como substring de toda a resposta: UUIDs e hashes legítimos podem conter a mesma sequência por acaso. O teste de divulgação usa identificadores fixos com esses números e verifica os objetos `before`/`after` completos, os campos permitidos e os marcadores privados. O teste de negativas anônimas usa IDs de evento com os dois PINs de teste, exige identificador de usuário/entidade vazio ou de sistema conforme o contrato, `Antes` vazio e `Depois` com somente fase e causa. Um PIN como conteúdo de célula continua proibido. Os testes existentes de DTO com campo privado forjado continuam exigindo recusa HTTP502, antes de divulgar JSON ou planilha.

Isso corrige um falso positivo que bloqueava o build do Netlify e mantinha a versão anterior do DEV. Nenhum teste é desativado; não altera código de execução, autenticação, Google, chaves ou dados. Não homologar a versão nova antes de confirmar a conclusão do deploy da branch `dev`.
