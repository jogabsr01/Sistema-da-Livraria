# Relatórios comerciais — DEV

`relatorios-dev.html` oferece três consultas administrativas: Vendas e faturamento, Posição atual do estoque e Movimentações de estoque. ADMIN/SUPER_ADMIN precisam de autenticação forte recente, até cinco minutos, em Node e Apps Script sob o lock. Atendentes não consultam nem exportam. Não há ação de cobrança, devolução bancária ou alteração de estoque neste módulo.

## Critérios e filtros

Vendas e movimentações admitem período de até 366 dias, com início/fim inclusivos. A interface usa America/Sao_Paulo e limites de dia no deslocamento vigente UTC−03:00; os timestamps persistidos são UTC canônicos. Estoque é uma posição de agora e não aceita período/atendente para evitar sugerir uma reconstrução histórica inexistente.

Filtros combináveis: atendente, cliente/CPF, produto/título, ISBN-10/13 válido (normalizado para 13), autor, editora, fornecedor, nicho, categoria, faixa de valor, pagamento, cidade, saldo atual, situação ativa/inativa e tipo de movimentação. Filtros incompatíveis com o relatório são desabilitados na tela e recusados no servidor. Atendente/nicho têm seleções preenchidas pelos resultados consultados; IDs de cliente/livro podem ser copiados dos detalhes para busca exata. Todos os filtros se combinam por interseção.

Título e preço dos itens vendidos são os da venda registrada. A busca por título considera o título histórico ou atual; autor/editora/fornecedor/nicho/categoria/ISBN, situação e saldo são os atuais do produto. Cidade, UF e nome são os do cadastro atual do cliente; não se inventa endereço antigo da compra. A tela e o Excel identificam essa distinção. Livros desativados e esgotados continuam no histórico; o filtro de ativação/saldo permite delimitá-los.

Valor mínimo/máximo refere-se ao valor da venda completa em Vendas e ao preço atual do livro em Estoque. Movimentações não aceitam filtro de valor porque não há preço histórico em todas as movimentações. CPF/cliente/cidade/pagamento aplicam-se apenas a Vendas. Cidade compara sem distinção de caixa/acentos. Vendas anônimas entram normalmente quando não há filtro de cliente/CPF/cidade.

## Vendas e faturamento

O conjunto é definido pela data da venda e pela situação atual. Bruto soma os itens selecionados das vendas encontradas, inclusive as estornadas; estornado soma os itens selecionados das vendas integralmente canceladas; líquido = bruto − estornado. Estorno registrado depois do período também cancela a contribuição daquela venda. Isso não equivale a fluxo financeiro por data de liquidação nem conciliação bancária.

Com filtro de produto, somente os itens correspondentes compõem valores, unidades e rankings. Cada detalhe preserva também o valor da venda completa, para não confundir subtotal filtrado com o comprovante integral. Ticket médio é o líquido dos itens selecionados dividido pelo número de vendas confirmadas, arredondado ao centavo; zero quando não há confirmação. Unidades líquidas e rankings excluem vendas estornadas. Não há estorno parcial ou desconto inventado.

A tela apresenta bruto/líquido/estornado/ticket, contagens, unidades, rankings de até oito livros e atendentes, paginação de 25 vendas e detalhes completos dos itens selecionados. O conjunto completo continua no resultado/exportação; a limitação de oito se aplica somente à apresentação dos rankings. Os rankings completos vão para o Excel.

As fontes são os eventos autoritativos SALE_COMMITTED v2/v3 e SALE_REVERSED, após recuperar e validar as projeções existentes. Eventos técnicos v1 anteriores ao contrato do Caixa não compõem faturamento; sua quantidade no período é sinalizada explicitamente. Vendas, itens, pagamentos e preços já confirmados não são regravados pela consulta.

## Estoque e movimentações

Estoque mostra livros, saldos, mínimos, situação, metadados e nichos atuais. Indicadores: quantidade de livros, unidades totais, livros zerados/baixos e valor das unidades ao preço de venda atual. Esse valor não é custo, lucro ou margem; o sistema não possui dados suficientes para esses cálculos.

Movimentações mostram ENTRADA, SAIDA por venda, AJUSTE e ESTORNO, com quantidade, saldo anterior/posterior, autor, data e referência à venda quando houver. Entradas/saídas somam as variações positivas/negativas reais; ajustes podem aumentar ou diminuir. O saldo líquido do período é a variação, não o saldo físico atual nem uma receita financeira. Motivos livres não são expostos pelo relatório.

## Privacidade e integridade

