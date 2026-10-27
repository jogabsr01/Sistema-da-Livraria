# Instalação e atualização Google DEV

O código de identidade e dos módulos de negócio está integrado em DEV. A configuração e a homologação Google DEV foram autorizadas pelo proprietário. Isso não comprova acesso autenticado nesta sessão, nem execução real no Google. Não publicar em main/PROD por este roteiro.

Não enviar chaves, tokens, PINs, senhas ou JSON de credenciais no chat, GitHub, planilha ou frontend. Valores reais ficam nas interfaces privadas do Netlify e nas Propriedades do script. O arquivo `.env.example` é somente um modelo vazio.

## 1. Identificar e preservar a instalação existente

Na conta Google proprietária, abrir o projeto DEV informado pelo responsável. Conferir o projeto, a implantação /exec, `APP_ENV`, `OWNER_EMAIL`, `INSTALLATION_ID`, IDs de planilhas/pastas e permissões. O link do projeto e o e-mail não concedem acesso à conta. Se já existem recursos, preservar seus IDs, chaves, propriedades e dados; não criar outra instalação por cima.

Se o projeto acessar recursos PROD, interromper a atualização até separar DEV. Para instalação nova, usar identidade DEV sem acesso de edição a PROD, outro UUID v4 e recursos próprios. Somente nesse caso executar `provisionDevelopment`, que cria recursos privados e o schema inicial. Em instalação existente, começar por `inspectDevelopmentSchema`; erros de marcação ou schema exigem investigação, não troca manual de IDs.

Conferir IAM no Drive, inclusive heranças: pastas/planilhas privadas e editores explicitamente necessários. O manifest declara Sheets, Drive, identidade Google, envio de e-mail e gerenciamento de gatilhos. Drive tem escopo amplo; revisar o consentimento na conta correta. Declarar o escopo de gatilhos não instala agendamento.

## 2. Atualizar o lote completo

Para reduzir a operação manual a uma colagem, existe também a [modalidade de arquivo único](../../instalacao-google-dev/LEIA-ME.md). Use a modalidade única ou o lote modular descrito abaixo. Na modalidade única, os módulos separados devem ser removidos do editor para evitar funções/variáveis duplicadas; recursos, propriedades e implantação são preservados.

Gerar o ZIP fora do repositório com `python3 scripts/package-google-dev.py /caminho/privado/kit-dev.zip`. O destino deve ser novo. O empacotador verifica a lista completa de arquivos GAS e inclui `Maintenance.gs`, o manifest e os guias. Conferir hashes e tamanhos em `MANIFESTO.json` antes de copiar. O manifesto comprova o conteúdo do pacote; não comprova uma implantação real.

Copiar **todos** os arquivos de `google-apps-script`, mantendo seus nomes, mais `appsscript.json`. Não atualizar somente `Code.gs` nem misturar versões. Não colar segredos no código. O schema é o do mesmo commit; não editar cabeçalhos para contornar falhas.

Revisar as Propriedades do script:

| Propriedade | Origem |
| --- | --- |
| `APP_ENV` | `dev` |
| `OWNER_EMAIL` | Conta Google proprietária DEV verificada |
| `INSTALLATION_ID` | UUID v4 desta instalação; preservar se existente |
| `SIGNING_SECRET` | Chave HMAC desta instalação; preservar se existente |
| IDs de recursos | Provisionamento DEV original; nunca IDs de PROD |

Chaves novas usam 32 bytes aleatórios em 64 caracteres hexadecimais, gerados em ambiente privado e guardados em cofre. Não reutilizar a mesma chave entre finalidades. Não trocar uma chave existente para resolver erro de configuração: isso pode invalidar dados ou assinaturas. Consultar o roteiro de manutenção para rotação planejada.

Executar `inspectDevelopmentSchema`. Com schema principal atual, esperar `environment: dev`, `schemaVersion: 1`, `tables: 17`. Isso não inspeciona todas as permissões e controles privados. Executar `provisionDevelopmentAuthControls` para criar/atualizar o armazenamento privado de controles com suas migrações e backups. O journal privado do catálogo será preparado depois da identidade (etapa 6). Preservar recursos existentes. Falhas parciais devem ser retomadas pelo código; nunca apagar propriedades `IDENTITY_*_PENDING`, `MAINTENANCE_*_PENDING` ou journals.

## 3. Atualizar a implantação existente

Apps Script → Implantar → Gerenciar implantações → implantação DEV → editar → Nova versão → Implantar. Preservar a mesma URL /exec. Revisar execução como proprietário e acesso necessário ao backend sem login interativo. Os RPCs usam envelope assinado, nonce, tempo, bindings e autorização por operação; uma URL pública não concede papel administrativo.

Se a política Google impedir esse acesso, resolver a arquitetura com o responsável. Não contornar login, consentimento ou política de rede. Funções manuais de provisionamento/manutenção não são expostas pelo dispatcher HTTP. Os módulos de negócio são disponíveis somente com suas flags e autorização válidas.

## 4. Configurar o backend DEV e testar o canal

No Netlify, usar apenas o contexto da branch `dev`. Segredos operacionais precisam do escopo Functions. O diagnóstico de build requer acesso temporário aos bindings/HMAC no build DEV; revisar o código de build e limitar esse escopo. Production e Deploy Previews não recebem esses valores. Não colocá-los em `netlify.toml`, arquivos servidos ou variáveis de frontend.

