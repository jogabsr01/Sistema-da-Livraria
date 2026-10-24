# Consulta administrativa da auditoria — DEV

`auditoria-dev.html` permite a ADMIN e SUPER_ADMIN consultar o histórico compartilhado e preparar uma exportação Excel. A autorização `audit.read` exige sessão forte recente (até cinco minutos), tanto em Node quanto no Apps Script sob o lock. Atendentes não consultam nem exportam, mesmo conhecendo IDs ou URLs. Não existe endpoint de edição ou exclusão de registros.

## Consulta e filtros

Filtros combináveis por responsável pela operação, operação, período, resultado, ID do produto e ID da venda. Combinar produto e venda busca a interseção; produto inclui a entidade direta, referências explícitas de alertas e itens/movimentos disponíveis nos detalhes históricos. O filtro de funcionário se refere ao autor da operação, não ao funcionário que aparece como alvo de uma alteração de escala. Produto/venda usam o identificador dos detalhes, sem inferir relações históricas a partir do cadastro atual.

A consulta admite até 366 dias por vez e pagina 25 registros, do mais recente para o mais antigo, com desempate estável por ID. A interface usa America/Sao_Paulo; os filtros de dias usam o deslocamento brasileiro vigente UTC−03:00 e o armazenamento mantém timestamps UTC canônicos. Início e fim são inclusivos. O campo Perfil representa o perfil no evento; o nome vem do cadastro atual, sem reescrever o histórico. Contas que já não constem do cadastro recebem indicação de conta histórica; eventos SYSTEM_STOCK aparecem como Sistema de estoque.

Cada página mostra operação, responsável, data/hora e resultado; detalhes mostram entidade, identificadores, requisição, campos anteriores e posteriores disponíveis. Algumas entregas antigas registravam apenas versão/revisão; este módulo não inventa nem recupera dados que não foram auditados originalmente.

A primeira consulta calcula uma impressão autenticada (HMAC, com domínio próprio e a chave de assinatura existente) do histórico, da instalação e dos filtros. Páginas seguintes e exportação precisam da mesma impressão. Inserção ou edição direta na origem invalida a consulta: a tela pede atualização, sem misturar páginas de momentos diferentes. Essa verificação ajuda a detectar alteração durante a consulta; não substitui armazenamento imutável, IAM ou proteção contra alguém com controle integral da planilha. Leituras da tela não acrescentam eventos que invalidariam a própria paginação.

## Dados protegidos

A consulta expõe um esquema fechado de campos operacionais, aplicado no Apps Script e novamente no Node. Cifra, PINs, tokens, contatos, e-mails, CPF, observações privadas e campos desconhecidos não são entregues. Notas livres/justificativas de ajustes são omitidas; motivos padronizados de entrada podem aparecer. Itens preservam identificador, título, quantidade e valores; movimentos preservam identificador, versão e saldos. Nome/cor de nicho são liberados apenas para eventos de nichos. Nomes de responsáveis são decifrados exclusivamente no servidor; envelopes e índices pessoais não chegam ao navegador ou Excel.

Se o payload anterior/posterior estiver em um formato legado ou contiver campos fora do contrato, a tela e o arquivo indicam omissão, mantendo a referência do evento. Essa omissão não altera nem apaga o payload original. Novos campos precisam de revisão explícita do esquema antes de divulgação. A interface usa texto literal para títulos e metadados e limpa resultados/detalhes quando perde a sessão ou o papel administrativo.

## Excel e rastreabilidade

O botão exporta o resultado completo dos filtros aplicados, incluindo páginas ainda não abertas, até 500 registros e 30 mil campos de detalhes. Não exporta apenas a página atual e não trunca resultados. Alterar qualquer filtro desabilita a exportação até aplicar a consulta novamente.

O arquivo é um pacote OOXML `.xlsx` verdadeiro com abas Auditoria, Detalhes e Filtros, cabeçalhos, filtros e primeira linha congelada. Auditoria inclui data/hora Brasília, timestamp UTC, autor, perfil, operação, resultado, entidade, requisição e indicador de omissão. Detalhes separa campos anteriores/posteriores em linhas; Filtros registra seleção, horário e identificador da exportação. Todas as células são texto explícito, inclusive valores que começam com `=`, `+`, `-` ou `@`; não há fórmulas, macros, vínculos externos ou bibliotecas carregadas de CDN. Valores monetários nos detalhes do Excel são centavos identificados pelo cabeçalho/campo; a tela os apresenta em reais.

A exportação usa POST com origem exata, JSON e CSRF da sessão. Antes de liberar os dados, acrescenta AUDIT_EXPORT com autor, filtros, quantidade, impressão e posição da origem. Esse evento comprova a autorização/preparação no servidor, não a entrega do arquivo nem sua abertura pelo operador. Repetir o mesmo comando, autor, filtros e impressão recupera o conjunto original sem duplicar o evento, mesmo após novas inserções. Alterar o prefixo histórico original bloqueia a repetição. Outro autor ou carga no mesmo comando conflita. Falha antes da gravação pode ser repetida; falha depois é reconhecida pela linha já gravada. Não há journal extra a apagar.

A confirmação incerta fica somente em memória; campos ficam bloqueados até repetir. Nenhum resultado é colocado em localStorage/IndexedDB. O download usa URL temporária revogada após o disparo e ao sair da página. O arquivo salvo no aparelho fica sob os cuidados do administrador; logout não apaga um download já salvo.

## Capacidade e instalação posterior

Limite compartilhado de 5.000 linhas em Logs_Auditoria: consulta continua disponível no limite; novas exportações exigem espaço para seu evento. Nenhum registro é removido para liberar capacidade. Payload bruto de um registro anterior/posterior admite até 50 mil caracteres; formatos inválidos de identidade/data/duplicidade falham explicitamente. Resposta assinada por stream limitada a 4 MB, com pré-verificação de 3,5 MB em base64 no Apps Script. Volume de campos ou resposta excessivo pede reduzir período/filtros antes de registrar nova autorização. Compactação, retenção e restauração continuam pendentes.

Flags `WORKSPACE_AUDIT_ENABLED` / `AUDIT_ENABLED` fechadas por padrão. Requer catálogo, sessões e chaves pessoais existentes. Reutiliza Logs_Auditoria e os cadastros existentes; sem nova aba, chave, escopo, recurso Google ou dependência npm. Atualizar o lote completo `.gs`, incluindo Audit.gs e seus leitores de sessão/cadastros. Não editar manualmente linhas históricas ou rodar migrações destrutivas.

Este incremento é a consulta/exportação do histórico já gerado. Ainda é necessário completar a cobertura de eventos solicitada no v17, incluindo tentativas de autenticação negadas, logout/bloqueios e maior detalhamento histórico de alterações de produto quando ainda só há versões. Não é a conclusão da etapa inteira de auditoria nem do v17. Home dos perfis e configuração real Google permanecem reservadas à etapa posterior solicitada pelo proprietário. [QA](QA_AUDITORIA.md) e [pendências](STATUS_V17.md).
