# Sessões persistentes e permissões — incremento da fase C

Esta entrega parte de dev após o merge do PR #9. Continua desativada por padrão, preserva o HTML do protótipo e não conclui primeiro acesso, login ou bootstrap. Não requer configurar mais propriedades no ambiente real neste momento.

## Implementado

- Sessão exclusivamente em cookie `__Host-livraria_session`, Secure, HttpOnly, SameSite=Lax, Path=/, sem Domain; token canônico aleatório de 256 bits. A função que formata o cookie não cria uma sessão autenticada ou registro persistente.
- O navegador entrega o token ao backend; somente o HMAC desse token atravessa a bridge assinada para consultar Sessoes. A chave de sessão é distinta da chave da bridge e vinculada ao ambiente/instalação. Nenhum verificador de PIN é movido para Usuarios.
- Apps Script resolve o usuário atual, status ATIVO, primeiro acesso concluído e versão de autorização sob o lock da instalação. Recusa duplicidades, sessão revogada, datas inválidas, validade absoluta superior a oito horas, expiração e inatividade superior a 30 minutos. Atualização de atividade tem intervalo mínimo de 60 segundos.
- O perfil vem de Usuarios, não de cookie, header ou localStorage. Sessões administrativas exigem nível mfa/passkey persistido; este incremento não produz nem valida a prova de MFA para emitir sessões.
- Encerramento da sessão atual ou das outras sessões do mesmo usuário, persistindo a revogação. Repetir revogação parcial de outras sessões é recuperável. Repetir logout já concluído retorna 401 e limpa o cookie.
- Mutações exigem origem HTTPS exata, JSON, Fetch Metadata compatível quando presente e token CSRF vinculado à sessão. Respostas são no-store e não contêm token bruto, hash, nome, e-mail, CPF ou ID de sessão.
- Matriz de capacidades ATENDENTE/ADMIN/SUPER_ADMIN com recusa por padrão, separação de gerenciamento de atendentes/administradores, isolamento de operações pessoais e autenticação forte recente em operações sensíveis. Produtos e demais rotas futuras deverão invocar essa política; ela não altera os menus do protótipo.
- A consulta administrativa de schema revalida a sessão dentro do mesmo lock da operação. Uma sessão revogada/desativada ou com versão alterada entre o lookup Node e a consulta GAS não autoriza a leitura. Não existe fallback de ator declarado pelo chamador.

## Armazenamento e autorização versionada

Usa as abas Sessoes, Usuarios e Configuracoes do schema v1, sem migração ou criação de usuários. Configuracoes precisa conter exatamente uma entrada `identity.version.<UUID do usuário>` com Valor inteiro positivo. O valor deve corresponder a Versao_Autorizacao da sessão. A ausência é recusada, nunca inicializada automaticamente pelo leitor.

Os futuros escritores de usuários deverão incrementar a versão de autorização sob o mesmo lock em qualquer mudança de perfil/status, reativação ou recuperação. Alterar somente Perfil/Status, voltando depois ao valor anterior sem incrementar a versão, é insuficiente para revogar sessões antigas. Não editar essas linhas manualmente como procedimento de ativação.

A consulta é limitada a 5.000 registros por tabela. Ao exceder esse limite, o sistema recusa a operação; paginação/índices/arquivamento de sessões ainda precisam ser implementados. Sessões persistentes no Sheets têm latência e quotas que não foram homologadas nesta entrega.

## Travas de ativação

Além de WORKSPACE_BACKEND_ENABLED, o Node exige WORKSPACE_IDENTITY_SESSIONS_ENABLED=true e uma chave WORKSPACE_SESSION_TOKEN_KEY de 32 bytes em hexadecimal, diferente de WORKSPACE_HMAC_SECRET. O Apps Script exige IDENTITY_SESSIONS_ENABLED=true em Script Properties. O incremento só aceita ambiente DEV.

Não cadastrar essas chaves nem habilitar as flags agora. Os valores padrão continuam fechados. Não reutilizar a chave existente da bridge, o PIN ou UUID como chave de sessão. Nenhum segredo novo foi criado nesta sessão ou inserido no Git. Produção é recusada por essas rotas mesmo que alguém configure flags por engano.

## Ainda necessário antes do login real

1. Cadastro/convite por administrador e comprovação de posse do e-mail, com tokens de uso único, expiração e respostas sem enumeração.
2. Verificação do PIN com limites persistentes e atômicos por conta/origem, bloqueio progressivo e recuperação segura. Cookies aleatórios também precisam de limitação de chamadas antes de permitir lookup remoto, para proteger as quotas e o registro de nonces.
3. Registro/verificação de passkeys ou provedor forte e dispositivo novo. Nível mfa/passkey nunca pode vir do navegador nem ser atribuído sem prova validada.
4. Emissor de sessões, reautenticação, bootstrap privado de uso único para o primeiro SUPER_ADMIN e fluxo de recuperação; mutações de perfil/status com incremento de versão.
5. Integração da interface existente e homologação com duas identidades fictícias em Google DEV. Nenhuma conta master foi criada nesta entrega.

## Validação executada

77 testes de backend passaram em Node 22 e 24; build público passou. 26 testes de regressão Playwright/Chromium passaram, incluindo celular, PINs demo, Caixa, Catálogo, capas/ISBN e relatórios. O HTML do aplicativo permanece idêntico ao de dev.

Os novos testes incluem contrato GAS descartável, transporte HTTP local real, cookies/CSRF, expiração, duplicidades, revogação entre chamadas, alteração de perfil/status/versão, disputa por lock, recuperação de interrupção e bloqueio de PROD. Não foram emitidas sessões reais ou gravadas contas no Google; não houve envio de e-mail, consentimento OAuth novo ou uso de dados pessoais reais. A evidência Google real existente continua sendo o diagnóstico de conexão confirmado pelo proprietário no deploy anterior.
