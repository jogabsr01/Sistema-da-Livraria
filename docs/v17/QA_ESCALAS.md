# QA de escalas — 24/10/2026 (São Paulo)

Base DEV `7f23383144d3bef8cf3c60bf799e4bf1c1eda4a2`. Lote validado localmente para publicação em DEV. [Contrato e limites](ESCALAS_DEV.md).

262 contratos backend aprovados em Node 24.19.0 e 22.23.4, incluindo os 13 grupos novos de escalas e os 12 de notificações de estoque. Logs finais: `work/schedules-full24-final.log` e `work/schedules-full22-final.log`.

75 cenários Chromium aprovados: escalas 6, acesso do proprietário 6, equipe 6, perfil 5, e-mail 5, nichos 5, catálogo 6, Caixa 10, estoque 5, notificações 7, clientes/CEP 8 e operações 6. Uma primeira execução de estoque encontrou espera insuficiente no teste de reativação: a marcação podia acontecer antes de o editor carregar o estado inativo. A suíte passou na repetição; o teste agora aguarda o editor e confere o estado inicial/final do campo, e os cinco cenários passaram novamente com essa correção. Código de estoque não foi alterado. Logs `work/schedules-regression-*.log` (estoque final: `work/schedules-regression-stock-final.log`) e `work/schedules-browser-final.log`.

Build, sintaxe JS/Python e diff check aprovados. Kit `/tmp/livraria-dev-escalas.zip` contém 37 arquivos, incluindo Schedules.gs e seu guia, sem configuração privada.

## Casos críticos cobertos

- Rascunho privado, publicação e identificação do responsável, edição/cancelamento com revisão; repetição idempotente sem eventos/auditoria duplicados, conflito de carga/ator/versão e ausência de alteração.
- Funcionário somente com próprias escalas já publicadas, sem rascunhos nem dados de outro destinatário. Backend revalida escopo de resposta upstream. Sessão revogada, papel e autenticação recente conferidos antes da operação; origem, CSRF, campos extras, datas/horários e flags fechadas recusados.
- Sobreposição de rascunhos/publicações recusada, adjacência aceita, cancelamento libera intervalo e não reabre; funcionário inativo não recebe novas atribuições, mas cancelamento anterior funciona.
- Observações cifradas, sem contatos/CPF/e-mail na resposta, sem notas em auditoria/eventos; reaproveitar cifra antiga ou mudar funcionário/data na planilha falha. Domínio de cifra separado das entidades pessoais anteriores.
- Falhas antes/depois de intenção, linha, metadados, destinatário, notificação, auditoria e confirmação recuperadas uma vez com flags desligadas. Reatribuição interrompida após a segunda notificação recupera ambos os destinatários sem vazamento ou duplicação.
- Leitura pessoal remove notificação de escala dos pendentes e mantém histórico; usuário alheio não lê/marca/atende. Alertas de estoque, atendimento e relatório preservados na mesma instalação.
- 500 escalas completas com 1.000 caracteres Unicode por observação passam pelo transporte limitado; 501 no mesmo período falha explicitamente, sem truncamento.
- Browser: seis cenários de celular/semana/mês com fuso Honolulu, entrada de funcionário por passkey, menu e detalhe pessoal, notificação/leitura/histórico, rascunho→publicação→edição→cancelamento, confirmação perdida/repetição exata, sobreposição com formulário preservado, horários adjacentes e atualização após alteração em outra aba. Sem persistência de escala no armazenamento local. Screenshot `work/qa-schedules/minha-escala-celular.png` inspecionada.

Google Sheets/Drive/MailApp e serviços externos são emulados. Entradas browser usam assinatura WebAuthn real com autenticador virtual; não comprovam aparelho físico, Safari, quotas/IAM reais ou instalação Google. Nenhuma mensagem externa, flag/configuração privada ou produção foi alterada. O v17 não está concluído.
