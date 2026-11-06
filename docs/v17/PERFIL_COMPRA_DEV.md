# Perfil de compra, recomendações e texto manual — DEV

Implementação da parte de inteligência comercial da Etapa 9 do PROMPT MASTER v17. A página `clientes-compras-dev.html`, acessível por Relatórios, consulta um cliente identificado por vez. ADMIN/SUPER_ADMIN com autenticação forte recente (até cinco minutos), sessão vigente, origem DEV exata e CSRF. ATENDENTE não recebe acesso ao histórico agregado nem às sugestões por esta API. O CPF é usado no POST já existente de localização, nunca na URL; não é exibido no perfil nem no texto preparado.

## Histórico e indicadores

O perfil considera todo o histórico comercial identificado disponível nesta instalação, não apenas o período da consulta anterior de relatórios. A fonte lê eventos comerciais v2/v3 desde 1970, preservando IDs, data, título, quantidade e preço em centavos de cada item. Vendas anônimas e compras de outros clientes ficam fora da fonte individual. Vendas técnicas v1 não compõem o perfil; se existirem na instalação, a tela informa essa exclusão sem atribuí-las a um cliente.

Estornos integrais permanecem visíveis com sua data e valor original, mas ficam fora de valor comprado, unidades, ticket, rankings, nichos e faixa habitual. Estornos posteriores também são considerados. Nenhum evento é editado/apagado. O histórico completo é retornado dentro dos limites abaixo e paginado na tela em 25 compras; rankings de livros mostram até oito títulos, e todos os nichos adquiridos são apresentados.

- Compras confirmadas: número de vendas vigentes, não número de itens nem dias de visita.
- Valor comprado: soma dos totais históricos dessas vendas; não representa custo, lucro ou liquidação bancária.
- Ticket médio: valor comprado dividido pelo número de compras confirmadas, arredondado ao centavo.
- Livros adquiridos: soma das quantidades confirmadas.
- Frequência: primeira/última compra e intervalo médio entre transações `(última − primeira)/(n − 1)`, em dias com uma casa decimal. Menos de duas compras resulta em ausência de intervalo, nunca em uma previsão. Compras no mesmo dia podem produzir intervalo zero.
- Faixa habitual: mínimo/máximo do preço unitário histórico e média unitária ponderada pelas quantidades. Sem compras confirmadas, a faixa é ausente.

Os títulos dos rankings e vínculos de nichos são os atuais do cadastro, pois o evento de venda não registra nichos históricos. Itens do histórico mantêm título/preço da venda. Uma unidade vinculada a dois nichos conta em ambos; esses totais não devem ser somados para inferir unidades distintas.

## Sugestões explicáveis

A seleção percorre todos os candidatos carregados antes de ordenar e apresentar até 12, com contagem explícita do total elegível. Cada sugestão deve ter livro ativo, saldo positivo, ao menos um nicho atual ativo compartilhado com compras confirmadas e preço atual entre 80% do menor preço unitário pago e 120% do maior. Os limites em centavos são arredondados para fora e a margem de 20% aparece na tela. É uma regra consultiva e determinística, sem provedor de IA ou inferência de dados externos.

Exclui todo produto que já apareça em compras desse cliente, incluindo compras posteriormente estornadas. Essa exclusão conservadora evita reapresentar itens de interesse já conhecido. Ordem: afinidade (soma das unidades compradas nos nichos em comum), proximidade da média unitária histórica, título e ID. Mostra os nichos em comum, preço e unidades disponíveis na consulta. Sem histórico confirmado, nicho relacionado ativo, preço compatível ou saldo não se inventa uma sugestão substituta.

A sugestão não reserva unidades, não muda o cadastro e não adiciona itens ao Caixa. A venda continua exigindo estoque e autorização no servidor; reposição utiliza o mesmo produto. Livros sem estoque continuam ativos/editáveis e apenas administradores podem excluir logicamente.

## Preparação individual para WhatsApp

Só é liberada com `contactPreference=WHATSAPP`, `marketingConsent=true`, data de consentimento registrada e telefone com formato válido no contato cifrado. Nenhuma preferência ou autorização é inferida do histórico, de um texto digitado ou de um check no próprio perfil.

