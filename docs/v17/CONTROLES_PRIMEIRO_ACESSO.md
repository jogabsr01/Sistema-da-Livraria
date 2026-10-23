# Controles persistentes de tentativas e códigos temporários

Incremento da fase C sobre dev após o PR #10. Implementa controles internos do servidor; não abre rota pública de login, não envia e-mail, não verifica PIN, não emite sessão nem ativa usuário. O protótipo visual permanece idêntico.

## Armazenamento privado

`AuthControl.gs` mantém uma planilha separada, com marcador `identity-controls`, mesma instalação DEV e compartilhamento privado. Contém três abas: `_Control_Migrations`, `_Auth_Limits` e `_Auth_Challenges`. Não altera o schema das 17 abas de negócio. Não armazena PIN nem dados pessoais em texto puro.

O provisionamento `provisionDevelopmentAuthControls` exige o proprietário Google configurado e DEV, sob ScriptLock. Cria/reutiliza o recurso privado, guarda ID em Script Properties (`IDENTITY_CONTROL_SPREADSHEET_ID`), valida cabeçalhos, faz backup antes de escrever e registra hash/versão do schema. Uma execução parcial pode ser retomada sem apagar linhas. IDs incorretos, marcadores incompatíveis, compartilhamento público, PROD e outro proprietário recusam novas escritas.

Este procedimento está preparado em código para homologação posterior, não foi executado na conta real. Não solicitar ao proprietário mais cópias de código ou flags antes de concluir a revisão e o fluxo de identidade.

## Limitação de tentativas

A operação assinada `identity.guard.attempt` reserva uma tentativa simultaneamente em dois contadores lógicos:

- Conta: cinco tentativas em 15 minutos.
- Origem: 30 tentativas em 15 minutos.

Ao exceder o limite, aplica 60 segundos de bloqueio; reincidências dobram o prazo até uma hora. Consultas durante o bloqueio não prorrogam o prazo. Após o bloqueio permite outra janela; 24 horas sem atividade reiniciam a penalidade. Os limites são constantes no servidor, não parâmetros do navegador. O serviço Node devolve erro seguro 429/AUTH_RATE_LIMITED com retryAfterSeconds para o futuro handler.

E-mail/CPF e IP recebem HMAC com chave privada e separação de finalidade/ambiente/instalação antes de atravessar a bridge. E-mails são normalizados para caixa baixa/espaços externos; CPF numérico normaliza pontuação. IPv4 mapeado em IPv6 compartilha o mesmo contador; IPv6 agrupa /64. Esses índices são pseudonimizados e continuam sujeitos a retenção e controle de acesso.

A origem deve vir exclusivamente de contexto confiável da plataforma (por exemplo, context.ip do Netlify). Nunca usar X-Forwarded-For, corpo ou query controlados pelo chamador. O futuro fluxo deve usar o mesmo normalizador para resolver a conta e deve reservar tentativas antes de KDF, verificação de código ou despacho de e-mail. Os helpers são internos e não forçam essa orquestração por conta própria.

LockService serializa as reservas. Uma falha entre as duas gravações recusa o pedido e pode gastar tentativa adicional ao repetir; não concede verificação de PIN sem ambas as reservas persistidas. Esses limites não substituem proteção de borda contra volume de tráfego/quota Google.

## Códigos temporários de uso único

As operações `identity.challenge.create/consume` suportam ACTIVATE, RECOVER e DEVICE. O serviço gera ID UUID v4 e token aleatório de 256 bits, destinado a futuro link privado. Somente HMAC do token é persistido; sujeito, finalidade, versão de autorização e instalação participam da vinculação criptográfica.

Exige funcionário ativo previamente cadastrado e versão de autorização correspondente em Configuracoes. ACTIVATE exige primeiro acesso ainda não concluído; RECOVER/DEVICE exigem que esteja concluído. Cada código vence em dez minutos, permite cinco verificações incorretas, e só pode ser consumido uma vez. Reemissão revoga o anterior da mesma finalidade. Retry de criação com mesmo ID/conteúdo preserva a expiração. Mudança de versão ou desativação invalida a prova.

O token bruto retornado pelo helper de criação pertence SOMENTE ao controlador privado de entrega futuro: nunca colocar em JSON público, logs, localStorage, planilha ou auditoria. O controlador deve resolver subjectId e versão no servidor, não aceitar essas afirmações do navegador. Pedidos públicos futuros devem responder de forma genérica sem revelar se a conta existe; este incremento não fornece esse endpoint nem o envio de e-mail.

O retorno verified=true não autentica alguém sozinho, não prova MFA e não concede perfil. Para concluir primeiro acesso/PIN/sessão, o comando futuro precisa revalidar usuário/versão e consumir a prova junto da operação autorizada sob o mesmo lock, ou implementar commit recuperável. A operação isolada é segura contra replay, mas uma falha após gravar consumo e antes da resposta exige novo código; não reaproveitar o anterior para simular sucesso.

## Ativação e limites

Novos controles têm flags independentes, desligadas por padrão: WORKSPACE_IDENTITY_GUARDS_ENABLED no Node e IDENTITY_GUARDS_ENABLED no Apps Script. O Node exige WORKSPACE_AUTH_GUARD_KEY de 32 bytes hex, diferente da chave da bridge e das chaves de sessão/PIN quando presentes. DEV/branch/hostname continuam estritamente validados. Não cadastrar segredos nem alterar as flags reais nesta entrega.

Até 3.000 registros por tabela; capacidade excedida e histórico inválido falham fechados antes de novas escritas. Ainda faltam limpeza/arquivamento com política de retenção, controle de quotas em borda e homologação de desempenho. Não limpar manualmente os contadores durante janela de proteção. Não habilitar login ao integrar somente este PR.

## Validação

93 testes backend passaram em Node 22 e 24, build público passou e 26 testes Playwright/Chromium passaram, incluindo celular. Os 16 testes novos exercitam o código GAS com contrato descartável e HTTP local real: migração idempotente, backup anterior, recuperação parcial, recusa de PROD/recurso público, limites entre instâncias, bloqueio progressivo, expiração, finalidade/sujeito, reemissão, uso único e falha após gravação de consumo.

Nenhum teste desta entrega usou conta/credencial pessoal ou executou controles de identidade no Google real. A conexão real já confirmada no deploy do PR #9 continua evidência da bridge, não do fluxo completo de login.

## Próxima entrega necessária

Conectar cadastro/convite, entrega privada de e-mail, verificação de PIN e prova forte de administrador aos controles persistentes, com emissão transacional/recuperável de sessão, bootstrap de uso único, CSRF e interface real. As configurações atuais devem continuar fechadas até essa homologação.
