# Situação e sequência de execução do prompt mestre V17

Os testes acompanham a implementação; o diagnóstico Google não representa a conclusão do sistema. Este registro distingue código em revisão, evidência real do proprietário e funcionalidades ainda indisponíveis.

| Fase do V17 | Estado verificável | O que falta para concluir |
| --- | --- | --- |
| A — Fundação | Modelo de 17 abas, provisionamento DEV, assinatura entre servidores e build isolado integrados no PR #9. Proprietário confirmou schema v1/17 tabelas e GOOGLE_DEV_CONNECTION_OK no Netlify DEV. | Homologação futura de backups/restauração e identidade/IAM; PROD não foi provisionada. |
| B — Persistência compartilhada | Núcleo de vendas idempotentes e recuperação de projeções testados localmente. Em revisão: catálogo autenticado DEV, gravação/edição Google com versão, journal recuperável, links de capas, nichos existentes e interface testada em duas sessões. | Homologação real/configuração privada; gestão de nichos, imagens privadas, consulta automática ISBN ligada ao módulo, escritores de clientes/estoque/vendas e sincronização offline. |
| C — Identidade e permissões | PRs #10–#13 integrados: credenciais, sessões/revogação, CSRF, perfis, limites duráveis, WebAuthn e primeiro acesso/login do proprietário com MailApp, PIN, bootstrap privado e commit recuperável. | Homologação no Google/aparelhos reais e configuração privada; proteção de tráfego/quota, retenção, recuperação/rotação, outros funcionários, CPF/perfil/avatar. |
| D — Gestão administrativa | Abas de dados desenhadas; a interface demonstrativa existente segue preservada. | Auditoria real e consulta autorizada, notificações compartilhadas, escalas com conflitos, nichos administráveis e relatórios integrados. |
| E — Experiência operacional | Regressão do protótipo e cenários de celular existentes preservados. | Checkout anônimo ligado ao backend, fila offline sem PII, sincronização, testes multiusuário/dispositivo e aceite final. |

## Ordem das próximas entregas

1. Concluir o acesso verificado: limites persistentes, convite/verificação, PIN, MFA/passkeys e ativação privada do master. O armazenamento de sessões desta entrega é uma parte desse fluxo, não o login final.
2. Ligar permissões e persistência por módulo: primeiro produtos/nichos/capas e sincronização, depois clientes/vendas/estoque com journal recuperável. Só confirmar vendas após resposta do servidor.
3. Auditoria, notificações, escalas e relatórios, reutilizando as políticas de acesso e os eventos reais.
4. Checkout sem cliente, recuperação offline, validação final em dois dispositivos e documentação de operação/backup.

Fases B e C têm dependências entre si: modelos e adaptadores podem ser desenvolvidos antes da identidade; rotas de negócio só serão liberadas com autorização completa. Não abrir cadastros reais para demonstrar progresso.

Cada entrega terá código, testes, limites explícitos e PR para dev. Nova aprovação é necessária antes de cada merge; as autorizações anteriores cobriram os PRs #9–#13; não autorizam novos merges. PR #13 integrado em dev no commit 1b7ca092a6283431de4b9c78c9e41e6afb1d774a, após corrigir uma instabilidade de timestamp na fixture de teste e repetir backend/Chromium. Main permanece em 365a80f0be90258c08f1e1cb42650f0c397902bb. Não se deve alterar as flags operacionais até revisar e combinar a homologação controlada.

Controles do próximo incremento: [CONTROLES_PRIMEIRO_ACESSO.md](CONTROLES_PRIMEIRO_ACESSO.md). Não executar mais configurações no Google/Netlify até concluir a revisão e o fluxo de identidade.

Passkeys: [PASSKEYS.md](PASSKEYS.md). Primeiro acesso/login e lote de configuração privada: [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md). Catálogo compartilhado em revisão: [CATALOGO_COMPARTILHADO_DEV.md](CATALOGO_COMPARTILHADO_DEV.md). A conta master Google real ainda não foi criada/ativada. Acesso externo ao site DEV recebeu HTTP 401 na conferência anterior; não confundir merge GitHub com homologação do deploy real.
