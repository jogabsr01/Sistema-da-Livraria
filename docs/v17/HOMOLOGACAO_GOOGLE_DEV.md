# Homologação Google DEV — roteiro e evidências

Estado do aceite integrado: **pendente**. Há evidência parcial de inspeção, atualização da implantação e handshake real; a autenticação e os módulos ainda exigem homologação. Ver [cenários detalhados e ocorrências](CENARIOS_TESTE_GOOGLE_DEV.md). Código integrado, testes locais ou geração do kit não aprovam este roteiro. Executar somente na instalação DEV identificada pelo proprietário, usando dados de teste sem informações pessoais reais desnecessárias. Não registrar chaves, PINs, códigos de e-mail/resgate, cookies ou tokens nas evidências.

Para cada linha, registrar: responsável, data/hora em America/Sao_Paulo, versão Apps Script, commit DEV, resultado esperado/observado e referência privada da evidência. Usar `pendente`, `aprovado` ou `reprovado`; não preencher como aprovado sem execução.

| Bloco | Critério de aceite real | Estado inicial |
| --- | --- | --- |
| Ambiente e IAM | Projeto/conta/recursos DEV conferidos; permissões privadas e heranças revisadas; nenhum recurso PROD vinculado | pendente |
| Versão | Lote GAS completo, incluindo Maintenance.gs, manifest e versão /exec conferidos contra o kit; dados/IDs preservados | pendente |
| Canal assinado | Build DEV confirma handshake com backend operacional desligado; assinatura inválida/replay não liberam operação; sem valores privados em logs | pendente |
| Primeiro acesso | Conta proprietária recebe e-mail, define PIN e registra passkey; acesso posterior e logout funcionam | pendente |
| Perfis | Funcionário é impedido de executar ações administrativas; sessão revogada/expirada não continua vendendo | pendente |
| Dispositivos | Fluxos de passkey e recuperação verificados em dois aparelhos/navegadores reais compatíveis | pendente |
| Catálogo | Criar/editar livro, capa e nichos; duas sessões enxergam alterações sem duplicação | pendente |
| Estoque zero | Livro sem estoque continua editável, venda é recusada; reposição aumenta unidades no mesmo ID; somente administrador pode excluir logicamente | pendente |
| Reposição | Alerta permite relatório de todos os esgotados com título e fornecedor; leitura individual e histórico conferidos | pendente |
| Caixa | Venda baixa estoque uma vez; reenvio não duplica venda; concorrência pela última unidade não gera estoque negativo | pendente |
| Clientes/equipe | Cadastro, permissões, consentimentos e dados pessoais protegidos; edição não altera identidade/histórico indevidamente | pendente |
| Operações | Ajustes e cancelamento conforme permissões e efeitos de estoque; nenhuma cobrança/estorno bancário presumido | pendente |
| Perfil e recuperação | Perfil, troca verificada de e-mail, recuperação de PIN e gestão de passkeys preservam controles; última chave protegida | pendente |
| Emergência | Códigos guardados fora do aparelho, uso único + e-mail + nova passkey; repetição recusada e sessões antigas revogadas | pendente |
| Relatórios/auditoria | Consulta e exportação administrativa com autenticação recente; filtros e totais conferidos; CPF/segredos ausentes do Excel | pendente |
| Escalas/contatos | Destinatários e datas corretos; preparo de mensagem respeita consentimento e não envia automaticamente | pendente |
| Backup | Backup real concluído com integridade e IAM privados; chave de backup e chaves de backend sob custódia externa | pendente |
| Restauração | Restaurar em cópia isolada e inspecionar dados/assets/schema; registrar tempo e ponto recuperado sem promover sobre a ativa | pendente |
| Reconciliação | Operação revisada conclui journals pendentes sem duplicar estoque/vendas; reexecução idempotente | pendente |
| Recuperação privilegiada | Ensaio em instalação descartável DEV com conta Google proprietária, referência de caso, novo acesso e revogação dos anteriores | pendente |
| Rotação HMAC | Ensaio planejado com pausa, backup, chave independente e atualização privada do backend; retomar e provar canal | pendente |
| Quotas | Medir duração, volume de Drive/Sheets, entrega de e-mail e limites com carga representativa; falha não vira sucesso parcial | pendente |

## Política operacional a registrar

Definir responsável pela custódia do cofre e recuperação da conta Google, frequência dos backups, tempo máximo de perda aceitável (RPO), tempo de recuperação (RTO), retenção e capacidade. Comparar objetivos com tempos medidos da restauração. O roteiro não assume valores ou ativa agendamento sem essa definição.

Compactação técnica exige cutoff explícito com mínimo de 30 dias e backup prévio. Histórico comercial e auditoria permanecem preservados. Não há política automática de exclusão de clientes/backups habilitada por este documento.

A perda simultânea da conta Google e do cofre não é resolvida pelo fluxo de recuperação da aplicação. Referências privadas dos recursos e chaves devem ficar sob custódia do responsável, fora do repositório.

## Encerramento

Registrar falhas, correções e nova evidência apenas nos blocos afetados. Concluir o aceite DEV quando os blocos aplicáveis estiverem aprovados e as exceções explicitamente registradas pelo responsável. Pendências de integração não podem ser substituídas por contagem de testes simulados. Publicação PROD e promoção de restauração são decisões separadas.
