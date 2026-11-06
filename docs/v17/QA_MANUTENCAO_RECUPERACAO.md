# QA — manutenção e recuperação

Validação local em 26/10/2026 (America/Sao_Paulo). Dados descartáveis, Google/Sheets/Drive/MailApp/ScriptApp emulados e assinaturas WebAuthn reais de autenticadores virtuais Chromium. Nenhuma propriedade, pasta, chave, gatilho, e-mail ou conta Google real foi alterada.

## Suíte completa

**356 testes completos do backend aprovados no Node 22.23.4 e os mesmos 356 no Node 24.19.0**, sem falhas, cancelamentos ou testes ignorados. São 356 casos distintos em dois runtimes. O total anterior era 332; este lote acrescenta 24 contratos de manutenção, sem remover os anteriores.

Comando: `node --test --test-concurrency=2 --test-reporter=tap tests/backend/*.test.mjs`. Logs finais: `work/maintenance-full22-release.log` e `work/maintenance-full24-release.log`. O build Netlify mantém `npm test && npm run build` e executa a suíte completa antes de gerar os arquivos públicos.

## Contratos novos

Os 24 casos de `tests/backend/maintenance.test.mjs` verificam:

- Proprietário Google ativo/efetivo, DEV, pasta restrita, chave independente, modo obrigatório e bloqueio do dispatcher durante manutenção.
- Backup de todos os stores/propriedades/journals, exclusão das chaves temporárias e reutilização da mesma referência.
- Arquivo adulterado, compartilhado, de instalação diferente ou sem binding recusado.
- Cópia isolada com células/arquivos, mantendo os bindings de negócio da instalação ativa.
- Recuperação de uma intenção de produto na cópia sem alterar o diário incompleto da origem.
- Reconciliação no armazenamento ativo com a chave original, sem duplicar produto ou auditoria.
- Rotação recusada com ponteiro pendente ou cerimônia ativa.
- Rotação preservando códigos e fluxos fechados, reautenticando seus MACs e sem revelar chave no retorno.
- Retomada da rotação após falha de gravação da chave.
- Compactação com arquivo anterior, preservação de sessões vivas e histórico de negócio, data mínima e repetição idempotente.
- Recuperação do proprietário mantendo UUID/papel e exigindo nova inscrição, com fatores antigos revogados.
- Avisos administrativos genéricos, leitura pessoal, invisibilidade para atendentes e tentativa de leitura indevida recusada.
- Falha depois de incrementar a autorização mantém a instalação bloqueada e é retomada sem outra recuperação.
- Endereço já indexado para outro funcionário recusado antes de revogar o proprietário.
- UUID de rotação antigo não pode ser reutilizado depois de outra rotação para alterar a chave novamente.
- Compactação interrompida depois da escrita retoma pelo plano assinado.
- Falha na restauração sempre limpa o contexto isolado, sem reconfigurar a origem.
- Funções privilegiadas não são ações aceitas pelo dispatcher público assinado.
- Propriedades recuperadas são preservadas na cópia; adulterar células depois faz a inspeção recusar.
- Schema danificado ou fluxo privado em commit impede liberar tráfego.
- Primeira entrega da nova inscrição após recuperação ocorre imediatamente, mantendo limite de reenvio na mesma versão.
- Falha no último marcador de rotação/recuperação é retomada, limpando somente o próprio ponteiro e sem duplicar auditoria.
- Gatilho opcional validado e repetição por intervalo sem outra cópia; manutenção manual não é desativada pelo job.
- Somente o proprietário instala/remove agendamento, preservando gatilhos não relacionados.

As falhas são injetadas antes ou depois das projeções relevantes. Planos e cópias são verificados pelo mesmo HMAC independente usado no código de manutenção; os testes não se limitam a conferir que uma função foi chamada.

## Navegador: 21 cenários únicos

| Grupo | Casos aprovados |
| --- | ---: |
| Manutenção e recuperação administrativa novos | 3 |
| Regressões de notificações/reposição | 7 |
| Regressões de primeiro acesso do proprietário | 6 |
| Regressões de recuperação emergencial | 5 |

Novos casos em `scripts/test-maintenance.py`:

1. Proprietário com fatores anteriores revogados confirma código no novo endereço, cria PIN novo e registra uma nova passkey com assinatura real do Chromium. O cookie antigo recebe 401; o perfil conserva o mesmo papel e mostra o novo endereço.
2. Backup/restauração isolada geram avisos com link de auditoria, leitura pessoal/histórico e sem ações de estoque.
3. Reconciliação de um cadastro com resultado incerto permite conferir o pedido original sem duplicar o livro.

O teste de recuperação identificou uma regra antiga que aplicava o limite da inscrição anterior à nova versão de autorização. A regra foi corrigida apenas para ACTIVATE: a primeira entrega da nova versão é permitida, e repetir a entrega na mesma versão continua limitado. O teste de navegador foi reexecutado e aprovado.

Logs finais em `work/maintenance-browser-final.log`, `maintenance-notifications-regression.log`, `maintenance-owner-regression.log` e `maintenance-emergency-regression.log`. Captura `work/qa-maintenance/perfil-recuperado.png` inspecionada no celular, sem overflow. Os endpoints `/test/maintenance-*` existem somente no harness local; não são funções Netlify nem rotas da aplicação publicada.

## Limites da evidência

O emulador recebeu cópia de planilhas/arquivos, enumeração de recursos, identidade Google ativa e gatilhos para testar os contratos. Isso não comprova IAM herdado, quotas, duração de restauração, escopos concedidos ou execução agendada em Google real. O novo escopo declarado `script.scriptapp` precisa de revisão na etapa Google; não houve concessão real nem instalação de gatilho.

Adaptadores de propriedades/recursos permitem recuperar na cópia e usam os serviços originais fora desse contexto. As 332 regressões anteriores continuam incluídas na suíte de 356. Build, sintaxe, AST Python e diff check aprovados. O formatador usado no desenvolvimento não foi adicionado às dependências do produto.

Publicação somente DEV, condicionada ao preview aprovado no head exato. Main/PROD e segredos reais preservados. Estes resultados encerram o lote de código e testes, não a homologação operacional do v17. [Procedimentos e limites](MANUTENCAO_RECUPERACAO_DEV.md).
