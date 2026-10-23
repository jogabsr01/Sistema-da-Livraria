# Situação do PROMPT MASTER v17 — 23/10/2026

A v17 continua em evolução incremental. Código integrado, testes locais, deploy Netlify e homologação Google são evidências diferentes.

## Estado confirmado

- PRs #9–#14 e #16/#17 integrados: fundação, identidade, catálogo compartilhado, diagnóstico e ISBN/capas.
- PR #15 integrado em `dev/7108cf07429b7cecb1f99c7ce4b298c1f71fd768`: fotos privadas e preservação durante consultas ISBN. A antiga indicação de “em revisão” estava desatualizada.
- PR #18 integrado sob autorização expressa em `dev/63ff30fa1823fb4b650442b20bc78cc7ef5bdcd6`: Caixa anônimo, pagamentos registrados, baixa recuperável, auditoria e referência de venda pendente.
- PR #19 integrado em `dev/dc0c5996393e425fc87643088caafe8abaefddd8`: [reposição, edição de livros esgotados e exclusão administrativa](ESTOQUE_REPOSICAO_DEV.md), com entrada positiva no mesmo cadastro e bloqueio de estoque negativo.
- PR #20 integrado em `dev/2528ca0636976d4d5c6833ce44d07d2681d12150`: [notificações e relatório de reposição por fornecedor](NOTIFICACOES_REPOSICAO_DEV.md), com leitura pessoal, atendimento administrativo, resolução automática e CSV/impressão/texto manual.
- PR #21 integrado em `dev/26268992dc3032deab5f4673e4433a144a549b81`: [gestão de funcionários e primeiro acesso por CPF/e-mail](EQUIPE_DEV.md), dados pessoais cifrados, alterações recuperáveis e revogação de credenciais. Home de entrada e instalação Google real ficam para a etapa posterior solicitada.
- PR #22 integrado em `dev/d3bd501786524d5a89730499b5c009254a9018a9`: [clientes cifrados e Caixa identificado](CLIENTES_CAIXA_DEV.md), com consentimento, busca por CPF, revisão concorrente, venda recuperável e limpeza entre compras. Endereço manual por CEP disponível; consulta externa autorizada posteriormente pelo proprietário.
- Incremento desta branch: [operações, ajustes e estornos integrais](OPERACOES_ADMIN_DEV.md), histórico/comprovantes e [consulta opcional de CEP autorizada](CEP_BRASILAPI_DEV.md). [QA](QA_OPERACOES_CEP.md). Sem ativação Google real.
- `main`/produção seguem fora do escopo desta publicação DEV.

## Fases e pendências

| Fase | Implementação disponível | Pendências para conclusão |
| --- | --- | --- |
| A — Fundação | Modelo de 17 abas, provisionamento DEV, assinatura, isolamento e build. Confirmação anterior do proprietário: schema v1/17 tabelas e conexão DEV. | Backups/restauração reais, IAM e provisionamento de PROD após homologação. |
| B — Persistência | Catálogo, nichos existentes, capas/fotos privadas, ISBN, vendas anônimas e estoque recuperável. Esta branch acrescenta entradas positivas e edição de livros vendidos/esgotados. | Homologação de clientes/vendas identificadas (código neste incremento), homologação de ajustes/estornos integrais (código neste incremento), devoluções parciais, gestão de nichos, documentos, reconciliação entre aparelhos, compactação e homologação Google. |
| C — Identidade | PIN protegido, sessões/revogação, CSRF, papéis, limites persistentes, WebAuthn, bootstrap e primeiro acesso/login do proprietário em código. | Homologação Google/aparelhos reais, recuperação/rotação, proteção de tráfego e perfil/avatar. Funcionários e CPF disponíveis neste incremento, ainda sem homologação Google. |
| D — Gestão | Auditoria de catálogo/vendas/entradas; nesta branch, alertas compartilhados de estoque e relatório administrativo de reposição por fornecedor. | Homologação Google, consulta de auditoria, demais notificações, escalas com conflitos, nichos administráveis, relatórios comerciais e pedidos de compra. |
| E — Operação | Caixa com/sem cliente, atualização de estoque por foco/intervalo, recuperação de referência anônima de compra/entrada por aba. | Homologação de recibos/consultas (código neste incremento), reconciliação entre aparelhos, usabilidade e aceite multiusuário real. |

## Regras atuais

Saldo zero mantém o livro ativo e editável; não permite avançar na venda. Reposição soma unidades ao mesmo produto. Apenas ADMIN/SUPER_ADMIN podem excluir logicamente, desativar ou reativar, com verificação no servidor. Nenhum histórico é apagado. O projetor valida checkpoints de metadados junto das vendas/entradas e substitui o antigo bloqueio de edição `CATALOG_STOCK_HISTORY`.

## Próximas entregas

1. Atualização/homologação privada em lote do Apps Script e identidade, incluindo Stock.gs e Notifications.gs, sem enviar segredos no chat/GitHub.
2. Consulta/reconciliação de vendas/movimentos, ajustes/devoluções/estornos recuperáveis e clientes identificados.
3. Gestão de usuários, recuperação de acesso e perfil/avatar.
4. Nichos administráveis, consulta de auditoria, demais notificações, escalas, relatórios comerciais e acompanhamento de pedidos por fornecedor.
5. Compactação/retenção, backup/restauração e aceite em dois aparelhos reais antes de qualquer migração para PROD.

Publicação no GitHub/Netlify não atualiza nem ativa Google automaticamente. Nesta rodada não houve instalação de Apps Script, criação de conta real, envio de e-mail real ou mudança de flags privadas. O proprietário precisa concluir configuração/homologação. Testes em armazenamento emulado não comprovam IAM/quotas reais.

Guias: [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md), [CATALOGO_COMPARTILHADO_DEV.md](CATALOGO_COMPARTILHADO_DEV.md), [FOTOS_CAPAS_DEV.md](FOTOS_CAPAS_DEV.md), [CAIXA_COMPARTILHADO_DEV.md](CAIXA_COMPARTILHADO_DEV.md), [ESTOQUE_REPOSICAO_DEV.md](ESTOQUE_REPOSICAO_DEV.md). Descrições e relatórios anteriores registram o estado de suas entregas; este documento e o guia de reposição prevalecem para as regras atuais.

## Ordem autorizada de continuidade

Concluir as pendências originais incrementalmente antes da home e da configuração real Google: equipe/identidade; perfil e recuperação; clientes/vendas identificadas; ajustes/estornos/consultas; nichos e escalas; auditoria/relatórios/recomendações; reconciliação, retenção e backup/restauração. Nenhum teste local deve ser apresentado como homologação real. A sugestão de pedidos de compra permanece adicional, não substitui essas pendências.
