# Catálogo compartilhado DEV — cadastro e edição de livros

Incremento sobre o PR #13, integrado exclusivamente em dev no commit `1b7ca092a6283431de4b9c78c9e41e6afb1d774a`. O PR #14 foi integrado em dev em `5b6b57668f79ef377c89183a7262fef8005e3eba`; não altera main, produção, configurações privadas nem dados Google reais.

## Entrega

`catalogo-dev.html` usa a sessão verificada do primeiro acesso/login. Cadastra, pesquisa, pagina, abre detalhes, edita e inativa livros da instalação Google DEV. Existe um link a partir da tela de conta verificada. `index.html` e suas funções demonstrativas continuam idênticos; não há importação automática dos cadastros locais nem transferência de usuários/PINs demonstrativos.

Os campos persistidos incluem ISBN/código interno, título, autor, editora, edição, fornecedor, preço em centavos, estoque mínimo, categoria, nichos, ano, páginas, sinopse, situação e **link HTTPS da capa**. ISBN-10 válido é convertido para ISBN-13 para detectar a mesma edição; sem ISBN recebe código interno determinístico baseado no UUID, sem inventar ISBN. Pelo menos um nicho ativo é obrigatório. A preparação cria o nicho Geral apenas se a instalação não tiver nenhum; não substitui nichos existentes.

Estoque inicial é zero, e o cadastro nunca aceita saldo enviado pelo navegador. Alterações preservam saldo, autor/data de criação e identificador de imagem privada existente. Entradas/ajustes/vendas, cadastro administrativo de nichos, busca automática de ISBN e upload de foto/capa para Drive ainda serão ligados à persistência real. As versões demonstrativas desses recursos continuam no protótipo.

A capa deste incremento é uma URL externa persistida, **não uma cópia do arquivo no Drive**. A interface verifica o carregamento do navegador e mostra fallback se falhar; uma imagem indisponível não apaga o restante do cadastro. A altura da prévia permanece estável para não deslocar o botão Salvar no celular durante erro/carregamento da imagem. Disponibilidade futura depende do provedor da URL; o arquivamento privado de imagens pertence ao próximo incremento.

## Segurança e consistência

Rotas `/api/v1/catalog/list`, `/get`, `/niches` e `/save`, exclusivamente no hostname DEV. Node exige WORKSPACE_CATALOG_ENABLED, configuração DEV válida e sessões persistentes habilitadas. Google exige CATALOG_ENABLED e IDENTITY_SESSIONS_ENABLED. Sem qualquer configuração, recusa antes da operação. PROD e previews não podem ativar esse backend.

Cookie HttpOnly é a única identidade; dados do navegador não escolhem usuário/perfil. Permissões products.read/write são verificadas no Node e a sessão é resolvida novamente **sob o lock da gravação Google**. Sessão revogada, funcionário inativo, versão de autorização alterada ou administrador sem prova forte não grava. POST exige origem exata, JSON, CSRF vinculado à sessão, corpo de até 40 KB e campos permitidos. Não aceita preço decimal, saldo, operador, papel ou timestamps controlados pelo cliente. Textos que parecem fórmula são recusados; interface usa textContent, não HTML vindo do cadastro.

URL de capa deve ser HTTPS pública, sem credenciais, porta extra, fragmento ou hostname local/IP. Servidor não acessa a URL, portanto não introduz proxy/SSRF. A imagem é carregada pelo browser com no-referrer. CSP permite apenas scripts/estilos próprios, APIs na mesma origem e imagens HTTPS; não usa scripts inline nem carrega dados de autenticação em localStorage/sessionStorage.

Cada envio tem commandId, UUID do livro e expectedVersion. Alteração de versão retorna 409 e mantém o formulário para decisão do operador; o botão de recarga busca os dados atuais. Não mescla alterações silenciosamente. Repetição do mesmo comando pelo mesmo usuário retorna o recibo original, sem duplicar livro/log ou sobrescrever edição posterior. Reuso com outro conteúdo/usuário recusa. Novo rascunho mantém o mesmo ID mesmo se o usuário ajustar os campos após resposta perdida.

Google mantém intent/recibo em uma planilha **privada separada**, marcador catalog-journal e propriedade CATALOG_JOURNAL_ID. Os schemas das 17 abas de negócio e dos controles de identidade não mudam. Preparação pelo proprietário faz backup antes dos cabeçalhos, confere vínculo/privacidade e permite retomada sem apagar dados. Hash do registro detecta corrupção, sem pretender substituir permissões ou backups.

Antes de projetar produto, vínculos Produto_Nichos e auditoria, grava intent PENDING. Todas as leituras/gravações autorizadas recuperam esse intent antes de continuar. Falha entre etapas pode ter gravado uma parte: a resposta nunca presume sucesso e o próximo acesso conclui o mesmo comando. Relações de outros livros nunca são limpas. Snapshot anterior/posterior e versão impedem restaurar um livro por cima de saldo/metadados divergentes. Recibo COMPLETE só vem depois das projeções; auditoria usa o perfil autorizado, UUID, ação, horário e versões, sem credenciais.

