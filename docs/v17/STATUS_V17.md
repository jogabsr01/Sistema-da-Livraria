# Situação e sequência de execução do prompt mestre V17

Os testes acompanham a implementação; o diagnóstico Google não representa a conclusão do sistema. Este registro distingue código em revisão, evidência real do proprietário e funcionalidades ainda indisponíveis.

| Fase do V17 | Estado verificável | O que falta para concluir |
| --- | --- | --- |
| A — Fundação | Modelo de 17 abas, provisionamento DEV, assinatura entre servidores e build isolado integrados no PR #9. Proprietário confirmou schema v1/17 tabelas e GOOGLE_DEV_CONNECTION_OK no Netlify DEV. | Homologação futura de backups/restauração e identidade/IAM; PROD não foi provisionada. |
| B — Persistência compartilhada | Núcleo de vendas idempotentes e recuperação de projeções implementados/testados localmente. | Escritores Google de produtos/nichos/clientes/vendas, imagens privadas, controle de versões e sincronização entre dispositivos, ligados à interface. |
| C — Identidade e permissões | Criptografia de PIN/tokens integrada. Novo incremento em revisão: leitura/revogação de sessões persistentes, cookies, CSRF e política de perfis. | Primeiro acesso verificado, limites persistentes, MFA/passkeys, emissor de sessão, bootstrap do master, recuperação, usuários/perfil/avatar e homologação real. |
| D — Gestão administrativa | Abas de dados desenhadas; a interface demonstrativa existente segue preservada. | Auditoria real e consulta autorizada, notificações compartilhadas, escalas com conflitos, nichos administráveis e relatórios integrados. |
| E — Experiência operacional | Regressão do protótipo e cenários de celular existentes preservados. | Checkout anônimo ligado ao backend, fila offline sem PII, sincronização, testes multiusuário/dispositivo e aceite final. |

## Ordem das próximas entregas

1. Concluir o acesso verificado: limites persistentes, convite/verificação, PIN, MFA/passkeys e ativação privada do master. O armazenamento de sessões desta entrega é uma parte desse fluxo, não o login final.
2. Ligar permissões e persistência por módulo: primeiro produtos/nichos/capas e sincronização, depois clientes/vendas/estoque com journal recuperável. Só confirmar vendas após resposta do servidor.
3. Auditoria, notificações, escalas e relatórios, reutilizando as políticas de acesso e os eventos reais.
4. Checkout sem cliente, recuperação offline, validação final em dois dispositivos e documentação de operação/backup.

Fases B e C têm dependências entre si: modelos e adaptadores podem ser desenvolvidos antes da identidade; rotas de negócio só serão liberadas com autorização completa. Não abrir cadastros reais para demonstrar progresso.

Cada entrega terá código, testes, limites explícitos e PR para dev. Nova aprovação é necessária antes de cada merge; a autorização anterior cobriu somente o PR #9. Main e produção não fazem parte da integração atual. Não se deve alterar as flags operacionais até o aceite dos fluxos reais.
