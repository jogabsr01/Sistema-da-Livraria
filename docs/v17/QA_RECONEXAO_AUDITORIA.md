# QA — reconexão da auditoria

Validação local em 26/10/2026 (America/Sao_Paulo), com Google/Sheets/Drive/MailApp emulados e dados descartáveis. Sessão/PIN e assinaturas WebAuthn usam o código real com autenticador virtual Chromium. Nenhum dado, credencial ou mensagem real foi usado.

## Navegador

**22 cenários Chromium únicos aprovados**: 11 novos em `test-audit-reconnection.py`, 5 regressões de auditoria e 6 de eventos de segurança.

- Queda limpa registros, detalhes, identificadores e nomes das opções; submit offline não consulta.
- Listagem atrasada após mudança de rede não publica resultados.
- Excel atrasado não baixa arquivo; conferência explícita usa o mesmo pedido e um único registro de exportação.
- Conta diferente identificada na última conferência bloqueia o arquivo e conserva a referência.
- Falha de sessão não envia novo POST; recuperação da conta válida permite conferir o comando original.
- Timer local remove visualização/referência sem exportar ou apagar auditoria.
- Descarte explícito permite nova consulta e outra chave; os dois registros deliberados permanecem.
- Alteração programática de filtros descarta a consulta atrasada.
- Papel retirado durante a consulta impede publicar os registros privados.
- Ocultação limpa detalhes e exige atualização explícita ao voltar; layout de celular inspecionado sem overflow.
- Abertura offline recupera apenas acesso ao reconectar, sem consulta automática.

Regressões preservam paginação com detecção de novos registros, filtros combinados, detalhes anteriores/posteriores, dados protegidos omitidos, ZIP/XML real do Excel e proteção contra fórmulas, atendentes impedidos de consultar, exportação idempotente, negativas anônimas, limites de tentativas, logout/revogação recuperáveis e auditoria de alterações de produto.

Rede, conta diferente, sessão recusada e respostas retidas são fixtures explícitas. O backend descartável executa a exportação antes de abortar/perder a resposta, para comparar o registro já existente. A retirada de papel usa o estado real do emulador. O teste de retenção instala relógio Playwright antes da navegação e verifica ausência de POST e preservação da auditoria após cinco minutos.

## Contratos e build

**28 contratos aprovados em Node 24.19.0 e Node 22.23.4**, sem alteração de backend: auditoria (12), eventos de segurança (13), build/schema (3). Incluem escopo, acesso administrativo recente, snapshot, autorização registrada antes do arquivo, repetição sem duplicação, conflitos/capacidade, validação do XLSX e projeções de segurança recuperáveis.

Runner local com `--test-isolation=none` em Node 24 ou `--experimental-test-isolation=none` em Node 22, reporter TAP e perfil de rede permitido do executor para os processos auxiliares dos testes. Não houve consulta a serviços externos.

Build final, sintaxe JS, AST Python e `git diff --check` aprovados. Logs/captura ficam em work/ ignorado. Integração exclusiva em DEV depende de preview aprovado no head exato; main/PROD e Google real preservados.

Não se comprova rede física, aparelhos reais, todos os comportamentos de bfcache/suspensão, gravação do arquivo no disco ou quotas/IAM Google. Retenção local não altera validade/autorização do backend e não é backup; uma autorização pode existir sem download concluído. [Contrato e limites](RECONEXAO_AUDITORIA_DEV.md). O v17 segue em andamento.
