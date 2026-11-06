# QA de e-mail verificado — 24/10/2026

Base DEV: `972096a95ccb6983053cd96647361120327b0ea0`. [Contrato funcional, segurança e limites](EMAIL_VERIFICADO_DEV.md).

## Resultado

- 243 contratos backend aprovados em Node 24.19.0 e 22.23.4. Os nove grupos do novo módulo foram reexecutados nas duas versões após acrescentar a recusa de colisão de comando com auditoria de outro módulo.
- 64 cenários Chromium afetados aprovados: acesso 6, equipe 6, perfil 5, e-mail 5, catálogo 6, Caixa 10, estoque 5, notificações 7, clientes/CEP 8, operações 6. A suíte de e-mail foi repetida após ajuste visual final.
- Build público, sintaxe JS/Python e diff check aprovados. Kit de instalação inclui `EmailChange.gs` e guia; sem chaves ou configuração real.
- Screenshot móvel `work/qa-email-change/email-confirmado-celular.png` inspecionada: novo e-mail, cards/formulários e ações cabem sem rolagem horizontal.

## Cobertura crítica

Proprietário: código no novo endereço, antigo preservado antes de confirmar, login novo e PIN/passkey existentes, recuperação para o endereço confirmado e propriedade Google/binding original inalterados. Funcionário: contato cifrado novo, CPF/papel/nome e versão de PIN preservados, índice antigo deixa de localizar, revisão entra em conflito com edição administrativa. Recuperação de projeção de funcionário é exercitada com flags desligadas.

Segurança: sessão/origem/CSRF e autenticação recente exigidos independentemente no Node e Apps Script; payload exato e até 2 KiB; conta/papel/CPF/índice não podem ser definidos pelo navegador. Código ligado à sessão/conta/comando, cinco erros, expiração, cancelamento, reemissão, intervalo e quota horária persistentes. Destinatário único: listas, cabeçalhos, local/domain inválidos recusados; tag `+` e subdomínio aceitos. Endereço de outra conta e reserva dos endereços do proprietário impedem transferência indevida. Planilha/auditoria não contêm novo endereço ou código puro.

Idempotência: resposta perdida ao emitir não manda outro e-mail; repetição de confirmação não duplica auditoria; mesmo UUID com outro e-mail conflita. Código antigo não confirma reemissão. Colisão com UUID usado em outra auditoria é recusada antes de criar intenção COMMITTING, evitando bloquear a instalação com intenção impossível de projetar.

Recuperação: falhas antes/depois de intenção, propriedade de login, usuário, revisão, revogação de sessão, fluxo antigo, auditoria e marcador final; falhas antes/depois de gravar/limpar o ponteiro. Sessões só são aceitas após reparar intenções; a atual é preservada e outras são negadas. Flags de troca/perfil/equipe desligadas não abandonam um commit já registrado. Falha de MailApp, quota diária e capacidade privada não alteram o login.

Navegador: autenticação WebAuthn com assinaturas efetivas de autenticador virtual; troca, saída e login com novo e-mail; endereço antigo recusado; recuperação ao novo endereço; resposta perdida na emissão/confirmação com repetição exata; recarga consulta fluxo sem preencher dados pessoais; código errado, cancelamento, edição concorrente e flags fechadas. Verifica ausência de localStorage/sessionStorage e erros de página. Leituras atrasadas não limpam campo digitado nem substituem erro/confirmação; controles esperam a consulta de estado. Navegação por fragmento para recuperar PIN funciona também quando já se está na página de acesso.

## Limites da evidência

Sheets/Drive/MailApp/CEP são emulados com dados descartáveis. Nenhum e-mail real é enviado, propriedade privada ativada ou conexão Google alterada. Autenticador virtual não comprova aparelhos físicos, Safari, sincronização de credenciais, IAM ou quotas reais. Os testes financeiros/impressão e CEP das regressões continuam emulados/interceptados. Não se promete entrega exatamente uma vez pelo MailApp.

Flags reais continuam desligadas e Google/home de perfis continuam reservados para a etapa posterior. Restam recuperação sem todas as passkeys, gestão completa de credenciais, nichos/escalas/notificações restantes, auditoria/relatórios e persistência/restauração homologada. Este lote não conclui o Prompt Master v17.
