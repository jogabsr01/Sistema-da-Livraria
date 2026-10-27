# Teste do canal Google DEV sem ativar operação

O diagnóstico de serviço já está implementado. Ele não autentica usuários nem comprova o aceite dos módulos comerciais. Seguir primeiro [INSTALACAO_GOOGLE.md](INSTALACAO_GOOGLE.md), preservando recursos e implantação existentes.

A operação assinada `system.ping` verifica bindings, marcação privada, schema e nonce durável. Retorna somente dados seguros de prontidão/ambiente/versão. A escrita do diagnóstico é o nonce de proteção contra replay. Funções manuais de provisionamento não estão disponíveis por esse endpoint; operações comerciais têm suas próprias flags e autorização.

O cliente Node valida assinatura, correlação, versão, ambiente e URLs de redirecionamento. O build executa esse teste apenas com `WORKSPACE_VERIFY_CONNECTION=true`, `APP_ENV=dev`, `CONTEXT=branch-deploy`, `BRANCH=dev` e `WORKSPACE_BACKEND_ENABLED=false`. A validação usa cópia local da configuração, sem mudar o ambiente ou a trava operacional.

## Execução real

1. Atualizar **todo** o lote de `google-apps-script`, incluindo `Maintenance.gs` e `appsscript.json`. Preservar propriedades/IDs/chaves. Não copiar somente Code.gs.
2. No Apps Script, atualizar a implantação DEV existente: Gerenciar implantações → editar → Nova versão → Implantar, mantendo a URL /exec e as opções de execução/acesso revisadas.
3. Confirmar que a versão correspondente está na branch `dev`; manter main/PROD intactas.
4. Configurar bindings e HMAC privadamente no Netlify DEV. Restringir Branch deploys a `dev`, sem valores em Production ou Deploy Previews. O diagnóstico exige esses valores no build; os RPCs exigem Functions.
5. Executar o preflight offline no ambiente configurado: `npm run google:preflight -- --phase service`. Ele não faz requisição e não carrega `.env` automaticamente. Resultado `configurationValid: true` é somente verificação local de formato.
6. Definir temporariamente `WORKSPACE_VERIFY_CONNECTION=true`, manter `WORKSPACE_BACKEND_ENABLED=false` e publicar novamente DEV. Conferir no build: `GOOGLE_DEV_CONNECTION_OK schemaVersion=1; operational backend remains disabled.`
7. Em falha, registrar somente o código seguro e investigar versão, bindings, assinatura, permissões e rede. Não ativar backend para tentar corrigir o diagnóstico.
8. Depois da evidência, voltar `WORKSPACE_VERIFY_CONNECTION=false`. A ativação de identidade exige sua etapa própria; não deixar o diagnóstico de build ligado com backend ativo.

## Evidências e limites

Em erro, o build falha com código permitido, sem imprimir chave, IDs ou mensagem arbitrária upstream. Não existe rota pública para disparar esse diagnóstico. Guardar a referência privada do build e seu resultado, sem exportar configuração preenchida.

Testes locais usam GAS e transporte simulado; não comprovam rede, IAM, quotas, entrega de e-mail ou execução real Google/Netlify. Schema visível no editor também não prova o canal Netlify→Google. Preencher o roteiro [HOMOLOGACAO_GOOGLE_DEV.md](HOMOLOGACAO_GOOGLE_DEV.md) somente após execução real.

## Tempo limite do diagnóstico

O handshake executado no build tem prazo total de 60 segundos para POST, redirecionamento permitido e leitura da resposta. A margem atende a partida do Apps Script e à espera do lock (até 20 segundos). O prazo anterior de 10 segundos podia encerrar antes de uma inspeção legítima, como a execução manual observada de aproximadamente 13 segundos.

Esse prazo é exclusivo do diagnóstico DEV com backend desligado; o padrão dos clientes operacionais permanece em 10 segundos. Assinaturas, nonce, correlação, ambiente e allowlist de redirecionamento continuam obrigatórios. Não há repetição automática do pedido.

`UPSTREAM_TIMEOUT` informa somente que o cliente esgotou seu prazo; não prova falha de chave ou indisponibilidade definitiva do Google. Conferir as Execuções de `doPost` no Apps Script para distinguir execução lenta, ausência de chamada e erro. Se persistir após 60 segundos, investigar a execução e a rede antes de alterar configurações. Medir a latência dos módulos reais antes de ativar operação; sucesso no handshake não homologa tempo de atendimento do login/caixa.
