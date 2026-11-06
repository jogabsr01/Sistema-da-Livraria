# Fase B: primeiro incremento — comandos de venda

Esta branch depende da fundação do PR #5, ainda não integrado. O PR aponta exclusivamente para dev; nenhuma integração automática é autorizada. Esta entrega não conclui a fase B.

`backend/sale-command.mjs` implementa a regra de venda independente de transporte: normalização de itens, preço obtido exclusivamente do repositório, valores inteiros em centavos, estoque suficiente, identificação do operador e chave de idempotência. Repetir a mesma compra retorna o recibo original; reutilizar a chave com outro conteúdo ou operador é recusado.

O contrato de persistência exige lock global para todos os escritores, diário durável antes das projeções e recuperação das projeções pendentes antes de cada decisão de estoque. O recibo usa a chave UUID da compra como ID da venda. A aplicação das projeções exige checkpoints de versão e deve suportar interrupção entre cada escrita. O núcleo não fornece autenticação: `actor` deve vir exclusivamente do backend autenticado, nunca do corpo HTTP.

## Evidência e limites

Seis testes novos usam um repositório descartável em memória, com fila exclusiva e interrupção controlada. Cobrem concorrência pela última unidade, repetição, conflito de operador/conteúdo, recuperação após append, preço não confiável, quantidade inválida, produto ausente e overflow. Não comprovam LockService real, durabilidade do Sheets ou recuperação entre processos.

Não existe endpoint de venda novo, adaptador de vendas Google, migração de vendas reais ou ligação ao Caixa nesta entrega. O frontend permanece idêntico. Não habilitar o backend: a identidade real ainda está fechada. Nenhum usuário master foi criado e nenhum dado pessoal recebido pelo chat foi salvo nesta implementação.

## Próximas entregas

1. Adaptador Apps Script de diário e projeções, com recuperação e conflitos de versão testados em recursos DEV descartáveis.
2. Produtos, nichos e imagens privadas; autorização de operações por perfil.
3. Identidade verificada e bootstrap privado do master, antes de ligar endpoints ao aplicativo.
4. Integração visual e homologação multiusuário em DEV, após autorização Google.

## Google: como entregar os recursos

Não é necessário anexar documentos Google ou exportar a planilha para iniciar a instalação. O sistema precisa de Sheets para dados e Drive para arquivos; documentos de requisitos podem ser exportados em PDF e anexados separadamente, sem credenciais ou dados de clientes.

O responsável deve abrir https://script.google.com/ usando a conta dedicada de DEV e seguir [INSTALACAO_GOOGLE.md](INSTALACAO_GOOGLE.md). O provisionamento cria os arquivos privados, evitando a necessidade de compartilhar pastas com uma identidade de assistente inexistente. Não tornar arquivos públicos.

Depois do provisionamento, pode informar somente o status da execução, o ID da planilha DEV, o ID da pasta DEV e a URL da implantação Apps Script. Isso permite conferir a configuração, mas não concede acesso por si só. PIN, chave de assinatura, tokens, senha e JSON de credenciais devem permanecer fora do chat, cadastrados diretamente nas configurações privadas descritas no guia. Não enviar telas que mostrem seus valores.

A autorização OAuth será concedida pelo proprietário no Google, após revisar os escopos. Não há conector Google disponível nesta sessão e nenhuma autorização foi executada em seu nome. O backend deve continuar desativado até a integração e a identidade passarem nos testes reais.

A conta master solicitada permanece pendente de verificação de identidade e fluxo de ativação seguro. O PIN compartilhado no chat não será usado como credencial inicial; cadastrar um novo PIN privadamente quando o fluxo estiver disponível.
