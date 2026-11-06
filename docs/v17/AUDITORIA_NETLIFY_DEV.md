# Auditoria Netlify pela API

O workflow `Netlify DEV read-only audit` consulta o projeto fixo `merry-chimera-49a1f3`, vinculado a `jogabsr01/Sistema-da-Livraria`. Não executa deploys, não publica branches, não altera variáveis e não acessa outros sites. Todas as chamadas à API são GET; o destino é api.netlify.com, com redirecionamentos recusados. A execução exige o repositório e a branch DEV exatos. O Secret é passado somente ao passo de auditoria, após testes com credenciais falsas.

## Autorizar

1. No Netlify, abrir as configurações pessoais, **Applications → Personal access tokens → New access token**: https://app.netlify.com/user/applications . Escolher nome identificável e expiração curta, se disponível. Um token pessoal herda permissões da conta; não presumir que ele é somente leitura. O código desta automação limita as operações a consultas GET do projeto fixo.
2. No GitHub, abrir **Settings → Secrets and variables → Actions → New repository secret**: https://github.com/jogabsr01/Sistema-da-Livraria/settings/secrets/actions/new . Nome: **NETLIFY_DEV_AUDIT_TOKEN**. Valor: o token, colado diretamente no campo privado. Não enviar o token pelo chat, não salvá-lo no repositório e não incluí-lo no Netlify como variável do app.
3. Informar apenas que o Secret foi salvo. A auditoria pode ser disparada na branch DEV atualizando a revisão em ops/netlify-dev-audit-request.json. Não é necessário alterar main para disponibilizar o botão manual do Actions.
4. Depois da análise, o token pode ser revogado no Netlify e o Secret removido do GitHub.

Sem o Secret, o workflow informa NOT_CONFIGURED e não faz chamadas à API. Isso não significa conexão ativa nem configuração aprovada.

## Cobertura e limites

A API oficial define que contexto `dev` é o ambiente local de `netlify dev`. A auditoria resolve, nesta ordem, `branch` com parâmetro `dev`, `branch-deploy`, `all`. Valores somente em `production`, `deploy-preview`, outra branch ou desenvolvimento local não validam a branch publicada DEV. A variável precisa conter o escopo `functions`.

Verifica as variáveis conhecidas da base e os 17 flags do bloco de ativação. Confere o destino fixo Apps Script, o formato de IDs, flags true e formato de seis chaves privadas, quando legíveis. Detecta reutilização de chaves e uso de valores de contexto `all`. Esse último aviso indica contexto compartilhado; não prova que produção usa o valor, pois pode haver um override específico.

Valores marcados `is_secret` ou omitidos pela API geram VALUE_NOT_READABLE, não OK. Não devem ser desmarcados como secretos para facilitar a auditoria. NOT_SET_AT_SITE significa ausência na resposta do site: variáveis compartilhadas da equipe não são lidas por esta rotina. Não há comparação de valores secretos com Script Properties Google; o diagnóstico Google recebido do proprietário confirma estados, não igualdade de segredos. Validação funcional de assinatura, recursos e E2E continua separada.

Lista até 50 deploys e resume apenas a branch DEV. Não inclui texto de logs, mensagens de erro do provedor, IDs privados, nomes pessoais, valores, tokens ou hashes de chaves. Falhas HTTP geram códigos fixos. Não grava o corpo de respostas em artefatos.

Contrato consultado: https://github.com/netlify/open-api/blob/master/swagger.yml (getSite, getEnvVars, envVar, envVarValue). A credencial real e o acesso ao endpoint ainda precisam ser confirmados na primeira execução autorizada.
