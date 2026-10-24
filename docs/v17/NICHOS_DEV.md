# Nichos administráveis — DEV

`nichos-dev.html` implementa Administração → Nichos: criar, renomear, descrever, escolher cor, imagem de fundo, ordem, ativar/desativar. ADMIN/SUPER_ADMIN precisam de sessão forte recente (até cinco minutos); a regra é validada também no Apps Script sob o lock. Atendentes leem nichos no catálogo/Caixa e podem associar livros aos ativos, sem gerir o cadastro.

A Frente de Caixa mostra cards dos nichos ativos na ordem definida e filtra livros sem alterar o carrinho. Cada livro pode pertencer a até vinte nichos, escolhidos por seleção múltipla a partir do cadastro. Não há digitação livre. O catálogo e o Caixa atualizam metadados ao foco, visibilidade e a cada minuto quando visíveis; consultas em curso são limitadas. A leitura agrupa vínculos e versões em lote, sem uma consulta à planilha por card.

## Desativação e histórico

Não existe operação de exclusão definitiva. Desativar retira o nicho dos cards e de novas associações; não apaga livros nem vínculos. Livros já associados continuam editáveis, inclusive quando o único nicho estiver desativado. O formulário mostra os vínculos desativados existentes e permite mantê-los ou removê-los conscientemente, preservando a exigência de pelo menos um nicho por livro. O servidor recusa acrescentar um nicho desativado que ainda não pertencia ao produto. Reativação reutiliza o mesmo ID.

Nome obrigatório de até 100 caracteres, descrição até 1.000, cor hexadecimal e ordem inteira de 0 a 9.999. Nomes duplicados (ignorando caixa, acentos e espaços repetidos) são recusados, também entre desativados. Limite total de 200 nichos, incluindo inativos. Esses limites evitam catálogo ambíguo e mantêm o processamento Apps Script limitado.

## Imagens

JPEG/PNG/WebP são preparados no navegador e reprocessados no servidor em JPEG 768×384, sem metadados. Seleção até 8 MB e 24 milhões de pixels, entrada do backend até 64 KiB, imagem final até 48 KiB; imagens excessivas são recusadas. A pasta privada `covers` original é reutilizada com marcador distinto `niche-image`, ligado ao nicho/comando/hash. Não aceita Drive ID ou URL de imagem escolhido pelo navegador. `/api/v1/niches/image` entrega somente arquivo validado a sessão autenticada, `private, no-store`; nicho desativado exige perfil administrativo para imagem. Nenhum link Drive público é criado.

Omitir imagem em uma edição preserva a anterior. `image:null` remove a referência explicitamente; arquivos antigos permanecem privados até política de retenção posterior. Nome determinístico de arquivo permite reutilização em repetições sem duplicar upload. A imagem de um nicho não pode servir como imagem de outro por trocar a referência: marcador e hash são verificados.

## Persistência e operação

Reutiliza `Nichos`, `Produto_Nichos`, `Configuracoes` e `Logs_Auditoria`, sem nova aba ou migração. `niche.revision.<id>` registra revisão (cadastros anteriores começam em zero) e `niche.command.<UUID>` guarda intenção íntegra com snapshots anterior/posterior. Repetição do mesmo comando/ator/carga devolve a mesma revisão; outra carga, ator ou revisão conflita. Intenção precede a projeção de nicho, revisão, auditoria e marcador; leituras de sessão recuperam intenções mesmo com a flag de nichos desligada. Nenhum saldo de estoque, preço ou vínculo é regravado para editar o nicho.

Auditoria NICHE_CREATE/NICHE_UPDATE registra ator, revisões, nome, cor, ordem, situação e indicadores de mudança de imagem/descrição; o journal mantém o histórico completo da descrição e referência privada. Limites de capacidade: até 1.000 comandos de nichos, limites comuns de 5.000 linhas para configurações/auditoria. Ao atingir capacidade, novas alterações falham sem sobrescrever histórico. Retenção/compactação e restauração real continuam pendentes.

A interface mantém comando incerto somente em memória, bloqueia alteração/fechamento do editor e permite repetir a mesma carga. Nenhum dado de nicho ou imagem é colocado em localStorage/IndexedDB. Fechar a página pode perder a confirmação; consultar novamente mostra o estado autoritativo e a revisão evita sobrescrita. Falha de autenticação pede nova confirmação de acesso.

Flags independentes `WORKSPACE_NICHES_ENABLED` / `NICHES_ENABLED`, fechadas por padrão. Requer catálogo/sessões provisionados. Atualizar o lote completo `.gs`, incluindo `Niches.gs`; o leitor de sessões e o catálogo usam suas funções. Sem chave, escopo ou recurso Google novo. A pasta `COVERS_FOLDER_ID` existente deve manter marcador e compartilhamento privados. Desligar flags não desfaz dados/vínculos já confirmados; recuperação de intenções continua necessária.

Este lote publica código DEV. Não ativa propriedades, Google ou produção. Escalas, outras notificações, relatórios e demais pendências continuam em [STATUS_V17.md](STATUS_V17.md). QA em [QA_NICHOS.md](QA_NICHOS.md).
