# Manutenção, recuperação e continuidade — DEV

Implementação em `google-apps-script/Maintenance.gs`. As rotinas são exclusivas do editor Google do proprietário e não são expostas pelo dispatcher assinado nem por uma função Netlify. O código foi testado com serviços descartáveis; a configuração Google e a instalação de gatilhos continuam para a etapa posterior.

## Autorização e preparação

Operações manuais exigem `APP_ENV=dev`, a conta Google ativa **e** a conta efetiva iguais a `OWNER_EMAIL`, bindings privados e o ScriptLock. A identidade Google de manutenção é distinta do login da livraria. Um ADMIN/ATENDENTE da aplicação não recebe acesso às funções de recuperação por conhecer um UUID ou uma URL.

Configurar no ambiente privado Google, somente na etapa de instalação autorizada:

- `MAINTENANCE_BACKUP_KEY`: chave aleatória de 32 bytes em hexadecimal minúsculo, independente de SIGNING_SECRET, com custódia em cofre externo. Ela autentica arquivos e planos e não é incluída nos snapshots.
- Pasta `BACKUPS_FOLDER_ID` privada. Editores/leitores explícitos devem ser o proprietário e, opcionalmente, `MAINTENANCE_RECOVERY_EMAIL`, identidade de recuperação previamente aprovada. Não compartilhar por link.
- Para rotação, preparar `MAINTENANCE_NEXT_SIGNING_SECRET` no armazenamento privado, nunca em parâmetros públicos, chat, logs ou Git.
- Somente para recuperação administrativa, preparar temporariamente `MAINTENANCE_PERSONAL_INDEX_KEY` com a chave de índice do backend. Ela permite recusar um endereço já vinculado a outro funcionário e é excluída do snapshot e removida ao concluir. A chave de cifragem não é solicitada por essa rotina.

Nenhuma dessas propriedades foi preenchida por este incremento. Não confundir a declaração de escopo OAuth com autorização concedida em Google real. O manifesto declara `script.scriptapp` para a futura instalação opcional do gatilho, além dos escopos já existentes; a concessão real deve ser revisada na etapa Google.

## Modo de manutenção

`beginDevelopmentMaintenance()` valida o proprietário, a chave de backup e os bindings e ativa MAINTENANCE_MODE sob lock. Enquanto ativo, **todas as requisições da aplicação recebem BUSY antes de escrever nonces, dados ou projeções**. Isso impede que uma consulta retome um diário enquanto uma cópia ou manutenção estiver em curso.

`endDevelopmentMaintenance()` só libera tráfego se o schema estiver íntegro e não houver ponteiros pendentes, intenções COMMITTING/PROVING ou diários incompletos detectados. Uma falha não autoriza apagar ponteiros ou editar versões para liberar a aplicação. Reexecutar a mesma operação ou reconciliar com uma nova referência apropriada.

O lock coordena os escritores da aplicação, não edições manuais no Google Sheets por outras pessoas. IAM e a ausência de editores externos precisam ser verificados na homologação. Não editar as planilhas manualmente durante a manutenção.

## Backup completo

`backupDevelopmentInstallation(commandId)` cria um arquivo privado autenticado por HMAC contendo as planilhas principal, de controles de identidade e de journal do catálogo; suas abas/células; propriedades privadas da instalação; e arquivos das pastas configuradas, com bytes, descrições, IDs de origem e hashes.

O backup preserva propriedades e ponteiros de identidade que participam de recuperação, incluindo intenções de e-mail/passkeys/códigos. As chaves temporárias de manutenção e a chave independente de autenticação dos backups são excluídas. Chaves de cifragem, índice, PIN e sessão que ficam somente no backend precisam de custódia externa correspondente: restaurar o Drive não substitui esse cofre.

O arquivo contém dados pessoais cifrados e material privado de autenticação/configuração. **HMAC é autenticação, não cifragem do arquivo.** A confidencialidade depende da pasta privada e da identidade de recuperação. Não baixar para pasta compartilhada nem anexar a uma conversa, repositório ou exportação administrativa. O retorno da função contém apenas referência/hash, sem os conteúdos privados.

