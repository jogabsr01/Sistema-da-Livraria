# Situação do PROMPT MASTER v17 — 23/10/2026

A v17 continua em evolução incremental. Código integrado, testes locais, deploy Netlify e homologação Google são evidências diferentes.

## Estado confirmado

- PRs #9–#14 e #16/#17 integrados: fundação, identidade, catálogo compartilhado, diagnóstico e ISBN/capas.
- PR #15 integrado em `dev/7108cf07429b7cecb1f99c7ce4b298c1f71fd768`: fotos privadas e preservação durante consultas ISBN. A antiga indicação de “em revisão” estava desatualizada.
- PR #18 integrado sob autorização expressa em `dev/63ff30fa1823fb4b650442b20bc78cc7ef5bdcd6`: Caixa anônimo, pagamentos registrados, baixa recuperável, auditoria e referência de venda pendente.
- Incremento seguinte desta branch: [reposição, edição de livros esgotados e exclusão administrativa](ESTOQUE_REPOSICAO_DEV.md). O usuário autorizou continuar a publicação dessas regras em DEV. Inclui entrada positiva no mesmo cadastro, checkpoints de edição após vendas e retirada da exceção de estoque negativo do protótipo.
- `main`/produção seguem fora do escopo desta publicação DEV.

## Fases e pendências

| Fase | Implementação disponível | Pendências para conclusão |
| --- | --- | --- |
| A — Fundação | Modelo de 17 abas, provisionamento DEV, assinatura, isolamento e build. Confirmação anterior do proprietário: schema v1/17 tabelas e conexão DEV. | Backups/restauração reais, IAM e provisionamento de PROD após homologação. |
| B — Persistência | Catálogo, nichos existentes, capas/fotos privadas, ISBN, vendas anônimas e estoque recuperável. Esta branch acrescenta entradas positivas e edição de livros vendidos/esgotados. | Clientes identificados, ajustes/estornos/cancelamento, gestão de nichos, documentos, reconciliação entre aparelhos, compactação e homologação Google. |
| C — Identidade | PIN protegido, sessões/revogação, CSRF, papéis, limites persistentes, WebAuthn, bootstrap e primeiro acesso/login do proprietário em código. | Homologação Google/aparelhos reais, funcionários, recuperação/rotação, proteção de tráfego, perfil/avatar e CPF. |
| D — Gestão | Auditoria de catálogo, vendas e entradas; abas administrativas desenhadas. | Consulta de auditoria, notificações compartilhadas, escalas com conflitos, nichos administráveis e relatórios reais. |
| E — Operação | Caixa sem cliente, atualização de estoque por foco/intervalo, recuperação de referência anônima de compra/entrada por aba. | Reconciliação entre aparelhos, recibos e consultas operacionais, usabilidade e aceite multiusuário real. |

## Regras atuais

Saldo zero mantém o livro ativo e editável; não permite avançar na venda. Reposição soma unidades ao mesmo produto. Apenas ADMIN/SUPER_ADMIN podem excluir logicamente, desativar ou reativar, com verificação no servidor. Nenhum histórico é apagado. O projetor valida checkpoints de metadados junto das vendas/entradas e substitui o antigo bloqueio de edição `CATALOG_STOCK_HISTORY`.

## Próximas entregas

1. Atualização/homologação privada em lote do Apps Script e identidade, incluindo Stock.gs, sem enviar segredos no chat/GitHub.
2. Consulta/reconciliação de vendas/movimentos, ajustes/devoluções/estornos recuperáveis e clientes identificados.
3. Gestão de usuários, recuperação de acesso e perfil/avatar.
4. Nichos administráveis, consulta de auditoria, notificações, escalas e relatórios.
5. Compactação/retenção, backup/restauração e aceite em dois aparelhos reais antes de qualquer migração para PROD.

Publicação no GitHub/Netlify não atualiza nem ativa Google automaticamente. Nesta rodada não houve instalação de Apps Script, criação de conta real, envio de e-mail real ou mudança de flags privadas. O proprietário precisa concluir configuração/homologação. Testes em armazenamento emulado não comprovam IAM/quotas reais.

Guias: [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md), [CATALOGO_COMPARTILHADO_DEV.md](CATALOGO_COMPARTILHADO_DEV.md), [FOTOS_CAPAS_DEV.md](FOTOS_CAPAS_DEV.md), [CAIXA_COMPARTILHADO_DEV.md](CAIXA_COMPARTILHADO_DEV.md), [ESTOQUE_REPOSICAO_DEV.md](ESTOQUE_REPOSICAO_DEV.md). Descrições e relatórios anteriores registram o estado de suas entregas; este documento e o guia de reposição prevalecem para as regras atuais.
