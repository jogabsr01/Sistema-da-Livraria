# Situação do PROMPT MASTER v17 — 24/10/2026

O v17 ainda não está concluído. Código integrado, testes locais, publicação DEV e homologação Google são evidências distintas. Home de entrada dos perfis e configuração real Google foram reservadas pelo proprietário para a etapa posterior às melhorias.

## Entregas

| Entrega | Implementação |
| --- | --- |
| PRs #9–#17 | Fundação, 17 abas, identidade/sessões/PIN/passkeys do proprietário, catálogo compartilhado, ISBN e capas/fotos privadas. PR #15 também integrado; a antiga indicação de revisão era desatualizada. |
| PR #18 | Caixa anônimo, pagamentos registrados, baixa recuperável e auditoria. |
| PR #19 | Entrada de unidades no mesmo livro, edição de vendidos/esgotados, exclusão lógica somente administrativa e bloqueio de estoque negativo. |
| PR #20 | Alertas compartilhados de estoque, leitura pessoal, atendimento administrativo e relatório de reposição por fornecedor, com CSV/impressão/texto manual. |
| PR #21 | Equipe, dados pessoais cifrados, CPF mascarado, gestão administrativa, revogação recuperável e primeiro acesso/login de funcionários por CPF/e-mail com passkey. |
| PR #22 | Clientes cifrados, consentimento de contato, revisão concorrente, Caixa identificado/anônimo, última compra recuperável e limpeza dos dados entre compras. |
| PR #23 | [Operações administrativas](OPERACOES_ADMIN_DEV.md): ajuste absoluto de estoque, estorno integral uma única vez por venda, histórico autorizado, comprovantes históricos e impressão; [CEP opcional à BrasilAPI](CEP_BRASILAPI_DEV.md), autorizado pelo proprietário e acionado somente ao clique. [QA](QA_OPERACOES_CEP.md). |
| PR #24 | Perfil próprio, telefone, avatar privado, menu da conta e recuperação de PIN por e-mail + passkey existente; projeções recuperáveis e revogação das sessões antigas. [Contrato e limites](PERFIL_RECUPERACAO_DEV.md). |
| E-mail verificado | Alteração autônoma com passkey recente e código no novo endereço, revogação de outras sessões, proteção contra conflito e recuperação de falhas. Login do proprietário separado da conta Google. [Contrato](EMAIL_VERIFICADO_DEV.md) e [QA](QA_EMAIL_VERIFICADO.md). |

Referência DEV antes deste lote: `972096a95ccb6983053cd96647361120327b0ea0`. Main/produção permanecem fora do escopo das publicações DEV autorizadas. Nenhuma flag privada ou instalação Google real foi alterada neste incremento.

## Pendências originais

| Área | Ainda necessário |
| --- | --- |
| Identidade | Recuperação quando todas as passkeys forem perdidas, gestão/rotação das demais credenciais, proteção de tráfego e homologação com aparelhos reais. Perfil/telefone/avatar e recuperação de PIN com uma passkey existente estão nos PRs anteriores; alteração verificada de e-mail neste lote. Nome/CPF de funcionários seguem administrativos. |
| Gestão | Nichos administráveis completos, escalas com conflitos e notificações de publicação/alteração, demais notificações administrativas e de sincronização. |
| Inteligência | Consulta administrativa da auditoria com filtros/exportação, relatórios comerciais integrados, perfil de compra e recomendações consultivas, mensagens preparadas conforme preferência/consentimento. |
| Operação e persistência | Revisão de reconciliação entre aparelhos, tratamento offline, documentos adicionais, retenção/compactação, backup/restauração e testes de recuperação reais. |
| Homologação posterior | Instalação privada do lote completo, IAM e quotas Google, MailApp/Drive reais, múltiplos aparelhos/usuários, aceite integrado e provisionamento PROD somente após homologação. |

Estorno integral está em código; devoluções/estornos parciais não estão implementados. Pedidos de compra com acompanhamento são sugestão adicional, não substituem as pendências originais. Nenhuma cobrança ou devolução bancária é executada pelo sistema atual.

## Regras preservadas

Saldo zero mantém o livro ativo e editável e não permite avançar na venda. Reposição soma unidades ao mesmo produto. Apenas ADMIN/SUPER_ADMIN podem excluir logicamente, desativar ou reativar. Estorno devolve as unidades ao mesmo cadastro sem reativar um livro inativo. Venda, itens, auditoria e eventos permanecem no histórico.

Projeções recuperáveis validam cadeias de estoque e versões junto das alterações de metadados, entradas, vendas, ajustes e estornos. Sessão/papel são validados no servidor sob o lock da operação. Dados pessoais não são autorização de acesso. PINs de demonstração não autenticam o backend real.

## Ordem autorizada de continuidade

Concluir as pendências originais incrementalmente: dados de identidade/credenciais restantes; nichos/escalas e demais notificações; auditoria/relatórios/recomendações; reconciliação, retenção/compactação e backup/restauração. Depois, home dos perfis e configuração real Google, como solicitado. Publicações DEV já autorizadas; não tocar em main nem pedir segredos no chat ou repositório.

## Validação deste incremento

Resultados deste lote registrados em [QA_EMAIL_VERIFICADO.md](QA_EMAIL_VERIFICADO.md); build, sintaxe e diff check. Google/Drive/MailApp/BrasilAPI emulados. Testes de impressão verificam a função e o CSS, sem comprovar impressora/PDF real. Esses resultados não equivalem a homologação Google, operação em produção ou conclusão do v17.
