# Reconexão do perfil, e-mail e passkeys — DEV

Este lote protege o perfil próprio, a alteração verificada de e-mail, a gestão de passkeys/códigos de recuperação e o menu comum da conta. Sessão e requisições passam a ter timeout de 30 segundos, inclusive nas verificações de identidade. Respostas que atravessam uma mudança de conexão, visibilidade ou identidade não restauram dados privados.

## Perfil e foto

Novas gravações exigem consulta válida da mesma conta e papel. O perfil é conferido antes e depois da leitura; a validade local para novas alterações é de 90 segundos, com atualização periódica de leitura a cada 60 segundos quando possível. Foco, reconexão, retorno e restauração da página atualizam leituras, sem salvar automaticamente.

Queda, ocultação ou saída removem nome, e-mail, CPF, horário de acesso, iniciais e URL da foto exibidos. O formulário fica oculto, preservando o rascunho nos campos e a foto preparada em memória na mesma aba. Isso é ocultação visual, não apagamento dos valores do DOM. Recusa de acesso, outra conta ou papel diferente limpam também o formulário/foto local e ocultam a área privada. A página permanece vinculada à conta e papel originais; trocar de identidade exige uma nova abertura autenticada.

A conferência preserva alterações locais ainda não enviadas. Se a revisão atual mudou, salvar fica bloqueado até a ação explícita **Descartar rascunho e abrir versão atual**. O processamento de foto confere o contexto após decodificar; uma foto atrasada não restaura a prévia após invalidar a página.

O salvamento fixa commandId, revisão, telefone, nome quando autorizado e foto/remoção. Resposta perdida conserva esse pedido em memória. **Conferir perfil pendente**, fora da área privada, revalida a mesma conta antes de repetir o conteúdo original. Alterar os campos por script não substitui o pedido já fixado. Recusa posterior não descarta silenciosamente um pedido previamente incerto. Uma primeira rejeição semântica conclusiva libera os campos para correção.

Um salvamento confirmado continua salvo se falhar apenas a consulta seguinte. A falha de leitura não cria outro pedido de gravação. Encerrar outras sessões continua sendo uma ação explícita, com sessão e contexto conferidos antes do envio; não é repetida automaticamente ao reconectar e não possui a mesma referência de conferência do salvamento de perfil.

## Alteração verificada de e-mail

O módulo recebe a identidade original do perfil e confere a mesma conta/papel antes de cada pedido e antes de exibir o resultado. Invalidar o perfil também invalida sua interface de e-mail. Queda, ocultação ou saída limpam endereço digitado, campo do código e estado visual, mas conservam um pedido incerto em memória para conferência explícita. **Conferir pedido de e-mail** permanece fora da área privada quando o perfil é ocultado.

Início, confirmação e cancelamento repetem a operação e o conteúdo originais. No caso de confirmação incerta, o código permanece somente dentro do pedido em memória, sem voltar ao campo. Reconectar não envia outro código nem confirma a mudança. A leitura de estado retoma somente as etapas autorizadas pelo backend e não preenche endereço ou código. Prova recente, prazo de cinco minutos, limites de envio, código no novo endereço e revogação das outras sessões permanecem no servidor.

## Passkeys e códigos de recuperação

A lista e os fluxos ficam vinculados à conta/papel originais. Novas etapas exigem conferência válida; leitura manual ou retomada autorizada atualizam lista e estado. As operações preservam o pedido original quando a resposta se perde. **Conferir / tentar novamente**, fora da área privada, continua disponível após uma recusa de sessão. Reconectar não inicia cadastro, prova, remoção ou geração de códigos automaticamente.

Queda, ocultação ou saída removem lista, detalhes de confirmação, códigos exibidos e URLs temporárias de download. A confirmação do autenticador em andamento recebe cancelamento pelo AbortController. Mesmo que o navegador entregue uma credencial depois disso, a conferência de contexto impede enviar essa resposta ao backend. Repetir uma etapa incerta usa a mesma resposta serializada, sem gerar uma nova prova silenciosamente.

Depois de uma etapa confirmada, falha apenas ao ler a lista é apresentada como **Pedido confirmado**. Não se cria outra alteração por causa dessa leitura. A consulta de estado pode retomar um fluxo existente, mas não revela códigos automaticamente. Códigos removidos da tela exigem nova ação autorizada de conferência do fluxo. O prazo original de exibição de até cinco minutos continua sendo respeitado.

A última passkey continua protegida; remover exige outra chave. Recuperação sem passkeys continua dependendo de códigos preparados anteriormente e e-mail cadastrado acessível. Este lote não cria recuperação universal, rotação de segredos ou mudança de provas/contratos no backend.

## Menu comum da conta

O menu remove nome acessível, iniciais e avatar ao perder contexto. Ele confere a sessão antes e depois de ler o perfil e verifica a identidade novamente antes de iniciar logout. Resposta antiga não recria o menu. Retomada restaura somente a mesma conta/papel. Em falha de logout, a conferência seguinte é somente leitura; não há reenvio automático do POST.

## Limites e escopo

Não há nova persistência em localStorage/sessionStorage/IndexedDB, fila offline ou autosave. Rascunhos, provas e pedidos incertos ficam na memória da aba. Não há descarte automático por prazo de uma gravação incerta. **Mantenha a aba aberta enquanto houver pedido pendente.** O aviso de saída depende do navegador. Fechamento, recarga, limpeza ou troca de aparelho não garantem recuperar a referência local; retomada de um fluxo no backend depende da sessão e do prazo existentes. Isso não substitui backup.

A limpeza da tela e a revogação de URLs não apagam arquivos já baixados nem cancelam uma cópia de bytes já aceita pelo navegador. Não se promete remover códigos que o usuário já guardou externamente.

Somente controllers, HTML/CSS, testes, script de execução e documentação. Sem mudança de backend, schema, flag, segredo, dependência, instalação Google, home dos perfis ou produção. Publicação exclusiva DEV. O v17 permanece em andamento. [Validação](QA_RECONEXAO_CONTA.md).
