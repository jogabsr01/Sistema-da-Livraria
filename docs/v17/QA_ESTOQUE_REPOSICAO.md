# QA — estoque, edição e exclusão administrativa, 23/10/2026

Base: `dev/63ff30fa1823fb4b650442b20bc78cc7ef5bdcd6`, com PR #18 integrado sob autorização do usuário. Branch: `feat/v17-stock-replenishment`. Publicação exclusivamente em DEV; nenhuma mudança de main/PROD, flags privadas ou instalação Google.

## Execuções desta rodada

| Verificação | Resultado |
| --- | --- |
| Backend Node 24.19.0 | 185 aprovados, zero falhas/skips |
| Backend Node 22.23.4 | 185 aprovados, zero falhas/skips |
| Build / sintaxe JS / diff-check | Aprovados |
| Protótipo publicado | 37 testes Chromium aprovados, incluindo 3 novos de estoque |
| Catálogo compartilhado | 6 testes Chromium aprovados |
| Checkout compartilhado | 10 testes Chromium aprovados |
| Fotos privadas | 6 testes Chromium aprovados |
| ISBN compartilhado | 8 testes Chromium aprovados |
| Reposição / exclusão | 5 testes Chromium aprovados |
| Total browser reexecutado | 72 testes aprovados |

Não foram somados resultados de rodadas anteriores. Dependências de runtime mantidas. Fixtures mascaram também a flag de checkout e recusam rede externa, impedindo que testes usem recursos reais de uma configuração de build.

## Evidência principal

- Criar livro, receber duas unidades, vender ambas, recusar nova venda, editar título/preço esgotados, repor três e vender uma: saldo final dois no mesmo ID e com histórico preservado. Código HTTP, sessão e assinatura WebAuthn reais sobre Google/Mail/Drive emulados.
- Dois operadores recebendo sobre a mesma versão: apenas um confirma; o outro recebe conflito e não substitui o estoque.
- Falhas antes/depois de evento, movimento, auditoria e escrita do saldo: repetição produz uma entrada, um movimento e uma auditoria. Resposta perdida seguida de recarga usa a mesma chave e não soma novamente.
- Metadados interrompidos após vendas são recuperados antes de novas entradas. Versão sem checkpoint, saldo incompatível, snapshot adulterado e rollback de título são recusados antes de novas projeções. A foto privada pode ser alterada após esgotamento e permanece privada após novas entradas/vendas.
- Atendente não tem botão de exclusão nem controle de ativação habilitado; save com checkbox adulterado é negado pelo servidor. ADMIN/SUPER_ADMIN excluem logicamente, com cadastro e vendas preservados. Reativação administrativa permite repor o mesmo ID. Recebimento não reativa livro excluído.
- Zero, números negativos/fracionários, overflow, campos extras, motivo com fórmula, falta de CSRF/origem/sessão e colisões de IDs entre módulos recusados sem alterar o saldo.
- No Caixa, livro zerado e quantidade acima do disponível bloqueiam avanço. No protótipo, override antigo é ignorado e linhas repetidas são somadas antes da checagem para impedir saldo negativo. Edição/entrada continuam disponíveis para esgotados.
- Espaço local indisponível impede enviar a primeira entrada. Metadados, preço, capa, nichos e carrinho passam pelas regressões existentes.

## Limites

Recursos são descartáveis e emulados; testes não comprovam Google IAM, quotas ou persistência remota, e-mail real, aparelhos físicos/Safari ou pagamento bancário. Emulação mobile usa Chromium. Não há afirmação de homologação Google ou de ativação do backend privado. Ajustes negativos/estornos, reconciliação entre aparelhos, consulta de movimentos e demais módulos V17 seguem pendentes.

Instruções de lote e limites de capacidade: [ESTOQUE_REPOSICAO_DEV.md](ESTOQUE_REPOSICAO_DEV.md). É obrigatório incluir Stock.gs na atualização privada compatível.