Compatibilidade com o projetor de vendas anterior: seu histórico usa checkpoints de estoque/versão. Até integrar o escritor de estoque/vendas, edição de metadados de um produto presente nesse journal é recusada com CATALOG_STOCK_HISTORY. A recuperação de vendas pelo proprietário recupera primeiro intent de catálogo existente. Não liberar vendas reais nem chamar escritores sem recuperar intents sob o mesmo lock. Este limite preserva o histórico em vez de invalidá-lo com uma edição de catálogo.

## Lote Google/Netlify após revisão e aprovação

Não configurar produção nem promover branch deploy com Publish deploy. As flags reais continuam desligadas nesta entrega.

1. Concluir o lote de primeiro acesso em [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md), com arquivos atuais, permissões Google e chaves privadas. Nenhuma chave deve ser enviada ao chat ou ao repositório.
2. Incluir **Catalog.gs** e atualizar **Code.gs** e **Sales.gs** no mesmo projeto Google DEV. Os demais arquivos devem continuar nas versões atuais. Não copiar ferramentas de teste para o Apps Script.
3. Executar `provisionDevelopmentCatalog` no seletor de funções, como proprietário, após `prepareDevelopmentOwnerAccess`. Cria/reutiliza journal privado e, se necessário, o nicho Geral. Não altera livros existentes, clientes ou vendas.
4. Atualizar a implantação Google existente para a nova versão, mantendo a URL /exec. Não precisa de novos escopos Google nem novas chaves além do lote do PR #13.
5. Na homologação controlada, criar CATALOG_ENABLED=true nas propriedades privadas Google e WORKSPACE_CATALOG_ENABLED=true no Netlify, somente em **Branch deploys** limitado a dev. Manter variáveis de produção/previews vazias e os vínculos existentes DEV. As dependências de backend/sessão do primeiro acesso também precisam estar habilitadas. WORKSPACE_VERIFY_CONNECTION permanece false.
6. Atualizar apenas o branch deploy DEV. Entrar pela conta verificada e abrir `/catalogo-dev.html`. Usar cadastros descartáveis: salvar, abrir detalhes, conferir capa, atualizar em outro acesso e testar conflito de edição. Conferir dados no Google antes de aceitar o módulo.

Sem acesso às configurações privadas, esses passos não foram executados por esta sessão. Reversão: WORKSPACE_CATALOG_ENABLED=false fecha somente o catálogo compartilhado; não apaga os cadastros/journal. Não editar registros de journal manualmente para forçar sucesso.

## Testes e limitações

135 testes backend aprovados em Node 22 e 24; build aprovado. 45 cenários Playwright/Chromium aprovados: 6 novos de catálogo, 6 de primeiro acesso/login, 7 de verificação WebAuthn e 26 de regressão do protótipo. O protótipo, schema JSON e Schema.gs permanecem idênticos à base dev.

Testes novos cobrem gravação real do código Google em contrato descartável, dados monetários/ISBN, duplicidade, filtros/paginação, nichos, CAS de versão, duas sessões, isolamento, revogação entre Node e operação Google, CSRF, corpo excessivo, configuração fechada, recurso público/errado, órfãos e corrupção. Falhas antes/depois de intent, linha de produto, relação, auditoria e recibo não duplicam dados após retentativa.

Os workers de teste agora mascaram flags de ativação herdadas e bloqueiam fetch fora de loopback, inclusive redirects. Assim, executar a suíte em um futuro build DEV com variáveis reais habilitadas não conecta testes ao Google real. O diagnóstico de conexão do build é outro processo, explicitamente opt-in; não foi executado nesta entrega.

Chromium executa cadastro visual, recarga, detalhes e sincronização em duas sessões de navegador com cookies separados e logins assinados por autenticador virtual. A imagem de sucesso é uma **fixture PNG explícita**, testada com `img.complete && naturalWidth > 0` no formulário, lista e detalhes. Há fixture 404 vazia para erro de capa. Não são resultados reais de editoras/APIs; não foram enviados e-mails nem salvos livros em Google real. Screenshots sem dados reais: `/workspace/qa-v17-owner-access/catalogo-formulario.png` e `catalogo-celular.png`.

Comandos: `npm test`; `npm run build`; `npm run test:catalog`; `npm run test:access`; `npm run test:passkeys`; `ZXING_JS=<arquivo verificado> npm run test:browser`.

Capacidade inicial: 1.000 comandos de catálogo, 5.000 linhas por tabela de negócio e 200 nichos; paginação de dez livros. Atingir limites/corrupção falha fechado, sem truncar histórico. Ainda faltam arquivamento/retenção, testes de quota/desempenho/IAM e persistência Google real, gestão de nichos, upload privado de capas, adaptação da consulta automática de ISBN e integração com estoque/vendas/filas offline. A tela é uma primeira integração compartilhada, não a conclusão da fase B ou do V17.

## Incremento ISBN em revisão

[ISBN_COMPARTILHADO_DEV.md](ISBN_COMPARTILHADO_DEV.md) descreve a consulta autenticada de cinco fontes e a validação visual de capas. As descrições e contagens acima registram a entrega original do catálogo. O novo incremento não liga a flag real nem integra automaticamente o PR #15 de fotos; não há nova migração Google.
