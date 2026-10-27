# Diagnóstico das chaves do primeiro acesso DEV

O proprietário relatou IDENTITY_CONFIGURATION_UNAVAILABLE mesmo após o cadastro das chaves. A mensagem genérica da interface não identifica qual campo falha. O endpoint GET `/api/v1/access/state` passa a acrescentar `error.configurationIssues` exclusivamente quando a configuração inicial de identidade falha em DEV.

O diagnóstico contém somente nomes fixos das três variáveis e um destes códigos:

| Código | Significado e ação |
| --- | --- |
| MISSING | Valor não chegou às Functions ou está vazio. Conferir nome exato, contexto Branch deploys/dev, escopo Functions e nova publicação após salvar. |
| INVALID_FORMAT | Valor não tem exatamente 64 caracteres hexadecimais. Corrigir somente essa variável, sem espaços/quebras de linha. Abrir o campo antes de gerar/copiar a chave evita sobrescrever o clipboard ao copiar o nome da variável. |
| REUSED | Valor é igual ao de outra chave de identidade ou HMAC, sem distinção de maiúsculas. Usar chaves independentes; preservar a HMAC existente e corrigir a configuração inicial da variável indicada. |

As variáveis verificadas são WORKSPACE_SESSION_TOKEN_KEY, WORKSPACE_AUTH_GUARD_KEY e WORKSPACE_PIN_PEPPER. O diagnóstico não revela valores, hashes, comprimentos, chaves parciais, parâmetros de pedidos ou identificadores de recursos Google. O código público principal e o status 503 continuam os mesmos; não é emitido cookie, CSRF, sessão nem chamada ao Google nessa falha.

O campo adicional não é oferecido em PROD, origens diferentes, métodos/operações diferentes, erros alheios à configuração de identidade nem falhas posteriores ao carregamento das configurações. Os controles de autenticação, formato e independência permanecem obrigatórios. Estado INITIAL com configuração válida não inclui o diagnóstico.

Após nova publicação DEV, consultar o estado e corrigir somente os campos indicados. Salvar e reconstruir a branch dev para aplicar valores; manter as chaves no cofre. Para instalação já utilizada, mudanças de chaves exigem seu procedimento operacional próprio: não interpretar este diagnóstico como autorização para rotação indiscriminada.

## Cenários de regressão

1. Ausência, formato incorreto e reutilização entre chaves/HMAC produzem somente nomes e códigos fixos; a função não altera o ambiente.
2. Falha na configuração inicial de GET state DEV retorna 503 com a indicação correspondente, sem cookie, concessão ou acesso ao upstream.
3. PROD, outra origem, POST e outras operações/erros não recebem os detalhes.
4. Configuração válida retorna INITIAL; falhas após o carregamento das configurações preservam a resposta genérica.

A correção acrescenta informação operacional segura; o aceite do primeiro acesso continua pendente até validar a configuração efetiva e executar e-mail, PIN e passkey reais. O registro de cenários gerais permanece no PR documental #50 em acompanhamento.

Validação em 27/10/2026 (São Paulo): 374 testes completos de backend aprovados em Node 22.23.4 e 24.19.0 durante a implementação; quatro contratos específicos reexecutados após exigir comprimento exato também para detectar quebra de linha final. Build e diff check aprovados. Nenhuma alteração de interface, código GAS ou valor privado foi realizada. O resultado das chaves efetivas do proprietário ainda precisa ser consultado no runtime publicado.
