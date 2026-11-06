# Auditoria de configuração e repetição de login DEV

## Evidência e limites

A revisão de 29/10/2026 encontrou concorrência entre a leitura opcional de sessão na abertura da página e os comandos de entrada. O Google usa ScriptLock e retorna `BUSY` se não adquire a trava em cinco segundos; isso acontece antes de executar o comando. A consulta de sessão antiga também podia devolver um Set-Cookie de exclusão após uma nova entrada. Ignorar seu resultado na interface não impede o navegador de aplicar esse cabeçalho.

O navegador agora serializa essas solicitações, sem adiar o início do seletor nativo WebAuthn. A consulta negada continua retornando 401, mas não apaga cookies; a saída explícita confirmada continua apagando. `WORKSPACE_BUSY` admite uma repetição automática limitada, porque o comando recusado não executou. Se a preparação da entrada biométrica continuar ocupada, a aba conserva a mesma confirmação em memória e oferece continuar, sem outro pedido de biometria. Timeouts, respostas inválidas e erros de assinatura não recebem essa repetição. O código de desafio de uso único e o contador de credenciais permanecem inalterados.

Na versão nova da entrada com PIN, a consulta e verificação do PIN usam uma solicitação; um recibo opaco, curto e vinculado ao cookie permite criar o fluxo e preparar o aparelho juntos na próxima solicitação. Cada solicitação faz uma única chamada Google. O recibo não contém PIN, verificador ou e-mail e não concede sessão; situação e versão do usuário são conferidas novamente antes da confirmação WebAuthn. Clientes antigos mantêm o caminho anterior.

Os testes com Chromium, assinaturas WebAuthn reais de autenticador virtual e serviços locais reproduziram quatro falhas antes da correção: leitura lenta junto da biometria; leitura lenta junto do PIN; preparação ocupada; entrada por PIN ocupada. Depois da correção passam inclusive a continuidade até Home/cadastro/Voltar e a preservação de uma única confirmação. Estes testes não medem o tempo de execução real do Google.

A tentativa de navegação automatizada no endereço DEV real recebeu HTTP 401 em HTML e redirecionamento para `app.netlify.com/edge-access`, antes da aplicação. O navegador da automação não possui a sessão de acesso do proprietário. Não houve E2E autenticado completo contra o ambiente real. Nenhuma proteção de hospedagem foi desativada.

O diagnóstico para download em “Informações para o suporte” contém apenas nomes fixos das operações, horários, espera em fila, duração HTTP, status e códigos permitidos. Fica em memória até sair da página. Não contém corpos das solicitações, CPF/e-mail, PIN, cookies, tokens, recibos, assinatura ou chave da biometria. Ele ajuda a observar uma tentativa real sem exportar um HAR com credenciais.

## Netlify: conferir no contexto da branch dev e escopo Functions

Não é possível afirmar a presença de todas as variáveis do runtime sem ler suas configurações ou executar um diagnóstico nesse runtime. A conexão disponível não fornece a administração das variáveis do Netlify. O arquivo `.env.example` é um modelo; não representa os valores efetivos publicados.

Base operacional: `APP_ENV=dev`, `WORKSPACE_BACKEND_ENABLED=true`, `WORKSPACE_INSTALLATION_ID`, `WORKSPACE_SCRIPT_URL`, `WORKSPACE_SPREADSHEET_ID`, `WORKSPACE_DRIVE_ROOT_ID` e `WORKSPACE_HMAC_SECRET`.

As seis chaves de backend são `WORKSPACE_HMAC_SECRET`, `WORKSPACE_SESSION_TOKEN_KEY`, `WORKSPACE_AUTH_GUARD_KEY`, `WORKSPACE_PIN_PEPPER`, `WORKSPACE_PERSONAL_DATA_KEY` e `WORKSPACE_PERSONAL_INDEX_KEY`. São independentes e usam o formato exigido pelo carregador, 64 caracteres hexadecimais. Não regenerar chaves existentes para conferir presença: isso pode invalidar acessos ou impedir a leitura de dados pessoais.

As quatro flags de identidade usam `WORKSPACE_IDENTITY_SESSIONS_ENABLED`, `WORKSPACE_IDENTITY_GUARDS_ENABLED`, `WORKSPACE_IDENTITY_PASSKEYS_ENABLED` e `WORKSPACE_IDENTITY_ACCESS_ENABLED`. O valor habilitado é a string exata `true`, sem aspas no campo de valor. Manter `WORKSPACE_VERIFY_CONNECTION=false` após a instalação; esse diagnóstico de build não substitui o runtime.