O operador escolhe de um a três livros entre as sugestões apresentadas e solicita um texto fixo com nome do cliente, títulos, preços atuais e opção de pedir interrupção das sugestões. A resposta contém texto e ID do pedido, sem telefone, CPF, e-mail, endereço, histórico ou link de provedor. O operador revisa e copia o texto, usando manualmente o contato autorizado do cadastro. Não abre WhatsApp, não cria link externo, não envia mensagens, não acessa provedor, não agenda e não dispara em massa.

Preparar e copiar solicitam nova validação no servidor. A prova da consulta expira em cinco minutos e é vinculada ao usuário, sessão, versão de autorização, cliente e fonte. Alteração relevante de cadastro/consentimento, estoque, preço, catálogo ou histórico invalida a prova e exige nova consulta. O endpoint revalida novamente a fonte e a permissão sob lock antes de auditar/liberar o texto. Não é possível impedir que um texto já copiado seja usado manualmente depois; o consentimento deve continuar válido no envio efetivo.

Resultado incerto conserva o mesmo comando/seleção em memória e oferece repetição idempotente; não duplica a preparação registrada. Comando igual com outra seleção/autor/carga é recusado. Expiração ou mudança de fonte exige nova consulta, mesmo após uma resposta perdida; não se reconstrói uma sugestão antiga. A consulta de leitura registra cada autorização de consulta separadamente.

## Privacidade e integridade

Fonte interna assinada `insights.source`, com HMAC adicional sobre ambiente/instalação/cliente e dados de negócio em ordem canônica. O Node verifica a assinatura e valida referências, esquemas, identidades, equações e limites antes de calcular o perfil; contatos permanecem cifrados no transporte Google → Node e nunca entram na resposta do perfil. O contato do cadastro público existente é consultado somente para localizar o cliente, e a tela retém apenas o ID/nome necessário ao fluxo.

`insights.record` revalida sessão administrativa recente e a mesma fonte e grava CUSTOMER_INSIGHTS_VIEW ou CUSTOMER_MESSAGE_PREPARED em Logs_Auditoria antes da liberação. Armazena ID do cliente, ator, data, resultado, impressão HMAC e contagem; não armazena CPF/nome/contatos/títulos/texto/prova/cookie. Se a auditoria falhar ou estiver cheia, nenhum perfil/texto é liberado. Não há nova tabela, journal, escopo Google, chave, dependência ou serviço externo.

DOM usa texto literal. Sem localStorage/sessionStorage/IndexedDB. Mudança de CPF, limpeza, troca/perda de perfil, saída da página e retorno por cache removem perfil/histórico/sugestões/rascunho da tela e da memória do controlador. Sessão é conferida antes/depois das ações e no foco/visibilidade/minuto. Respostas JSON são no-store; página tem CSP e no-store. Dados exibidos são uma fotografia, não uma autorização permanente de contato.

## Limites e ativação posterior

Fonte comercial: até 5.000 livros, 2.000 vendas, 5.000 pessoas e 200 nichos; contatos do perfil limitados ao cliente alvo. Fonte codificada até 3,5 MB, ponte até 4 MB e resposta calculada até 2 MB. Corpo POST até 5.000 bytes. Recusa explícita sem truncar histórico nem apagar auditoria para abrir capacidade. Os 12 candidatos e oito títulos são seleções de apresentação declaradas, calculadas a partir do conjunto completo. Auditoria mantém limite existente de 5.000 registros; retenção/compactação seguem pendentes.

Atualizar o lote completo incluindo `CustomerInsights.gs` e `Reports.gs`, preservando propriedades e recursos privados. Novas flags `WORKSPACE_CUSTOMER_INSIGHTS_ENABLED` (Netlify DEV) e `CUSTOMER_INSIGHTS_ENABLED` (Apps Script DEV), fechadas por padrão, exigem também CUSTOMERS, REPORTS, CATALOG e IDENTITY_SESSIONS e as chaves pessoais existentes. Não provisionar nova instalação sobre dados existentes. Nenhuma configuração privada, flag real ou Google foi alterada neste incremento. Home de perfis e Google real permanecem para depois das melhorias originais; o v17 ainda não terminou.