| Netlify | Origem |
| --- | --- |
| `APP_ENV` | `dev` |
| `WORKSPACE_INSTALLATION_ID` | `INSTALLATION_ID` |
| `WORKSPACE_SCRIPT_URL` | URL /exec DEV existente |
| `WORKSPACE_SPREADSHEET_ID` | `SPREADSHEET_ID` |
| `WORKSPACE_DRIVE_ROOT_ID` | `DRIVE_ROOT_ID` |
| `WORKSPACE_HMAC_SECRET` | Mesma chave de `SIGNING_SECRET` |
| `WORKSPACE_BACKEND_ENABLED` | `false` durante teste do canal |

Netlify fornece `CONTEXT`, `BRANCH`, `DEPLOY_PRIME_URL` no build. Esses metadados são empacotados privadamente para as Functions, vinculados ao `SITE_ID` da publicação, pois não são garantidos no runtime. Não criar substitutos manuais nem usar valores de headers do cliente. O hostname DEV aceito pelo backend é `dev--merry-chimera-49a1f3.netlify.app`. O runtime precisa alcançar `script.google.com` e os redirecionamentos permitidos para `script.googleusercontent.com`.

No checkout completo do repositório (o ZIP é destinado ao editor GAS), executar `npm run google:preflight -- --phase service` no ambiente privado onde os valores estão configurados. Esse diagnóstico é **offline**, não carrega `.env` automaticamente, não altera flags e não mostra valores. Resultado válido não prova IAM ou conexão. Em seguida seguir [TESTE_CONEXAO_DEV.md](TESTE_CONEXAO_DEV.md) para o handshake real. Registrar evidência segura e voltar `WORKSPACE_VERIFY_CONNECTION=false` antes da ativação.

## 5. Ativar e homologar identidade

No Netlify DEV, cadastrar três chaves independentes de HMAC: `WORKSPACE_SESSION_TOKEN_KEY`, `WORKSPACE_AUTH_GUARD_KEY`, `WORKSPACE_PIN_PEPPER`. Chaves de sessão, guarda e PIN ficam somente no backend; não copiá-las para Apps Script. Para dados pessoais dos módulos posteriores, cadastrar também `WORKSPACE_PERSONAL_DATA_KEY` e `WORKSPACE_PERSONAL_INDEX_KEY`, distintas entre si e das demais. Guardar cópias em cofre; backup Google não substitui essas chaves.

Ativar os quatro pares de flags de identidade no Netlify (`WORKSPACE_…`) e nas Propriedades do script (sem `WORKSPACE_`): `IDENTITY_SESSIONS_ENABLED`, `IDENTITY_GUARDS_ENABLED`, `IDENTITY_PASSKEYS_ENABLED`, `IDENTITY_ACCESS_ENABLED`. No Netlify, definir `WORKSPACE_BACKEND_ENABLED=true` e manter `WORKSPACE_VERIFY_CONNECTION=false`.

Para conta ainda não preparada/ativada, executar `prepareDevelopmentOwnerAccess` como proprietário pelo editor. Seguir [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md). Não executar esse bootstrap para redefinir uma conta já ativada: ele recusa esse uso. Não criar usuário, papel, PIN ou passkey manualmente nas tabelas. Homologar e-mail, PIN, passkey, logout e limites persistentes antes dos demais módulos.

Executar `npm run google:preflight -- --phase identity` e testar pelo endereço DEV correto, em aparelhos reais. Em qualquer falha manter o módulo afetado fechado e preservar logs seguros/intents para investigação. Desligar uma flag não desfaz transações já concluídas.

## 6. Liberar módulos em etapas

O modelo `.env.example` lista flags e chaves de backend. Cada módulo GAS tem sua propriedade correspondente sem o prefixo `WORKSPACE_`; consultar o guia respectivo para dependências. `WORKSPACE_ISBN_LOOKUP_ENABLED` é opção de backend, não um novo requisito de provisionamento Google.

Antes do catálogo, executar `provisionDevelopmentCatalog` como proprietário, após preparar a identidade na etapa 5. Esse comando exige `IDENTITY_OWNER_USER_ID` existente e preserva o journal já provisionado.

Ordem sugerida: catálogo/capas/nichos → estoque/notificações → equipe/clientes → caixa/operações → perfil/recuperação/e-mail → escalas/auditoria/relatórios/perfil de compra → gestão de passkeys/recuperação emergencial. Ativar somente os pares do bloco que será homologado e suas dependências. Não habilitar todos de uma vez para tentar resolver falhas.

Após todos os módulos opcionais do checklist v17 escolhidos para o aceite, `npm run google:preflight -- --phase modules` exige a configuração completa desses módulos (ISBN continua opcional). Esse comando verifica formato/configuração do backend; não lê Script Properties e não prova correspondência de chaves com Google. A prova integrada está em [HOMOLOGACAO_GOOGLE_DEV.md](HOMOLOGACAO_GOOGLE_DEV.md).

## 7. Manutenção e aceite operacional

Seguir [MANUTENCAO_RECUPERACAO_DEV.md](MANUTENCAO_RECUPERACAO_DEV.md) para backup, restauração isolada, reconciliação e recuperação privilegiada. `MAINTENANCE_BACKUP_KEY` fica em Script Properties e em cofre externo, independente de `SIGNING_SECRET`; não vai no frontend ou no modelo Netlify. Backup assinado não é criptografia integral: revisar a privacidade dos arquivos.

Agendamento é opcional e permanece desligado até definir frequência, retenção e objetivos RPO/RTO. Não apagar histórico comercial, promover cópia restaurada nem instalar gatilho automaticamente por este roteiro. Homologação, entrega de e-mail, quotas e recuperação reais continuam pendentes até execução e evidência registradas. A promoção PROD exige decisão separada, recursos e segredos próprios.