`SITE_ID`, `CONTEXT`, `BRANCH` e `DEPLOY_PRIME_URL` são identidade da plataforma/build. Não cadastrá-los manualmente para tentar acelerar o app. O build gera os metadados que faltam no runtime das Functions, com validação de site/contexto.

## Google: inventário seguro somente pelo proprietário

`inspectDevelopmentConfiguration` pode ser executada no editor DEV pelo proprietário. Ela somente lê Script Properties e imprime nomes/estados, sem valores. Verifica formato da base, flags e dependências conhecidas, e presença/formato dos vínculos dos módulos ativos. `FORMAT_OK` não comprova permissão, privacidade ou correspondência com Netlify; esses testes continuam separados. A função não é exposta por HTTP, não altera propriedades nem provisiona recursos.

Mapeamentos essenciais: `WORKSPACE_HMAC_SECRET` corresponde a `SIGNING_SECRET`; `WORKSPACE_INSTALLATION_ID` a `INSTALLATION_ID`; planilha e pasta a `SPREADSHEET_ID` e `DRIVE_ROOT_ID`. `OWNER_EMAIL`, `BACKUPS_FOLDER_ID`, `IDENTITY_CONTROL_SPREADSHEET_ID`, `IDENTITY_OWNER_USER_ID` e `IDENTITY_OWNER_EMAIL_BINDING` pertencem à instalação Google. Usar os provisionadores existentes; não inventar IDs para preencher uma ausência.

Chaves de sessão/guarda/PIN e de criptografia do backend não devem ser copiadas para Script Properties. Propriedades de manutenção possuem seu próprio roteiro e não são pré-requisitos para todo login.

## Flags dos módulos

Cada nome abaixo tem `WORKSPACE_` no Netlify e o mesmo nome sem esse prefixo no Google. Ausência ou `false` em um módulo opcional significa módulo fechado, não obrigação de habilitar todos.

| Flag | Dependências principais além da base de identidade |
| --- | --- |
| CATALOG_ENABLED | Catálogo preparado e journal privado |
| CHECKOUT_ENABLED | Catálogo |
| COVER_PHOTOS_ENABLED | Catálogo e pasta privada de capas |
| NOTIFICATIONS_ENABLED | Catálogo |
| STAFF_ENABLED | Chaves de dados pessoais no backend; identidade completa |
| CUSTOMERS_ENABLED | Chaves de dados pessoais no backend |
| OPERATIONS_ENABLED | Catálogo |
| PROFILE_ENABLED | Chaves de dados pessoais e pasta de perfis |
| RECOVERY_ENABLED | Acesso, sessões e passkeys |
| EMAIL_CHANGE_ENABLED | Perfil |
| NICHES_ENABLED | Catálogo |
| SCHEDULES_ENABLED | Catálogo e notificações |
| AUDIT_ENABLED | Catálogo |
| REPORTS_ENABLED | Catálogo |
| CUSTOMER_INSIGHTS_ENABLED | Clientes, relatórios e catálogo |
| KEY_MANAGEMENT_ENABLED | Sessões e passkeys |
| EMERGENCY_RECOVERY_ENABLED | Recuperação e passkeys; gestão de chaves para emitir códigos |

`WORKSPACE_ISBN_LOOKUP_ENABLED` é uma opção do backend de consulta bibliográfica; não precisa de propriedade Google correspondente. Funções como câmera e leitura local de código de barras também dependem da permissão do navegador.

## GitHub e lentidão

O workflow de administração usa o secret privado `GOOGLE_DEV_ADMIN`; as execuções confirmam que a credencial funciona para os passos executados. A API conectada não permite listar os metadados dos secrets. Não é necessário copiar todas as variáveis do Netlify ou Google para o GitHub, nem preencher/commitar `.env`. A publicação normal do Netlify usa a integração do repositório.

Flags ausentes normalmente causam bloqueio rápido (`NOT_ACTIVATED`/`UNAVAILABLE`). URL, vínculo ou credencial incorretos podem causar falhas de comunicação e espera; é necessário observar a tentativa para confirmar. Neste incidente há um mecanismo de concorrência reproduzido e leituras Google lentas já medidas, independentemente das flags. Habilitar todos os módulos não corrige a trava nem reduz o tempo do Google.
