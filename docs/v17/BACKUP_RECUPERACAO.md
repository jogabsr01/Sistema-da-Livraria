# Backup, migração, importação e recuperação

As rotinas operacionais do v17 estão em [Manutenção e recuperação DEV](MANUTENCAO_RECUPERACAO_DEV.md), com [QA](QA_MANUTENCAO_RECUPERACAO.md). Incluem propriedades privadas e arquivos, restauração isolada, inspeção, reconciliação, compactação técnica e gatilho opcional. As seções Fase A abaixo registram a fundação e não significam que o incremento de manutenção já foi instalado em Google real.

## Implementado na Fase A

`provisionDevelopment` e `migrateDevelopmentSchema` usam o lock do projeto. Antes de alterar qualquer cabeçalho, validam todos os cabeçalhos existentes. Divergências, recursos de outra instalação/ambiente, schema mais novo e fingerprint inconsistente recusam a operação. Não renomeiam uma aba existente para fingir compatibilidade.

Antes da primeira escrita da migração, fazem uma cópia da planilha na pasta privada de backups da instalação. O ID dessa cópia e o hash do schema são registrados em `_Migracoes` após completar e dar flush nas mudanças. Reexecução da versão concluída não copia novamente nem duplica dados. Falha antes da conclusão deixa recursos parciais preservados; nova execução faz outro backup do estado anterior à retomada, completa o schema e só então registra a versão.

A versão inicial é v1. Alterações futuras precisam de JSON/versionamento e passos de migração revisados, com testes. Não editar o arquivo gerado isoladamente, não mudar cabeçalhos manualmente e não sobrescrever a versão para ignorar conflitos. O emulador verifica o fluxo e preservação de linhas; o comportamento em Google real ainda requer homologação.

## Preparação de importação DEV

A fase entrega um **validador dry-run**, não um escritor/importador de produção:

```sh
node scripts/validate-import.mjs /caminho/privado/exportacao-produtos-dev.json
```

Formato: objeto com `environment: "dev"`, `schemaVersion: 1`, `products` (campos do produto do demo) e `niches` (id/nome). Excluir clientes, sessões, fila, vendas e quaisquer dados pessoais antes de exportar. O validador recusa esses campos em vez de tentar copiá-los. Aceita somente campos reconhecidos; exige ISBN válido ou identificador interno INT, vínculos de nichos, centavos/estoque inteiros, unicidade e ausência de fórmulas suspeitas. Emite só contagens, hash e `writePerformed: false`, sem imprimir conteúdos do arquivo.

Os ISBNs fictícios dos livros de demonstração podem falhar no checksum. Não “corrigir” automaticamente para um ISBN inventado: revisar com o exemplar ou migrar como código interno, com mapeamento explícito na Fase B. Um texto livre pode conter PII apesar do formato; a revisão humana continua necessária.

O importador efetivo da Fase B deverá validar o mesmo manifesto no servidor, exigir instalação DEV e usuário autorizado, backup prévio, IDs/mapeamentos determinísticos e journal de importação. Reexecução deverá reutilizar os IDs e recusar payload diferente com a mesma chave. O validador local não autoriza gravação e não prova que a importação remota foi realizada.

## Runbook de falha de migração DEV

1. Manter o backend desativado e preservar a mensagem/código da execução, sem copiar segredos.
2. Conferir conta, projeto e UUID de instalação. Não mudar `APP_ENV` ou apontar IDs para PROD.
3. Conferir as cópias existentes na pasta de backups e o histórico `_Migracoes`.
4. Se a versão não foi registrada e os cabeçalhos correspondem ao schema, reexecutar a mesma versão: a rotina é retomável e não apaga linhas.
5. Em conflito de cabeçalhos/hash ou versão, interromper. Fazer análise e preparar migração revisada; não editar a planilha para passar no teste silenciosamente.
6. Executar `inspectDevelopmentSchema`, comparar contagens e testar com dados fictícios antes de voltar a qualquer serviço.

## Recuperação de negócios — requisito antes de ativar a Fase B

Não há vendas remotas para restaurar na Fase A. Para a Fase B, testar restauração em ambiente descartável e separado, nunca sobrescrever a planilha oficial durante um teste:

- Congelar escritores, preservar a cópia do estado com falha e os eventos/journal mais recentes.
- Restaurar uma cópia privada com revisão do responsável, validar schema e bindings e comparar IDs, versões, contagens e totais.
- Reaplicar eventos posteriores à cópia em ordem, sob lock, com projeções idempotentes e sem dupla baixa. Preservar chaves idempotentes e a trilha de auditoria.
- Só promover a restauração após testes de estoque, saldo, venda, privacidade e outra cópia de segurança. Toda ação administrativa deve ser auditada.

Backups precisam de uma identidade/grupo de recuperação com permissão mínima e controle de acesso distinto dos operadores. Não tornar a pasta pública. Drive Trash e versionamento não são uma política completa de backup.

Periodicidade, retenção e metas RPO/RTO devem ser aprovadas conforme o volume e a política da livraria, incluindo eliminação legítima de PII também em backups. Não foi criado um job de exclusão ou retenção automática nesta fase. Antes de produção, medir uma restauração real e registrar o resultado; os testes locais não a substituem.

## Propriedades privadas e confirmação de e-mail

O incremento de [e-mail verificado](EMAIL_VERIFICADO_DEV.md) depende de propriedades privadas (`IDENTITY_OWNER_LOGIN_EMAIL`, `IDENTITY_EMAIL_CHANGE_<id>` e `IDENTITY_EMAIL_PENDING`), além das planilhas comum/de controle. Restaurar apenas a planilha não restaura um ponto consistente de identidade. O incremento de manutenção agora abrange essas propriedades no arquivo privado autenticado e testa sua retomada na cópia isolada. A homologação real ainda precisa conferir a proteção equivalente às credenciais, intenção/ponteiro coerentes e retomada em instalação descartável antes de ativação. Não exportar propriedades no chat, repositório, kit público ou CSV administrativo. Não remover uma intenção pendente para liberar acesso.
