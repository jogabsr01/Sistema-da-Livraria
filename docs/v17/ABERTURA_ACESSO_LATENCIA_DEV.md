# Abertura do acesso, consultas lentas e retomada DEV

Ocorrência real em 27/10/2026, America/Sao_Paulo: o proprietário recebeu INITIAL de `/api/v1/access/state` e UNAUTHENTICATED de `/api/v1/session`, mas a página ainda mostrou falha genérica, inclusive na entrada explícita. Esses retornos isolados não comprovam a sequência de requisições feita pela página. O motivo exato da falha no navegador real continua sujeito ao novo diagnóstico.

## Correção da abertura

Depois de receber um estado válido do servidor, a página apresenta o formulário correspondente antes de conferir a sessão anterior. Falha nessa consulta separada preserva o formulário não autenticado e seu fluxo, com aviso. Só uma resposta válida da sessão com garantia passkey pode exibir a área autenticada; estado COMPLETE isolado continua exigindo conferência/retomada. Falha no próprio endpoint de estado mantém os formulários fechados.

As informações opcionais para suporte mostram uma fase fixa (STATE, RENDER, SESSION ou ACCESS) e um código permitido, dentro de um painel fechado por padrão. A mensagem principal não exibe esses códigos. Erros de rede, resposta HTML/JSON inválida e timeout ficam distinguíveis. Mensagem arbitrária, corpo de resposta, endereço de e-mail, PIN, código, cookie e CSRF nunca são colocados nesse detalhe. JS/CSS da tela passam a usar Cache-Control no-store.

## Limites e leituras

O cliente operacional passa de 10 para 20 segundos por RPC. O handler de acesso compartilha um prazo monotônico de 55 segundos entre suas chamadas, incluindo o tempo já consumido antes delas. O tempo restante limita POST, redirecionamento permitido e leitura da resposta; orçamento vencido não inicia outra chamada. Não há retry automático. O diagnóstico de build mantém seu limite próprio de 60 segundos.

