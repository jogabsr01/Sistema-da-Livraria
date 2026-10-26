# QA — reconexão dos relatórios comerciais

Validação local em 26/10/2026 (America/Sao_Paulo), Google/Sheets/Drive/MailApp descartáveis emulados e sessão/PIN/WebAuthn reais com autenticador virtual Chromium. Nenhum dado, credencial ou mensagem real foi usado.

## Navegador

**18 cenários Chromium únicos aprovados**: 11 novos em `test-reports-reconnection.py` e 7 regressões em `test-reports.py`.

- Offline remove resultados, detalhes e filtros sensíveis; submit não envia consulta; reconectar não consulta automaticamente.
- Consulta atrasada que atravessa queda/retorno não publica dados.
- Exportação atrasada não baixa arquivo após mudança de rede; conferência explícita reusa a mesma autorização e mantém um só log.
- Outra conta identificada na última conferência impede o arquivo e conserva a referência para análise/retorno à conta original.
- Falha de sessão durante a conferência não envia outro POST de exportação.
- Vencimento local remove pedido/dados sem novo envio ou exclusão da auditoria.
- Descarte explícito permite nova consulta com outra chave; ambas as autorizações continuam na auditoria.
- Alteração programática de filtros durante consulta descarta a prévia antiga.
- Papel removido durante a consulta impede publicação dos resultados privados.
- Ocultação da página limpa detalhes e exige nova consulta após retornar; layout de celular inspecionado sem overflow.
- Abertura offline retoma apenas acesso, sem consulta de relatório automática.

As sete regressões preservam cálculos históricos/estornos, filtros de estoque e movimentação, detalhes e rankings, Excel real com ZIP/XML válido, repetição idempotente, recusa por fonte alterada, interseção CPF/cidade/pagamento sem exportar contatos e limpeza por perda de papel.

Sinais de rede, sessão recusada/conta diferente e respostas retidas são fixtures explícitas. O backend descartável executa antes da perda de resposta; assim a auditoria já registrada é efetivamente comparada. A remoção de papel usa estado real do emulador. Relógio Playwright é instalado antes da navegação para verificar o prazo de cinco minutos. Um ensaio detectou a checagem periódica sobrescrevendo o aviso de vencimento; corrigida a prioridade da mensagem, a suíte final passou. Uma regressão inicial de retry desabilitado após falha de transporte foi corrigida: o retry pode iniciar a conferência da sessão, mas o POST continua condicionado à validação da mesma conta.

## Contratos, build e limites

**16 contratos aprovados em Node 24.19.0 e Node 22.23.4**: relatórios (13) e build/schema (3), sem alteração do backend. Incluem prova de prévia por sessão/filtro/fonte, auditoria idempotente, fonte alterada, limites, CPF ausente de logs/arquivo, integridade ZIP/XML e relatório completo de 5.000 livros sem truncamento.

Runner local sem isolamento de processo para emitir contratos individuais (`--test-isolation=none` no Node 24; `--experimental-test-isolation=none` no Node 22). A execução com o perfil de rede permitido ao executor concluiu os testes, inclusive o subprocesso Python que valida o XLSX; as tentativas iniciais sem esse perfil ficaram paradas nesse subprocesso e foram encerradas. Nenhum serviço externo é consultado pelos contratos.

Build final, sintaxe JS, AST Python e `git diff --check` aprovados. Logs/captura permanecem em work/ ignorado. Preview deve passar no head exato antes de integrar em DEV. Main/PROD e instalação Google real preservadas.

Não se comprova Internet física, aparelhos reais, todos os comportamentos de bfcache/suspensão, gravação final do arquivo no disco ou quotas/IAM Google. Referência em memória não garante recuperação após perder a aba ou autenticar em nova sessão. Uma autorização pode estar auditada sem download concluído. O v17 continua em andamento; [contrato e persistência](RECONEXAO_RELATORIOS_DEV.md).
