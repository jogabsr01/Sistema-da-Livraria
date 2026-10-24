# Escalas e notificações pessoais — DEV

`escalas-dev.html` oferece calendário mensal (até 42 dias), semanal e detalhes em celular. Datas e horários seguem America/Sao_Paulo, independentemente do fuso do navegador. Administradores consultam todos os funcionários e filtram por pessoa; atendentes consultam somente as próprias escalas publicadas e cancelamentos que já tiveram publicação. Rascunhos, inclusive cancelados sem publicação, não aparecem ao atendente. O menu da conta oferece “Minha escala” quando a funcionalidade está habilitada.

## Gestão e regras

ADMIN/SUPER_ADMIN criam, editam, publicam e cancelam com autenticação forte recente, até cinco minutos, conferida no backend e Apps Script sob lock. A seleção é explícita e permite funcionários ativos, inclusive aguardando primeiro acesso. O servidor recusa novas atribuições e edições para funcionário inativo; permite cancelar uma escala anterior dele. A consulta não exige autenticação recente além da sessão válida.

Cada escala tem funcionário, data, início, fim, observações até 1.000 caracteres, situação, revisão, criador, responsável pela última alteração e primeiro publicador/data da publicação. Turnos pertencem ao mesmo dia, com fim posterior ao início; jornadas que atravessam meia-noite devem ser divididas em dois registros. Datas válidas entre 2020 e 2099. Rascunhos e publicações reservam horário: sobreposição para o mesmo funcionário/dia é recusada; horários adjacentes são permitidos. Cancelamento libera o intervalo e é terminal. Publicada não volta a rascunho; não há exclusão definitiva.

Revisões impedem sobrescrita concorrente. Uma edição sem mudança é recusada. A interface consulta o registro atual antes de abrir e mantém comando incerto somente em memória, bloqueando mudança/fechamento e permitindo repetir exatamente o mesmo comando. Não armazena calendário, observações ou dados pessoais em localStorage/IndexedDB. Fechar a página pode perder a confirmação; reconsultar mostra o estado autoritativo. A tela atualiza ao foco, visibilidade, retorno de conexão e por minuto, sem sobrescrever formulário aberto; troca de usuário ou perda de sessão limpa os dados visíveis e pendentes.

## Persistência e privacidade

Reutiliza as 17 abas existentes: Escalas, Configuracoes, Notificacoes e Logs_Auditoria. Não exige migração ou escopo novo. Data é gravada como texto YYYY-MM-DD para evitar conversão automática do Sheets. Observacoes guarda somente envelope AES-GCM, com domínio de cifra próprio `schedules`; o backend vincula por HMAC o conteúdo ao ID, funcionário, data e horários, recusando reaproveitamento de cifra antiga ou redirecionamento desses campos na planilha. Não editar células diretamente. Nomes são decifrados no servidor a partir do cadastro existente; DTOs do calendário não incluem e-mail, CPF, telefone, hashes ou envelopes privados.

`Configuracoes` guarda `schedule.meta.<id>` (revisão, hash, responsáveis), `schedule.command.<UUID>` (intenção anterior às projeções, snapshots cifrados e integridade) e `schedule.notification.<id>` (destinatário/contexto). O mesmo comando/ator/carga devolve a mesma revisão; carga ou ator divergente conflita. Após intenção, projeta linha, revisão, vínculos, notificações, auditoria e confirmação. Sessões recuperam intenção interrompida antes de aceitar leitura mesmo com flags desligadas. Não apagar journals para contornar erros.

Node e Apps Script conferem o escopo pessoal; o backend recusa até uma resposta upstream assinada que contenha escala/destinatário de outro usuário. Consultar ID de rascunho alheio ou escala alheia como atendente retorna não encontrado. Observações não aparecem em notificações nem auditoria. Auditoria registra ator, ação, revisão, funcionário/data/horários/situação, quantidade de notificações e indicador de mudança do conteúdo vinculado; o journal mantém snapshots cifrados. A proteção não substitui IAM da planilha nem backup.

## Notificações

Publicar gera SCHEDULE_PUBLISHED, editar publicação gera SCHEDULE_CHANGED e cancelar publicação gera SCHEDULE_CANCELLED, somente para o funcionário afetado. Alterar um rascunho não notifica. Reatribuir uma publicação cancela para o destinatário anterior e publica para o novo; o anterior recebe o contexto antigo e não pode ler os novos detalhes. Mensagens incluem apenas data e horários, com link autorizado para “Minha escala”. Os IDs são determinísticos por comando/destinatário/tipo, inclusive na recuperação após falha entre dois destinatários.

Mesmo administradores recebem somente suas notificações pessoais de escala; podem consultar a gestão geral no calendário. Ler uma notificação de escala remove-a dos pendentes/contador e mantém no histórico. Não existe atendimento administrativo de notificação de escala. Alertas de estoque continuam compartilhados, com leitura pessoal separada de atendimento/resolução; o relatório de reposição continua restrito a produtos. Nenhum e-mail, WhatsApp, convite de agenda ou mensagem externa é enviado por este módulo.

## Limites e ativação posterior

Consultas cobrem até 42 dias e 500 escalas completas; acima disso o servidor pede reduzir o período/filtro, sem truncar resultados. Transporte por stream limitado a 4 MB, nomes em lote e observações Unicode completas. Até 500 funcionários ativos na seleção, 5.000 escalas no total e 1.000 comandos de escala. Limites compartilhados de 5.000 linhas em Configuracoes, Logs_Auditoria e Notificacoes também se aplicam. Ao atingir capacidade, novas alterações falham antes da intenção, preservando histórico; retenção/compactação permanece pendente.

Flags `WORKSPACE_SCHEDULES_ENABLED` / `SCHEDULES_ENABLED` fechadas por padrão. Requer catálogo, notificações, sessões e chaves pessoais existentes; não rotacionar chaves com dados gravados. Atualizar o lote completo incluindo Schedules.gs, SessionStore.gs e Notifications.gs. Desligar flags impede acesso novo, mas não elimina a recuperação necessária nem desfaz registros. A instalação Google real foi reservada pelo proprietário para depois das melhorias originais. Este lote não altera flags, propriedades, IAM ou produção. Evidências em [QA_ESCALAS.md](QA_ESCALAS.md); pendências em [STATUS_V17.md](STATUS_V17.md).