A margem do handler considera o limite síncrono de 60 segundos documentado pelo [Netlify](https://docs.netlify.com/build/functions/configuration/). Não é uma promessa de latência: medir cada etapa real depois de publicar. Os demais handlers mantêm suas validações e o limite por RPC; o orçamento agregado descrito aqui pertence especificamente ao handler de acesso.

No GAS, assertSchema_ lê os 17 cabeçalhos uma vez em cada verificação, em vez de duas, e o histórico de migração uma vez. Não utiliza cache entre requisições. Continua validando todos os cabeçalhos, versão e hash; conflitos em tabelas existentes mantêm precedência sobre tabelas ausentes. No armazenamento de autenticação, todas as formas/capacidades continuam verificadas, mas a validação da estrutura deixa de ler corpos de tabelas que não utiliza. A operação específica continua lendo e validando os registros de que precisa.

Assinaturas, bindings, nonce, autorização, MFA, recuperação de journals e idempotência não foram alterados. A alteração não cria usuários, redefine PIN/passkey, reprovisiona dados ou troca chaves.

## Aplicar na instalação existente

1. Aguardar o deploy DEV desta correção.
2. No GitHub, copiar integralmente `instalacao-google-dev/CodigoUnico.gs.txt` da mesma versão e substituir o conteúdo do Código.gs existente no Apps Script. Na modalidade única, manter esse script e appsscript.json. Manifesto, propriedades, IDs, pastas e chaves existentes permanecem preservados; não adicionar módulos duplicados.
3. Salvar e atualizar a mesma implantação por Implantar → Gerenciar implantações → editar → Nova versão. Preservar a URL /exec. Não executar novamente o bootstrap do proprietário para aplicar esta otimização.
4. Abrir acesso-dev.html com recarga completa. Conferir os formulários ou registrar somente o detalhe de teste, sem copiar credenciais. Medir duração/resultado de e-mail, PIN e passkey reais antes do aceite.

## Cenários acrescentados

- Cabeçalhos e migração lidos uma vez; modificação posterior é detectada sem cache. Ausência, conflito, hash inválido e duplicação de versão continuam recusados.
- Todos os cabeçalhos/capacidades privados são conferidos, sem leituras de dados que a validação não utiliza.
- Orçamento entre RPCs diminui com tempo monotônico; POST/GET/corpo compartilham o prazo; expiração não cria nova tentativa.
- Cookie de pré-acesso existente seguido de timeout não vira INITIAL falso nem emite sessão/cookie novo.
- Falha da sessão anterior preserva primeiro acesso e permite solicitar e-mail sem concessão de sessão.
- Recarga em EMAIL preserva a prova original e não reenvia e-mail automaticamente.
- Sessão não conferida mantém a área autenticada oculta; retorno do serviço recupera a sessão existente sem duplicação.
- Resposta inválida do endpoint de estado mantém formulários fechados e não reflete seu corpo no diagnóstico.
- Entrada explícita exige o estado obrigatório e evita somente a consulta opcional de sessão.

Resultados locais e real devem permanecer separados. Google/MailApp dos navegadores e contratos são emulados; passkeys dos testes usam autenticador virtual. O roteiro geral documental no PR #50 deve receber as novas evidências reais antes do fechamento.

## Validação final local

380 testes completos aprovados em Node 22.23.4 (emulador carregando a versão única) e Node 24.19.0 (módulos separados), sem falhas/skips/cancelamentos. Onze cenários Chromium aprovados, incluindo cinco novos casos de falha de consulta da sessão, preservação de e-mail, resposta inválida e entrada explícita. Seis testes Python do kit, geração atual, build e diff check aprovados. Captura da tela com falha de sessão inspecionada; continua exibindo os formulários e um diagnóstico sem valores privados. Ensaios iniciais de navegador tiveram seletores incorretos e uma expectativa de estado corrigidos; os resultados finais são os onze casos aprovados.

A latência Google real após atualizar a implantação ainda precisa ser medida. As contagens acima não equivalem ao aceite de entrega de e-mail, PIN/passkey físicos, multiusuário, quotas ou produção.

## Aceite parcial dos formulários

Após a atualização, o proprietário enviou imagem com os campos de acesso e a opção É meu primeiro acesso visíveis. A abertura foi confirmada; e-mail, PIN e passkey reais continuam pendentes. O atalho para a demonstração V15 e as mensagens que apontavam para ela foram removidos desta página de autenticação para evitar confusão entre as entradas. Essa remoção não altera o mecanismo de sessão nem as regras das APIs. Os PINs demonstrativos continuam sem autenticar o backend real.


## Confirmação salva com resposta perdida

O proprietário confirmou recebimento do e-mail real. Depois de confirmar o código, a tela não avançou; a recarga mostrou a etapa PIN, confirmando que o estado já havia mudado no servidor. Ao salvar o PIN, a tela apresentou ACCESS / ACCESS_RESPONSE_INVALID. Esse código indica resposta incompatível com o contrato JSON; a origem exata (plataforma, transporte ou serviço) e a gravação desse PIN ainda não foram confirmadas. Não atribuir automaticamente a erro de PIN ou de conexão do usuário.

A tela limita a espera de cada consulta a 60 segundos, incluindo o corpo da resposta, e mostra aviso após oito segundos de operação. Após falha de transporte, timeout ou resposta inválida ao confirmar e-mail/salvar PIN, faz uma única leitura de estado. Só avança se o servidor confirmar respectivamente PIN ou PASSKEY. Não repete a mutação, não reenvia código e não concede sessão; estado diferente ou consulta indisponível preserva a falha. Rejeição de credencial não provoca essa reconciliação. Passkey e conferência de sessão continuam obrigatórias.

Cenários: resposta perdida depois da confirmação do e-mail retoma PIN com uma única tentativa; resposta HTML depois de salvar PIN retoma PASSKEY sem novo envio; falha antes da confirmação mantém EMAIL, sem acesso ou sessão. Verificar também o prazo no corpo da resposta e aviso de espera. Google real continua sujeito ao aceite manual; os testes locais usam o serviço emulado. Esta alteração da tela não exige nova cópia de Código.gs ou propriedades.

Validação desta correção: 16 cenários Chromium distintos aprovados (14 na execução completa, mais os dois novos casos de corpo sem resposta e consulta de estado indisponível). Estado não conferido não avança, nenhuma tentativa é repetida automaticamente e nenhuma sessão é emitida nesses casos de retomada. Evidência local em serviço emulado; latência e aceite no Google real permanecem pendentes.


## Mensagens para quem utiliza a livraria

Falhas apresentam explicação em português e orientação de próximo passo: conferir o código completo e sua validade, revisar os dados de entrada, aguardar após muitas tentativas, seguir a confirmação pelo aparelho ou procurar a administração quando o acesso estiver indisponível. Resposta inválida do serviço não é atribuída à internet ou ao PIN do usuário. Mensagens arbitrárias de exceções e corpos de respostas nunca são exibidos.

Quando o resultado estiver incerto, o botão **Conferir etapa salva** permite consultar o estado sem recarregar, reenviar PIN/código ou reiniciar o cadastro. A consulta não concede acesso: COMPLETE exige conferência da sessão, e os demais estados continuam exigindo suas provas. Os detalhes técnicos permanecem apenas em **Informações para o suporte**, fechado por padrão e limpo no início da próxima operação. Nenhum PIN, código de e-mail, cookie ou token entra nesse painel.

Cenários de aceite: resposta inválida apresenta texto compreensível sem código técnico visível; abrir o painel revela somente a referência segura; conferir a etapa retoma PIN sem repetir a confirmação anterior; sucesso limpa o painel e a ação; código de e-mail errado oferece orientação específica e mantém o usuário na etapa, sem emitir sessão.

Validação das mensagens: 17 cenários Chromium aprovados, incluindo retomada pela ação visível, detalhes fechados por padrão, código errado sem sessão e confirmação final sem duplicação. Captura da mensagem de falha inspecionada; sem códigos técnicos no conteúdo visível padrão. Build, sintaxe JavaScript e diff check aprovados. Serviço Google/MailApp emulado, sem substituir o aceite real.


## Entrada, visualização do PIN e regra de cadastro

Por solicitação do proprietário, o botão inicial se chama **Entrar na minha conta**. A confirmação adicional usa **Confirmar no meu aparelho**, com explicação sobre biometria ou bloqueio de tela. O termo técnico passkey continua no protocolo, sem ser necessário entendê-lo para usar a tela. As regras de autenticação permanecem as mesmas.

Os três campos de PIN oferecem botão de olho acessível para mostrar/ocultar o conteúdo, com rótulo e estado anunciados. A visualização começa oculta e volta a ficar oculta ao enviar uma ação ou limpar/sair da página. Não há armazenamento do PIN no navegador.

Na criação ou recuperação de um PIN novo, números iguais adjacentes são recusados: 1123, 1223, 1233 e 1111 são exemplos inválidos. Repetições separadas, como 1212, continuam permitidas. O formulário explica a regra antes do envio e o servidor também recusa a criação, mesmo sem JavaScript. A verificação de PINs já cadastrados permanece compatível: a regra nova não bloqueia contas existentes nem exige rotação de chaves. Não há alteração de esquema ou Apps Script.

Casos acrescentados: alternar os olhos em cada campo e ocultar ao enviar; regra explicada sem envio de PIN inválido; tentativa direta pela API recusada sem avançar ou conceder sessão; PIN válido avança; registro legado com repetição continua sendo verificado. Os testes de outros módulos que entram pela mesma tela acompanham os novos nomes acessíveis. A ocorrência real de resposta inválida ao tentar entrar permanece em investigação; trocar textos ou validar PIN não comprova a causa nem a resolução dessa falha externa.

Validação final incluindo os pedidos de botões, olhos e PIN: 383 testes de backend aprovados (Node 24) e 19 cenários Chromium aprovados, sem falhas. Três contratos novos cobrem política de criação, compatibilidade legada e recusa direta pela API; dois cenários novos de navegador cobrem visualização/ocultação e regra antes do envio. Captura do formulário inspecionada. Ensaios anteriores de mensagens exigiram ajustar seletores de summary e expectativas dos textos alterados; todos foram corrigidos no resultado final. Não houve confirmação adicional de login no Google real.


## Desempenho e código de e-mail com sete caracteres

A abertura libera o formulário antes da consulta opcional de sessão. Uma resposta atrasada não pode substituir uma ação mais recente do usuário. O estado obrigatório do fluxo continua sendo consultado.

Dentro de uma única operação HTTP assinada sob ScriptLock, os vínculos dos mesmos arquivos e a estrutura do armazenamento privado são validados uma vez por conjunto de recursos. O escopo é descartado em finally, também em falhas. A próxima requisição revalida marcadores, privacidade e estrutura. Linhas de usuários, sessões, revogações, versões, limites e dados de negócio não são memorizados. Editor/manutenção não usam esse escopo. Não há cache entre solicitações.

Medição no contrato emulado, mesma sequência antes/depois: verificações de marcadores ao solicitar e-mail 19→6, confirmar e-mail 19→6, salvar PIN 33→9 e consultar estado 14→3. Esses números medem chamadas eliminadas, não segundos de Google real. A latência real e respostas inválidas da plataforma ainda exigem medição na instalação. KDF, nonce durável, bloqueios e autorização permanecem intactos.

O código entregue por e-mail passa a sete caracteres aleatórios em um alfabeto de 32 símbolos sem I/O/0/1, gerado com randomBytes sem viés. Letras minúsculas são normalizadas. Continua vinculado ao fluxo/navegador, armazenado somente como HMAC, válido por dez minutos, com uso único e até cinco tentativas de prova, além dos limites de solicitação e origem. Códigos longos já enviados permanecem válidos até o prazo original. Tokens internos de sessão/cookie, chaves de assinatura, pepper, CSRF e desafios do aparelho não são encurtados.

### Ordem de aplicação

1. Antes da publicação do backend, atualizar Código.gs pelo arquivo único desta versão, salvar e atualizar a mesma implantação Google por Nova versão. Preservar appsscript.json, propriedades, dados e URL /exec. Não executar bootstrap/provisionamento. O Google atualizado aceita os códigos longos anteriores e os novos curtos.
2. Só então publicar o backend DEV que gera sete caracteres. O Google antigo exigia 43 na entrega; não publicar a alteração de geração antes dessa atualização.
3. Recarregar a tela uma vez e medir abertura, envio/validação de e-mail, PIN e confirmação pelo aparelho. Marcar aceite real somente depois desses resultados.

Cenários: formulário utilizável com consulta de sessão suspensa; sessão atrasada não sobrepõe novo fluxo; código de sete caracteres/minúsculas funciona sem conceder sessão; código legado mantém validade; vínculo/privacidade/cabeçalho alterado entre requisições é recusado e o escopo sempre é limpo.


## Espera visual e falha ao confirmar PIN

O proprietário voltou a receber falha de confirmação na etapa de criar PIN, com referência ACCESS / ACCESS_RESPONSE_INVALID. Esse retorno não prova PIN errado nem gravação concluída; a causa da resposta incompatível continua sem evidência suficiente para atribuir à plataforma, rede ou serviço. A otimização anterior não deve ser registrada como correção definitiva desse incidente.

Durante uma ação, a tela apresenta somente um indicador circular e **Aguarde…**. Mensagens intermediárias não substituem o resultado na tela a cada etapa interna. Ao concluir, o indicador desaparece e aparece o resultado final; falhas recebem tom de erro e etapas confirmadas recebem tom de sucesso. Formulários anunciam aria-busy e botões ficam bloqueados contra envios repetidos. A preferência por movimento reduzido é respeitada. Nenhuma etapa é considerada concluída apenas porque a animação terminou.

O painel fechado de suporte acrescenta somente o nome de operação de uma lista fixa, status HTTP numérico e duração. Nunca mostra corpo da resposta, cabeçalhos, PIN, código, e-mail ou tokens. Resposta HTML após tentativa de PIN mantém a etapa fechada até confirmação real pelo servidor. Consultas de sessão também passam a limitar headers/corpo a sessenta segundos; respostas401/403 continuam significando ausência de sessão, sem exigir corpo JSON. Não há mudança em Apps Script, propriedades ou chaves nesta alteração visual/diagnóstica.

Cenários: operação suspensa mantém indicador visível, mensagens antigas ocultas, botões desabilitados e movimento reduzido; término apresenta resultado e libera controles; falha HTML504 antes da gravação de PIN oculta indicador, preserva a etapa e expõe somente metadados seguros ao abrir suporte; nenhuma repetição automática de PIN ou concessão de sessão. O novo diagnóstico permitirá distinguir status/tempo no acesso real, ainda pendente.

Validação desta interface: 22 cenários Chromium aprovados, incluindo espera/corpo suspenso, movimento reduzido, resultado final e HTML504 antes de salvar PIN. Capturas do carregamento e erro de PIN inspecionadas. Build, sintaxe JS e diff check aprovados. Serviço emulado; a falha real de PIN permanece pendente de novo detalhe de suporte.


## Preparação da confirmação pelo aparelho em uma chamada

Evidência real enviada pelo proprietário em 28/10/2026: OPTIONS recebeu HTTP502 e resposta não JSON após30,2s, antes da janela do aparelho. O fluxo já havia avançado para PASSKEY; isso não é evidência de PIN incorreto nem de confirmação do aparelho concluída. A documentação pública do [Netlify](https://docs.netlify.com/build/functions/configuration/) informa limite síncrono padrão de60s; o502 observado aos30,2s não comprova que esse seja o limite configurado ou a causa exata na instalação.

Antes da janela, o fluxo fazia cinco RPCs: tentativa durável, leitura do fluxo, lista de credenciais, gravação do desafio e vínculo ao fluxo. Um comando fixo **identity.access.options**, assinado e protegido pelas mesmas quatro flags DEV e ScriptLock, executa esses passos dentro de um RPC. Reutiliza authAttempt_, ownerAccessOperation_ e passkeyOperation_ para manter as verificações existentes. O desafio continua criptográfico e vinculado à cerimônia/conta/versão/navegador antes de retornar opções ao navegador. Ele não concede sessão nem aceita identidade, função ou sequência arbitrária fornecida pelo cliente.

Node constrói as opções WebAuthn com os bytes do desafio já persistido, mantendo RP/origem fixos, verificação do usuário obrigatória e algoritmo existente. Recuperação com substituição exige também a autorização da configuração Node enviada na requisição assinada, além das validações Google. Tentativa bloqueada mantém429 e prazo de espera. Uma falha entre gravar cerimônia e vincular fluxo não concede acesso; uma nova tentativa cria outro desafio e o vincula com as validações existentes.

Uma proposta maior de mudar várias etapas, tentativas, conclusão e prazo global foi rejeitada pela revisão automática por concentrar mudanças sensíveis sem validação suficiente. Essa proposta foi retirada. A implementação final é limitada à preparação do aparelho; os fluxos de PIN, e-mail, conclusão, retry de sessão e o orçamento global permanecem iguais. Não afirmar que esta alteração acelera todas as etapas ou resolve definitivamente a falha real antes do novo aceite.

### Aplicação

Atualizar primeiro o arquivo único Código.gs desta versão e a mesma implantação Google por Nova versão, preservando appsscript.json, propriedades, dados e URL/exec. Não executar bootstrap ou provisionamento. O backend antigo continua compatível com o Google atualizado. Só então publicar o backend DEV que usa o comando novo; o script antigo ainda não implementa esse comando.

Casos: um único RPC e uma única tentativa contabilizada; desafio devolvido coincide com o persistido e vinculado; conta desativada/versão alterada/fluxo vencido/PIN não definido/flag desligada recusados sem criar cerimônia; bloqueio respeitado; identidade ou função extra no payload recusada; falha no vínculo não concede acesso e nova tentativa funciona; erro502 na preparação explica tentar o aparelho, sem pedir novo cadastro de PIN. A validação física e a latência reais ainda dependem do proprietário.

Validação final: 392 testes completos aprovados em Node22 com o arquivo único; Node24 aprovou391 na suíte completa antes de acrescentar o último cenário de falha no vínculo e depois os seis contratos específicos. Vinte e três cenários Chromium distintos aprovados (22 completos e um novo de erro502), incluindo assinaturas reais com autenticador virtual. Seis testes do kit, geração atual, build e diff check aprovados. Um ensaio inicial detectou que o SDK recodificava o desafio quando recebido como texto; corrigido para os bytes base64url antes dos resultados finais. Google/MailApp emulados, aceite real ainda pendente.
