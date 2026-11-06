# QA — reconexão do perfil de compra

Validação local em 26/10/2026 (America/Sao_Paulo), Google/Sheets/Drive/MailApp emulados e dados descartáveis. Sessão/PIN e assinaturas WebAuthn usam o código real com autenticador virtual Chromium. Nenhum dado, credencial ou mensagem real foi usado.

## Navegador

**19 cenários Chromium únicos aprovados**: 12 novos em `test-insights-reconnection.py` e 7 regressões de `test-customer-insights.py`.

- Offline limpa CPF, nome, histórico e texto; submit não consulta e reconectar não repete a busca.
- Perfil atrasado após mudança de rede não restaura dados privados.
- Preparação atrasada mantém a referência para conferência explícita, retorna o texto autorizado sem restaurar o histórico e registra uma única preparação.
- Resposta de cópia que perdeu contexto não solicita clipboard nem mostra o texto anterior.
- Conta diferente bloqueia a resposta e conserva o pedido para a conta original.
- Falha de sessão antes da conferência não envia outro POST.
- Consentimento retirado após preparação incerta impede recuperar/revelar o texto antigo; a auditoria anterior permanece.
- Mudança programática da seleção durante o pedido descarta a resposta, sem substituir seu comando original.
- Prazo da consulta remove perfil, texto e referência sem enviar outro pedido.
- Descarte explícito permite nova consulta/preparação com outra chave, preservando o registro anterior.
- Papel retirado durante a consulta impede restaurar nome/histórico; layout de celular inspecionado sem overflow.
- Abertura offline retoma apenas acesso, sem consultar cliente automaticamente.

As sete regressões preservam indicadores/histórico/explicações, sugestões consultivas sem consentimento, histórico vazio sem preferências inventadas, preparação idempotente, recusa por consentimento/fonte alterados, limpeza por perda de papel e mudança de cliente. A regressão de cópia usa o clipboard real do Chromium; o teste de resposta atrasada usa uma fixture explícita que registra solicitações de clipboard, sem afirmar controle sobre o sistema operacional.

Sinais de rede, conta diferente, sessão recusada e respostas retidas são fixtures. O backend descartável executa antes da perda de resposta, para comparar o registro já existente. A retirada de papel e de consentimento usa os endpoints/estado autorizados do emulador. O teste de prazo instala relógio Playwright antes da navegação e compara ausência de novos pedidos e preservação da auditoria.

## Contratos e limites

**20 contratos aprovados em Node 24.19.0 e Node 22.23.4**, sem alteração do backend: perfil de compra (10), clientes (7), build/schema (3). Incluem fonte íntegra, sessão/prova, consentimento, idempotência, criptografia, ausência de contatos no texto e limites completos de sugestões/histórico.

Runner local com `--test-isolation=none` em Node 24 ou `--experimental-test-isolation=none` em Node 22, reporter TAP e perfil de rede permitido do executor para os processos auxiliares. Nenhum serviço externo é consultado pelos contratos.

Build final, sintaxe JS, AST Python e `git diff --check` aprovados. Logs/captura ficam em work/ ignorado. Integração exclusiva em DEV exige preview aprovado no head exato; main/PROD e Google real preservados.

Não se comprova rede/aparelhos reais, todos os comportamentos de bfcache/suspensão, quotas/IAM Google nem recuperação depois de perder a aba ou emitir nova sessão. Solicitação de clipboard já aceita, texto já copiado e envio manual externo não são reversíveis pela página. Preparação auditada não comprova envio a um destinatário. [Contrato e persistência](RECONEXAO_PERFIL_COMPRA_DEV.md). O v17 continua em andamento.
