# Teste de conexão Google DEV sem ativar o backend

Este incremento depende dos PRs #5 a #8, ainda não integrados. O teste é operacional, não autenticação de usuário. Não altera index.html, não cria contas e não habilita Caixa, clientes ou vendas no Google.

## O que foi implementado

A operação assinada `system.ping` no Apps Script verifica bindings, marcação privada dos recursos, schema e nonce durável, retornando somente ready, environment e schemaVersion. É permitida apenas em APP_ENV=dev, sem atribuir identidade ou MFA a qualquer pessoa. Consultas de schema continuam exigindo autorização forte; vendas continuam indisponíveis por HTTP. A única escrita do diagnóstico é o nonce de proteção contra replay em _Requisicoes.

O cliente Node valida assinatura, correlação, versão, ambiente e URLs de redirecionamento. O build só executa o diagnóstico se WORKSPACE_VERIFY_CONNECTION=true, APP_ENV=dev, CONTEXT=branch-deploy, BRANCH=dev e WORKSPACE_BACKEND_ENABLED=false. A validação completa de hostname, endpoints, IDs e chave é reaproveitada em uma cópia local da configuração; process.env e a trava das rotas não são alterados. Não há endpoint público de diagnóstico que dispare requisições ao Google.

Log seguro esperado: `GOOGLE_DEV_CONNECTION_OK schemaVersion=1; operational backend remains disabled.`

Em erro, o build falha e imprime apenas código de erro permitido, sem mensagem arbitrária da exceção, chave, IDs ou conteúdo upstream. Por padrão, o diagnóstico é omitido sem acesso à rede. Pode ser desativado depois do teste sem afetar o protótipo.

## Ordem da homologação real

1. Atualizar somente o conteúdo de Código.gs com Code.gs deste incremento; preservar Schema.gs, Sales.gs, manifesto e todas as propriedades privadas.
2. No Apps Script, Implantar → Gerenciar implantações → selecionar a implantação DEV existente → editar (lápis) → Nova versão → Implantar. Preservar a mesma URL /exec e as opções de execução/acesso já revisadas. Não criar uma implantação paralela ou executar novamente o provisionamento sem necessidade.
3. Revisar e integrar a cadeia de PRs exclusivamente em dev somente após autorização explícita. O código de diagnóstico precisa estar no build da branch dev, não apenas em um preview. Não modificar main.
4. No Netlify, adicionar WORKSPACE_VERIFY_CONNECTION=true somente em Branch deploys. Foi confirmado pelo proprietário que Branch deploys inclui apenas dev. Production e Deploy Previews permanecem sem valor. Manter WORKSPACE_BACKEND_ENABLED=false.
5. Publicar novamente a branch dev e conferir a linha de sucesso no build. A versão anterior de Apps Script não implementa system.ping: atualizá-la antes deste teste.
6. Em falha, registrar apenas o código seguro; não anexar valores privados. Não mudar a trava operacional para true como tentativa de solução.
7. Depois do teste, definir WORKSPACE_VERIFY_CONNECTION=false para não bloquear novas publicações do protótipo durante indisponibilidade Google. Isso não revoga a implantação nem a chave.

## Evidências e limitações

Testes locais usam o código GAS real em contrato descartável e transporte simulado para provar assinatura, bindings, nonce e isolamento de operações. Não comprovam rede, quotas ou execução Google/Netlify real. A verificação inicial do proprietário no Google mostrou schemaVersion=1 e 17 tabelas; isso não equivale à comunicação Netlify→Google.

Credenciais reais não estão disponíveis na sessão e não foram solicitadas pelo chat. Variáveis com segredo devem continuar protegidas no Netlify, sem valores em Production ou Deploy Previews. O segredo está disponível no build, conforme os escopos exibidos pelo plano do proprietário; o diagnóstico não o copia para o artefato público nem o imprime. Código de build deve ser revisado antes de qualquer integração em dev.

A identidade real continua não implementada; um diagnóstico bem-sucedido não significa que login, conta master, gravações de negócio ou todas as fases estão concluídos.