Repetir a mesma referência reutiliza a cópia e o registro da operação. O código recusa fórmulas nas células, recursos compartilhados/incompatíveis e limites excedidos sem retornar uma lista parcial. Limites atuais: 40 abas por planilha, 5.001 linhas/100 colunas por aba, 1.000 arquivos, 4 MB por arquivo e aproximadamente 22 MB de snapshot. Capacidade, duração e quotas devem ser medidas em Google real.

## Restauração isolada e conferência

`restoreDevelopmentCopy(backupId, commandId)` valida assinatura, instalação e pasta, cria uma raiz privada separada e recria planilhas e arquivos. Não troca SPREADSHEET_ID/DRIVE_ROOT_ID da aplicação ativa. Um mapa de IDs permite às funções existentes trabalhar na cópia sem reescrever referências históricas, hashes ou identidades de negócio.

Antes de recuperar diários, compara todas as células copiadas com o snapshot. Em seguida, executa as projeções recuperáveis na cópia e guarda também as propriedades privadas **após** a retomada e os hashes das tabelas resultantes. O contexto isolado é removido em finally, inclusive quando a recuperação falha.

`inspectDevelopmentRestore(commandId)` confere novamente schema, células e hashes dos arquivos da cópia. Alterar a cópia depois da verificação faz a inspeção recusar. A referência de uma restauração concluída reutiliza o resultado; a inspeção é a verificação atual da integridade.

Uma tentativa interrompida pode deixar uma pasta privada parcial para análise. Ela não é promovida nem apresentada como restauração concluída. Preservar esses artefatos até revisar; não há exclusão automática. **Não há promoção automática da cópia para a instalação ativa.** Promoção e teste com os segredos correspondentes do backend são etapas operacionais posteriores, com outra cópia de segurança e aceite do responsável.

## Reconciliação de operações

`reconcileDevelopmentInstallation(commandId)` faz backup antes de retomar diários de identidade, credenciais, perfil, equipe, e-mail, nichos, escalas, clientes, catálogo e vendas. Mantém as chaves de operação e projeções idempotentes existentes; não cria outra venda, produto ou baixa para substituir uma operação incerta. A aplicação fica bloqueada durante essa conferência.

Repetir a referência concluída devolve o resultado daquela execução, não aplica eventos novos com a mesma referência. Uma nova conferência usa um novo UUID. Atualizações entre aparelhos continuam usando leituras completas e revisões do servidor; a medição com aparelhos físicos permanece para homologação.

## Recuperação administrativa do proprietário

`recoverDevelopmentOwnerAccess(commandId, newEmail, caseReference)` exige a identidade Google privilegiada e um caso de verificação externa aprovado (`CASE-...`). O código registra a referência por hash; não pede documentos pessoais nem inclui o endereço na auditoria comum. O formato do caso não substitui a verificação humana: o administrador Google é a autoridade responsável por confirmar a identidade antes de executar.

A função faz backup, fixa um plano assinado e incrementa a versão de autorização primeiro. Revoga sessões e passkeys antigas, invalida o kit anterior, cancela fluxos de credenciais e marca o mesmo proprietário para nova inscrição. Mantém UUID, papel SUPER_ADMIN e histórico, sem permitir escolher outro usuário ou promover um funcionário.

O novo endereço precisa ser confirmado pelo fluxo existente: código recebido **no novo e-mail**, PIN novo e passkey nova. Não se entrega uma sessão autenticada apenas por executar a manutenção. A primeira inscrição da nova versão pode receber o código imediatamente; reenvios na mesma versão continuam limitados. O PIN anterior fica como registro de versão antiga e não autentica o novo acesso.

Após falha parcial, a mesma referência/caso retoma o plano sem incrementar a versão de novo. Até concluir, o ponteiro impede liberar tráfego. Essa rotina cobre a perda dos fatores da aplicação quando a identidade Google de manutenção continua acessível. Perder também a conta Google de manutenção/cofre requer o procedimento de recuperação da organização/provedor; não existe bypass universal no sistema.

## Rotação de assinatura da instalação

`rotateDevelopmentSigningKey(commandId)` rotaciona **SIGNING_SECRET**, a chave HMAC do canal backend–GAS. Antes, exige ausência de intenções pendentes e de cerimônias ativas e cria backup. Migra os MACs dos fluxos fechados de passkeys e kits de recuperação para a nova chave. Fluxos expirados não são reativados. O plano é autenticado pela chave independente de backup, permitindo retomar após uma troca parcial da chave.

