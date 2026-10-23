# Situação e sequência de execução do prompt mestre V17

Os testes acompanham a implementação; o diagnóstico Google não representa a conclusão do sistema. Este registro distingue código em revisão, evidência real do proprietário e funcionalidades ainda indisponíveis.

| Fase do V17 | Estado verificável | O que falta para concluir |
| --- | --- | --- |
| A — Fundação | Modelo de 17 abas, provisionamento DEV, assinatura entre servidores e build isolado integrados no PR #9. Proprietário confirmou schema v1/17 tabelas e GOOGLE_DEV_CONNECTION_OK no Netlify DEV. | Homologação futura de backups/restauração e identidade/IAM; PROD não foi provisionada. |
| B — Persistência compartilhada | Núcleo de vendas idempotentes e recuperação de projeções testados localmente. PR #14 integrado: catálogo autenticado DEV, gravação/edição Google com versão, journal recuperável, links de capas, nichos existentes e interface testada em duas sessões. | Homologação real/configuração privada; homologação das fotos privadas (PR #15 em revisão), consulta ISBN compartilhada integrada pelo PR #17, com flag fechada, gestão de nichos, escritores de clientes/estoque/vendas e sincronização offline. |
| C — Identidade e permissões | PRs #10–#13 integrados: credenciais, sessões/revogação, CSRF, perfis, limites duráveis, WebAuthn e primeiro acesso/login do proprietário com MailApp, PIN, bootstrap privado e commit recuperável. | Homologação no Google/aparelhos reais e configuração privada; proteção de tráfego/quota, retenção, recuperação/rotação, outros funcionários, CPF/perfil/avatar. |
| D — Gestão administrativa | Abas de dados desenhadas; a interface demonstrativa existente segue preservada. | Auditoria real e consulta autorizada, notificações compartilhadas, escalas com conflitos, nichos administráveis e relatórios integrados. |
| E — Experiência operacional | Regressão do protótipo e cenários de celular existentes preservados. | Checkout anônimo ligado ao backend, fila offline sem PII, sincronização, testes multiusuário/dispositivo e aceite final. |

## Ordem das próximas entregas

1. Concluir o acesso verificado: limites persistentes, convite/verificação, PIN, MFA/passkeys e ativação privada do master. O armazenamento de sessões desta entrega é uma parte desse fluxo, não o login final.
2. Ligar permissões e persistência por módulo: primeiro produtos/nichos/capas e sincronização, depois clientes/vendas/estoque com journal recuperável. Só confirmar vendas após resposta do servidor.
3. Auditoria, notificações, escalas e relatórios, reutilizando as políticas de acesso e os eventos reais.
4. Checkout sem cliente, recuperação offline, validação final em dois dispositivos e documentação de operação/backup.

Fases B e C têm dependências entre si: modelos e adaptadores podem ser desenvolvidos antes da identidade; rotas de negócio só serão liberadas com autorização completa. Não abrir cadastros reais para demonstrar progresso.

Cada entrega terá código, testes, limites explícitos e PR para dev. Nova aprovação é necessária antes de cada merge; as autorizações anteriores cobriram os PRs #9–#14 e #16; não autorizam novos merges. PR #14 integrado em dev no commit 5b6b57668f79ef377c89183a7262fef8005e3eba; PR #16 (isolamento do RPC/diagnóstico) integrado sob autorização no commit 96b80b4c2cd45ea4ae5b36fe709ab673fcdec91c. O PR #15 de fotos permanece em revisão. Main permanece em 365a80f0be90258c08f1e1cb42650f0c397902bb. Não se deve alterar as flags operacionais até revisar e combinar a homologação controlada.

Controles do próximo incremento: [CONTROLES_PRIMEIRO_ACESSO.md](CONTROLES_PRIMEIRO_ACESSO.md). Não executar mais configurações no Google/Netlify até concluir a revisão e o fluxo de identidade.

Passkeys: [PASSKEYS.md](PASSKEYS.md). Primeiro acesso/login e lote de configuração privada: [PRIMEIRO_ACESSO_OWNER.md](PRIMEIRO_ACESSO_OWNER.md). Catálogo compartilhado integrado: [CATALOGO_COMPARTILHADO_DEV.md](CATALOGO_COMPARTILHADO_DEV.md). A conta master Google real ainda não foi criada/ativada. Acesso externo ao site DEV recebeu HTTP 401 na conferência anterior; não confundir merge GitHub com homologação do deploy real.

Consulta ISBN e limitações reais das fontes/capas: [ISBN_COMPARTILHADO_DEV.md](ISBN_COMPARTILHADO_DEV.md). O incremento seguinte está em revisão, com flag fechada. As consultas públicas desta entrega não ativam o Google privado nem comprovam a publicação do branch deploy.

Rodada autorizada de aprofundamento/publicação do PR #17: [QA_CAPAS_HARDENING.md](QA_CAPAS_HARDENING.md). Cópia editorial real verificada, câmera/galeria do protótipo (código do PR #4) e salvamento demonstrativo com quota cheia corrigido. A autorização de publicar #17 substitui a pendência de aprovação descrita acima para esse PR; não autoriza main/produção nem a ativação Google.

PR #17 integrado exclusivamente em dev em c52babd132a6637c443e7bb0887cad827fd3742b após autorização e preview aprovado. PR #15 atualizado com esse dev para testar câmera/galeria privada em conjunto com ISBN; permanece em revisão, sem ativar Google real.
