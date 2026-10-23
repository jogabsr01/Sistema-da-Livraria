# QA — Clientes e Caixa identificado

Evidências locais de 23/10/2026, com chaves e dados fictícios. Nenhuma conta ou operação real no Google.

- Backend: 212 testes em Node 24.19.0 e 22.23.4, incluindo sete novos cenários agrupados de clientes/vendas identificadas e reforço do teste de revogação de equipe com a flag desligada.
- Browser: `python scripts/test-customers.py`, seis cenários Chromium — escolha explícita de cliente, cadastro/edição com CPF mascarado, endereço manual opcional, autorização promocional desmarcada/compatibilidade do canal, resposta perdida de cadastro, compra identificada perdida/recuperada sem PII na referência técnica, mudança para anônimo e limpeza de dados entre compras, layout celular.
- Regressão: Caixa anônimo (10), equipe (6), estoque (5), notificações (7) e catálogo (6).
- Build público, sintaxe de JS, `git diff --check`; screenshot de celular inspecionada visualmente.

Testes de backend incluem: HMAC de busca exata por CPF; cifra da persistência e retorno sem CPF integral; CPF/UF/CEP inválidos; consentimento e revogação; unicidade e revisão concorrente; mudança de CPF recusada; autenticação/CSRF/origem/tamanho; falhas antes/depois de intenção, cliente, revisão, auditoria e conclusão; cada pagamento com e sem cliente; corrida pela última unidade; cliente inexistente/flag desligada; falha na atualização de última compra e leitura recuperadora; edição posterior preservada durante replay; recibo existente recuperável com as flags de novos cadastros desligadas.

Limites: Google Sheets/Drive/MailApp emulados; não comprova IAM, TLS/proxy reais, quotas/latência Google, banco/adquirente, CEP externo, Safari/iOS físico, restauração ou aceite operacional. Chromium usa o acesso real do código com autenticador virtual, apenas em serviços locais descartáveis. Consulta automática de CEP continua ausente enquanto não houver autorização específica do proprietário.
