# Clientes e Caixa identificado — DEV

Incremento a partir de `dev/26268992dc3032deab5f4673e4433a144a549b81` (equipe, PR #21). Não ativa Google, não altera a home nem `main`.

## Atendimento

O Caixa apresenta duas escolhas explícitas quando a funcionalidade está habilitada: **Finalizar compra sem cadastro** (padrão) e **Identificar ou cadastrar cliente**. CPF é consultado somente após ação do operador, por POST com sessão/CSRF; não aparece em URL/query string. Um resultado encontrado precisa ser selecionado explicitamente antes da venda. Sem identificação, nenhum dado pessoal é exigido.

Cadastro: nome e CPF válido; e-mail, celular e endereço opcionais, incluindo CEP preenchido manualmente. O incremento posterior documentado em [CEP_BRASILAPI_DEV.md](CEP_BRASILAPI_DEV.md) acrescenta consulta opcional à BrasilAPI, explicitamente autorizada pelo proprietário; somente ao clique e com envio apenas do CEP. O preenchimento manual permanece.

O cadastro aceita preferência `NONE`, `WHATSAPP` ou `EMAIL` e autorização promocional explícita, inicialmente desmarcada. Telefone não implica consentimento; autorização exige canal compatível com contato válido e não condiciona a compra. Datas de concessão/alteração/revogação são registradas no servidor. Não há mensagens automáticas ou compras externas.

Cliente existente pode ser atualizado com revisão esperada; CPF fica preservado e mascarado. Alterações conflitantes e cadastros duplicados são recusados. O operador recebe apenas os campos necessários ao atendimento; não existe listagem pública ou busca global de clientes neste incremento.

Ao iniciar outra compra ou mudar para modo anônimo, a seleção, busca e formulários são limpos. O carrinho não herda CPF, nome ou contatos da compra anterior. Enquanto uma gravação de cliente está incerta, o diálogo bloqueia alteração/fechamento e repete o mesmo comando em memória; nenhum cadastro pessoal é colocado em localStorage/sessionStorage.

## Persistência e acesso

As permissões `customers.read`/`customers.write` pertencem aos três papéis operacionais. A sessão é validada novamente em GAS sob ScriptLock. ADMIN/SUPER_ADMIN continuam exigindo autenticação forte; dados não são autorizados por ocultação de interface.

Dados do cliente usam o mesmo cofre AES-256-GCM da equipe, com domínio de entidade `customers`. Contato completo cifrado em `Clientes.Nome`; campos pessoais individuais permanecem vazios. `CPF_Indice` usa HMAC com domínio `customer.cpf`, separado dos índices de funcionários. Não editar essas células manualmente. As duas chaves privadas de dados/índice ficam somente no backend, nunca no Apps Script ou frontend.

Preferência, consentimento, datas e identificador técnico permanecem em campos específicos. Metadados de revisão e intenções recuperáveis ficam em Configuracoes (`customer.revision.<ID>` / `customer.command.<UUID>`). Antes/depois contêm contato cifrado. Motivos de erro/logs de alteração não contêm CPF/nome/contato/endereço; leitura de cliente também gera auditoria por ID e resultado.

Intenção durável precede cliente, revisão, auditoria e marcador final. Reenvio usa fingerprint HMAC estável com cifra nova, sem criar outro cliente/log. Busca/consulta e venda identificada recuperam alterações interrompidas antes da leitura. Limites: 1.000 comandos de clientes; tabelas/configurações/logs compartilhados até 5.000, com recusa de capacidade. Retenção/compactação/anonimização administrativa continuam pendentes do v17; não apagar linhas para contornar limites.

Este incremento também reforça uma garantia da equipe: intenções já gravadas de desativação são recuperadas durante a leitura de sessão mesmo se a flag de gestão de equipe for desligada depois da falha. Flag de interface não suspende uma revogação já comprometida.

## Vendas identificadas

PIX, dinheiro, débito e crédito compartilham o mesmo controle de preço, ScriptLock, estoque e idempotência de vendas anônimas. O backend exige cliente existente, calcula preço/total e não aceita dados pessoais ou preços do navegador dentro do comando da venda.

Eventos v2 anônimos e v1 antigos continuam válidos. Eventos v3 de venda identificada vinculam apenas `customerId`; não copiam CPF, contato ou endereço para o diário. Projeções de Vendas/auditoria preservam o vínculo. `Ultima_Compra` é derivada dos eventos e recuperável, sem alterar a revisão do cadastro ou sobrescrever edições de contato posteriores.

A referência de compra pendente em sessionStorage contém somente chave de idempotência, IDs técnicos de cliente/produtos, quantidades, pagamento e total esperado. O ID de cliente é pseudônimo e ainda exige proteção, mas não permite consulta sem sessão/CSRF; nome/CPF/contatos/endereço nunca são gravados nessa referência. Ao recarregar, o Caixa identifica a compra pendente sem carregar os dados pessoais. Ela é isolada por usuário técnico e removida após confirmação.

`WORKSPACE_CUSTOMERS_ENABLED=false` impede novas vendas identificadas. Uma referência de uma venda já comprometida ainda pode recuperar sua confirmação usando o RPC somente de recibo: não registra outra venda e não ignora a flag para novos comandos. A opção anônima continua independente. A integração Google real e o aceite com múltiplos aparelhos seguem para a etapa posterior.

## API e ativação futura

- `POST /api/v1/customers/find` `{cpf}`: consulta exata, retorno mascarado ou nulo.
- `POST /api/v1/customers/get` `{id}`: cadastro autorizado, sem CPF integral.
- `POST /api/v1/customers/save` `{commandId,id,expectedRevision,record}`. Em edição, `record.cpf=""` preserva a identidade.
- `POST /api/v1/checkout` mantém o contrato anterior; `customerId` pode ser nulo ou UUID de cliente.
- RPCs privados assinados `customers.find/get/save` e `sales.receipt`; este último só retorna um evento existente do próprio operador e com o mesmo comando integral, depois da recuperação.

Flags novas, desligadas por padrão: Netlify DEV `WORKSPACE_CUSTOMERS_ENABLED`; Apps Script DEV `CUSTOMERS_ENABLED`. Dependem do backend/sessões e, para vendas, catálogo/Caixa existentes. Configurar as chaves do cofre se ainda não existirem; preservá-las se já houver dados. Atualizar o lote completo, incluindo **Customers.gs** e **Staff.gs**; sem nova aba, migração ou escopo OAuth. Só homologar e ativar na etapa Google autorizada pelo proprietário.

Ainda pendentes: histórico comercial/perfil de compra, recomendações, mensagens preparadas com autorização, consultas/recibos operacionais e ajustes/estornos, conforme STATUS_V17. Este incremento não declara essas funções concluídas.