Consulta e exportação usam POST com origem exata, JSON e CSRF da sessão. CPF nunca é colocado na URL, resposta, auditoria ou arquivo. O controlador o valida e envia à ponte apenas o índice HMAC específico de clientes. Contatos continuam cifrados até o servidor Node; a consulta só entrega nome/cidade/UF necessários, sem e-mail, telefone, endereço, preferência de contato, consentimento, CPF bruto ou envelopes. Filtro de cidade é aplicado no Node após decifrar os contatos referenciados, sem abrir acesso a registros de outras funções/perfis.

O Apps Script entrega DTOs limitados, referências e uma impressão HMAC do ambiente, instalação, filtros e fonte. O Node verifica a impressão, os campos/referências e as equações dos itens/saldos; revalida filtros e calcula totais em centavos inteiros. Campos desconhecidos não são propagados para o navegador ou Excel. Overflow de inteiros e volume excessivo falham explicitamente.

Antes de liberar uma consulta, o servidor registra COMMERCIAL_REPORT_VIEW. A exportação requer uma consulta anterior, com prova HMAC de até cinco minutos vinculada ao usuário, sessão, versão de autorização, filtros e fonte. Mudar filtro, sessão, metadado, contato, estoque, venda ou estorno relevante exige consultar novamente. A ponte confere novamente a sessão e a fonte sob lock antes de gravar a autorização. Nenhum arquivo é liberado sem COMMERCIAL_REPORT_EXPORT correspondente.

Auditoria inclui autor, tipo, contagem, resumo numérico e impressão opaca; não grava CPF, cidade ou filtros pessoais em texto. A consulta administrativa da auditoria libera tipo/contagem e continua omitindo campos fora de seu esquema. Logs não integram a impressão da fonte comercial, de modo que registrar a própria consulta/exportação não invalida o resultado.

## Excel e repetição

O arquivo `.xlsx` é OOXML verdadeiro e reutiliza o gerador ZIP/CRC/XML da auditoria, ampliado para múltiplas abas. Vendas tem Resumo, Vendas, Itens, Produtos, Atendentes e Filtros; Estoque e Movimentações têm suas abas correspondentes, Resumo e Filtros. Inclui todas as páginas consultadas. Valores monetários são centavos inteiros identificados nos cabeçalhos e células numéricas; textos são células literais, mesmo quando começam por caracteres de fórmula. Não há macros, fórmulas ou vínculos externos.

O arquivo é preparado no servidor antes de registrar a autorização, para recusar limites de planilha sem registrar uma geração inviável. A autorização comprova o preparo/liberação no servidor, não o recebimento ou abertura no aparelho. Repetir o mesmo comando/ator/carga, com fonte e prova ainda válidas, não duplica o evento. Após nova venda/edição ou vencimento da prova, uma resposta perdida exige nova consulta; não se simula a recuperação de um arquivo antigo cujo conjunto já mudou.

Comando incerto fica só em memória e bloqueia os filtros até repetir. Não há resultados, CPF ou provas em localStorage/IndexedDB. Filtros pessoais/resultados/detalhes são limpos ao perder sessão/papel/trocar usuário e ao sair da página. O menu e o módulo conferem a sessão antes/depois das operações e em foco/visibilidade/minuto. URLs de download são temporárias e revogadas; um arquivo já salvo permanece sob responsabilidade do administrador.

## Capacidade e ativação posterior

Mantém limites existentes: até 2.000 eventos de domínio e 5.000 linhas por tabela operacional/auditoria; produtos até 5.000, nichos até 200. Fontes completas têm limite de 3,5 MB em base64 no Apps Script, transporte assinado por stream até 4 MB, resultado JSON até 2,5 MB. Acima desses limites o usuário deve refinar filtros/período; nunca há lista parcial silenciosa. A exportação admite até 30.000 linhas de dados por aba e células de até 32.000 caracteres, com teto de XML por aba. Esses limites também podem exigir refinar um conjunto muito detalhado. Não apaga histórico para liberar capacidade.

As flags novas WORKSPACE_REPORTS_ENABLED e REPORTS_ENABLED ficam fechadas por padrão. Requer catálogo, sessões e chaves pessoais existentes; sem nova aba, migração, chave, recurso Google ou dependência npm. Atualizar o lote completo incluindo Reports.gs e seus helpers de recuperação/auditoria/cadastros. Nenhuma configuração privada real foi alterada. Home dos perfis e configuração Google continuam posteriores às melhorias originais.

Este lote entrega consultas comerciais. Perfil de compra individual, frequência/faixa habitual, recomendações e mensagens preparadas com consentimento continuam como próximo incremento, não são funcionalidades concluídas aqui. [QA](QA_RELATORIOS_COMERCIAIS.md) e [estado do v17](STATUS_V17.md).