As chaves de cifragem de dados pessoais, índices, PIN e tokens de sessão não são alteradas por essa rotina. Não substituir essas outras chaves manualmente: isso inutilizaria dados ou acesso. O backend precisa receber a nova chave HMAC pelo seu armazenamento privado e a assinatura das respostas deve ser conferida antes de liberar tráfego. BUSY assinado durante manutenção indica bloqueio esperado; UNAUTHORIZED não confirma a nova configuração.

Depois de conferir a nova configuração, criar uma nova cópia com outro UUID; a repetição de uma referência agendada no mesmo intervalo não substitui essa cópia posterior à rotação.

Não há transição pública que aceite indefinidamente a chave antiga. A chave antiga fica somente na cópia/plano privados para recuperação. Interrupções inclusive depois do marcador de conclusão são retomáveis; uma referência antiga reutilizada após outra rotação é recusada antes de alterar a instalação.

## Retenção e compactação técnica

`compactDevelopmentTechnicalRecords(commandId, cutoff)` exige data de corte ISO explícita, ao menos 30 dias no passado, ausência de intenções pendentes e backup prévio. Remove do armazenamento ativo somente sessões expiradas, nonces antigos, desafios expirados e fluxos técnicos expirados que não estejam em commit nem vinculados ao kit de recuperação. Mantém limites de autenticação, cerimônias/credenciais, PINs, vendas, livros, movimentações, auditoria e journals de negócio.

O plano privado assinado contém as linhas preservadas e permite retomar uma reescrita parcial. A mesma referência/data não faz outra remoção. Os registros removidos continuam na cópia privada: não é eliminação definitiva de PII. Não foi implementada uma política automática de exclusão de backups ou de histórico de negócio. Periodicidade, retenção legal, RPO/RTO e destino dos arquivos devem ser aprovados antes de produção.

## Agendamento opcional de backups

`installDevelopmentBackupSchedule(hours)` aceita 1, 2, 4, 6, 8, 12 ou 24 horas, somente pelo proprietário Google. Repetir a mesma configuração não instala outro gatilho. O callback valida a identidade efetiva, UID, nome e presença do gatilho instalado, usa o ScriptLock, faz no máximo uma cópia por intervalo/referência e ignora uma manutenção manual sem desativá-la.

`removeDevelopmentBackupSchedule()` desabilita primeiro a configuração e remove somente o gatilho correspondente; não remove gatilhos de outros fluxos. Falha antes de gravar a configuração pode deixar um gatilho órfão sem autorização para produzir cópias; revisar no editor antes de instalar outro. Nenhum gatilho foi instalado pelo desenvolvimento/publicação deste lote.

## Notificações e auditoria

Backup, restauração, reconciliação, rotação, compactação e recuperação administrativa geram auditoria e um aviso genérico idempotente. Só ADMIN/SUPER_ADMIN veem esses avisos; cada pessoa tem sua leitura individual. Eles levam à auditoria e não mostram e-mail, CPF, chave, código, caso ou arquivo privado, nem oferecem ações de estoque. Atendentes não veem nem marcam esses avisos.

Aviso de operação concluída não é atestado de saúde atual da instalação. A inspeção da cópia, a conferência do canal e o teste de acesso devem ser executados conforme a operação. Sem e-mail/WhatsApp automático de alertas administrativos.

## Fechamento e limites

Estas frentes têm código e testes em DEV; não foram executadas em instalação Google real. Requerem publicar **todos** os arquivos GAS atualizados, incluindo Maintenance.gs: os adaptadores de propriedades/recursos dos módulos existentes fazem a recuperação isolada e, fora dela, usam os recursos originais normalmente.

Antes de produção: revisar IAM/escopos, guardar chaves no cofre, escolher a política de backup/retenção, medir restauração real/RPO/RTO, conferir quotas, testar múltiplos usuários/aparelhos e realizar aceite integrado. Home dos perfis e configuração real Google continuam na etapa posterior solicitada. [Validação](QA_MANUTENCAO_RECUPERACAO.md).
