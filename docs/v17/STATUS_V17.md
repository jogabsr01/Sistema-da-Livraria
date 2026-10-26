# Situação do PROMPT MASTER v17 — 26/10/2026 (São Paulo)

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
| PR #25 | Alteração autônoma com passkey recente e código no novo endereço, revogação de outras sessões, proteção contra conflito e recuperação de falhas. Login do proprietário separado da conta Google. [Contrato](EMAIL_VERIFICADO_DEV.md) e [QA](QA_EMAIL_VERIFICADO.md). |
| PR #26 | Gestão administrativa completa, fundo privado, cor/ordem, múltiplos nichos por livro, cards/filtros no Caixa e desativação preservando vínculos e edição. [Contrato](NICHOS_DEV.md) e [QA](QA_NICHOS.md). |
| PR #27 | Calendário mensal/semanal, gestão administrativa, acesso somente à própria escala publicada, conflitos, histórico e notificações pessoais recuperáveis. [Contrato](ESCALAS_DEV.md) e [QA](QA_ESCALAS.md). |
| PR #28 | Filtros administrativos, detalhes protegidos e exportação Excel real com autorização registrada e repetição sem duplicação. [Contrato](AUDITORIA_DEV.md) e [QA](QA_AUDITORIA.md). |
| PR #29 | Negativas anônimas, bloqueios temporários/provas, logout e revogação recuperáveis; novos logs de metadados/preço/ativação/nichos antes/depois, com compatibilidade de registros antigos. [Contrato](EVENTOS_AUDITORIA_DEV.md) e [QA](QA_EVENTOS_AUDITORIA.md). |
| PR #30 | Vendas/estornos, estoque atual e movimentações com filtros combinados, indicadores/rankings e Excel autorizado após consulta. [Contrato](RELATORIOS_COMERCIAIS_DEV.md) e [QA](QA_RELATORIOS_COMERCIAIS.md). |
| PR #31 | Histórico individual, frequência/ticket/nichos/faixa habitual, sugestões explicáveis em estoque e preparação manual condicionada a consentimento/preferência WhatsApp. [Contrato](PERFIL_COMPRA_DEV.md) e [QA](QA_PERFIL_COMPRA.md). |
| PR #32 | Cadastro de chave adicional com prova existente, remoção por outra chave, última chave protegida, outras sessões revogadas e intenção HMAC recuperável. [Contrato](GESTAO_PASSKEYS_DEV.md) e [QA](QA_GESTAO_PASSKEYS.md). |
| PR #33 | Códigos guardados previamente + e-mail cadastrado + PIN/passkey novos, revogação de chaves/sessões antigas e intenção HMAC recuperável. [Contrato](RECUPERACAO_EMERGENCIAL_DEV.md) e [QA](QA_RECUPERACAO_EMERGENCIAL.md). |
| PR #34 | Bloqueio sem conferência recente, atualização completa após reconectar, descarte de respostas anteriores à queda e preservação de venda pendente para conferência explícita. [Contrato](RECONEXAO_CAIXA_DEV.md) e [QA](QA_RECONEXAO_CAIXA.md). |
| PR #35 | Rascunhos preservados ao reconectar, sessão da mesma conta antes das gravações, cadastro/foto com pedido fixo após resposta perdida e conferência explícita de reposição/exclusão sem duplicar efeitos. [Contrato](RECONEXAO_CATALOGO_DEV.md) e [QA](QA_RECONEXAO_CATALOGO.md). |
| PR #36 | Ajustes/estornos preservam pedido incerto, revisão explícita de saldo concorrente e distinção entre POST confirmado e comprovante indisponível; impressão protegida. [Contrato](RECONEXAO_OPERACOES_DEV.md) e [QA](QA_RECONEXAO_OPERACOES.md). |
| PR #37 | Pedido original de leitura/acompanhamento preservado, limpeza de conta/relatório antigo, respostas atrasadas descartadas antes de arquivos/texto e revisão de relatório por até 90 segundos. [Contrato](RECONEXAO_NOTIFICACOES_DEV.md) e [QA](QA_RECONEXAO_NOTIFICACOES.md). |
| PR #38 | Dados privados removidos em mudança de contexto, downloads atrasados bloqueados, mesma referência de exportação preservada até seu prazo e descarte explícito sem apagar auditoria. [Contrato](RECONEXAO_RELATORIOS_DEV.md) e [QA](QA_RECONEXAO_RELATORIOS.md). |
| PR #39 | Limpeza de registros/detalhes em mudança de contexto, resposta atrasada sem arquivo, referência de exportação preservada e descarte explícito, com retenção local de até cinco minutos sem apagar histórico. [Contrato](RECONEXAO_AUDITORIA_DEV.md) e [QA](QA_RECONEXAO_AUDITORIA.md). |
| PR #40 | Limpeza de CPF/histórico/texto, resposta atrasada descartada antes da exibição/cópia e preparação pendente conferida com a mesma referência, respeitando consentimento e prazo. [Contrato](RECONEXAO_PERFIL_COMPRA_DEV.md) e [QA](QA_RECONEXAO_PERFIL_COMPRA.md). |
| PR #41 | Rascunho protegido na mesma aba, conferência recente, revisão concorrente explícita e publicação/cancelamento incertos conferidos com o pedido original. [Contrato](RECONEXAO_ESCALAS_DEV.md) e [QA](QA_RECONEXAO_ESCALAS.md). |
| PR #42 | Conferência recente da mesma conta, rascunho protegido na aba, imagem tardia descartada e revisão concorrente explícita; pedido incerto mantém campos, imagem e chave originais. [Contrato](RECONEXAO_NICHOS_DEV.md) e [QA](QA_RECONEXAO_NICHOS.md). |
| Reconexão de equipe e clientes | Dados de consulta removidos em mudança de contexto, rascunhos protegidos na aba, pedidos originais preservados, revisão concorrente e distinção entre cadastro salvo e leitura posterior falha. [Contrato](RECONEXAO_PESSOAS_DEV.md) e [QA](QA_RECONEXAO_PESSOAS.md). |

Referência DEV antes deste lote: `4b33af8ef4cdc3cfa68bb4fda5ad9a86b46b6edb`. Main/produção permanecem fora do escopo das publicações DEV autorizadas. Nenhuma flag privada ou instalação Google real foi alterada neste incremento.

## Pendências originais

| Área | Ainda necessário |
| --- | --- |
| Identidade | Verificação administrativa de identidade quando não houver códigos preparados ou acesso ao e-mail, rotação planejada das chaves da instalação, proteção de tráfego e homologação com aparelhos reais. Perda de todas as passkeys tem fluxo neste incremento quando existem códigos previamente guardados e e-mail acessível. Gestão de passkeys adicionais/remoção está no PR #32. Perfil/telefone/avatar e recuperação de PIN com uma passkey existente estão nos PRs anteriores; alteração verificada de e-mail no PR #25. Nome/CPF de funcionários seguem administrativos. |
| Gestão | Demais notificações administrativas e de sincronização. Escalas e seus avisos pessoais foram implementados no PR #27. |
| Inteligência | Lote de perfil, sugestões e preparação manual implementado; homologação com dados reais e aceite dos critérios consultivos permanecem para a etapa Google. |
| Operação e persistência | Reconexão do Caixa (PR #34), Catálogo/reposição (PR #35), Operações (PR #36), notificações/reposição (PR #37), relatórios comerciais (PR #38), auditoria (PR #39), perfil de compra (PR #40), escalas (PR #41), nichos (PR #42), equipe e clientes neste lote; demais módulos e reconciliação entre aparelhos, documentos adicionais, retenção/compactação do armazenamento, backup/restauração e testes de recuperação reais ainda necessários. Limpeza local de visualização não compacta nem exclui histórico. Sem venda offline ou persistência nova de pedidos/relatórios/textos no navegador. |
| Homologação posterior | Instalação privada do lote completo, IAM e quotas Google, MailApp/Drive reais, múltiplos aparelhos/usuários, aceite integrado e provisionamento PROD somente após homologação. |

Estorno integral está em código; devoluções/estornos parciais não estão implementados. Pedidos de compra com acompanhamento são sugestão adicional, não substituem as pendências originais. Nenhuma cobrança ou devolução bancária é executada pelo sistema atual.

## Regras preservadas

Saldo zero mantém o livro ativo e editável e não permite avançar na venda. Reposição soma unidades ao mesmo produto. Apenas ADMIN/SUPER_ADMIN podem excluir logicamente, desativar ou reativar. Estorno devolve as unidades ao mesmo cadastro sem reativar um livro inativo. Venda, itens, auditoria e eventos permanecem no histórico.

Projeções recuperáveis validam cadeias de estoque e versões junto das alterações de metadados, entradas, vendas, ajustes e estornos. Sessão/papel são validados no servidor sob o lock da operação. Dados pessoais não são autorização de acesso. PINs de demonstração não autenticam o backend real.

## Ordem autorizada de continuidade

Concluir as pendências originais incrementalmente: dados de identidade/credenciais restantes; escalas e demais notificações; auditoria/relatórios/recomendações; reconciliação, retenção/compactação e backup/restauração. Depois, home dos perfis e configuração real Google, como solicitado. Publicações DEV já autorizadas; não tocar em main nem pedir segredos no chat ou repositório.

## Validação deste incremento

Suíte completa do backend: 332 testes em cada uma das versões Node 22 e 24. Navegador deste bloco: 62 cenários selecionados de equipe, clientes e Caixa. As contagens por bloco não representam o total do sistema; o build de publicação executa a suíte completa do backend. Resultados deste lote em [QA_RECONEXAO_PESSOAS.md](QA_RECONEXAO_PESSOAS.md); nichos anteriores em [QA_RECONEXAO_NICHOS.md](QA_RECONEXAO_NICHOS.md); escalas anteriores em [QA_RECONEXAO_ESCALAS.md](QA_RECONEXAO_ESCALAS.md); perfil de compra anterior em [QA_RECONEXAO_PERFIL_COMPRA.md](QA_RECONEXAO_PERFIL_COMPRA.md); Auditoria anterior em [QA_RECONEXAO_AUDITORIA.md](QA_RECONEXAO_AUDITORIA.md); Relatórios comerciais anteriores em [QA_RECONEXAO_RELATORIOS.md](QA_RECONEXAO_RELATORIOS.md); Notificações anteriores em [QA_RECONEXAO_NOTIFICACOES.md](QA_RECONEXAO_NOTIFICACOES.md); Operações anteriores em [QA_RECONEXAO_OPERACOES.md](QA_RECONEXAO_OPERACOES.md); Catálogo anterior em [QA_RECONEXAO_CATALOGO.md](QA_RECONEXAO_CATALOGO.md); Caixa anterior em [QA_RECONEXAO_CAIXA.md](QA_RECONEXAO_CAIXA.md); recuperação anterior em [QA_RECUPERACAO_EMERGENCIAL.md](QA_RECUPERACAO_EMERGENCIAL.md); gestão anterior em [QA_GESTAO_PASSKEYS.md](QA_GESTAO_PASSKEYS.md); perfil de compra anterior em [QA_PERFIL_COMPRA.md](QA_PERFIL_COMPRA.md); relatórios anteriores em [QA_RELATORIOS_COMERCIAIS.md](QA_RELATORIOS_COMERCIAIS.md); eventos anteriores em [QA_EVENTOS_AUDITORIA.md](QA_EVENTOS_AUDITORIA.md); consulta anterior em [QA_AUDITORIA.md](QA_AUDITORIA.md); escalas anteriores em [QA_ESCALAS.md](QA_ESCALAS.md); nichos anteriores em [QA_NICHOS.md](QA_NICHOS.md). Build, sintaxe e diff check aprovados. Google/Drive/MailApp/BrasilAPI emulados. Testes de impressão verificam a função e o CSS, sem comprovar impressora/PDF real. Esses resultados não equivalem a homologação Google, operação em produção ou conclusão do v17.
