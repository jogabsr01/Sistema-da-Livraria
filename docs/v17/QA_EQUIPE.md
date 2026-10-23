# QA — Equipe e acesso de funcionários

Evidências locais em 23/10/2026. Google Sheets/Drive/MailApp emulados; nenhuma conta real cadastrada ou mensagem real enviada.

- `npm test`: 205 cenários de backend, incluindo oito novos cenários agrupados de equipe.
- Node 24.19.0 e Node 22.23.4: mesma suíte completa.
- `python scripts/test-staff.py`: seis cenários Chromium. Cadastro, edição mantendo CPF, desativação, duplicidade/CPF inválido, exclusão de acesso por perfil, resposta perdida com reenvio do mesmo comando, desktop/celular, foco/Escape e nome com HTML tratado como texto.
- Primeiro acesso e login de atendente por CPF com assinaturas WebAuthn realmente produzidas pelo autenticador virtual do Chromium, sem fabricar provas no cenário browser.
- `python scripts/test-owner-access.py`: seis regressões do proprietário, PIN errado, assinatura adulterada e recuperação de commit.
- Regressões dos módulos compartilhados: catálogo (6), Caixa (10), estoque (5), notificações (7).
- Build público, sintaxe JavaScript e `git diff --check`.

Backend testa isolamento criptográfico entre entidade/ID/ambiente, IVs distintos, adulteração, índices HMAC separados e recusa de chaves reutilizadas; unicidade de CPF/e-mail, conta proprietária protegida, alvo administrativo resolvido no servidor, reautenticação recente, CSRF/origem/stream limitado, dados cifrados na persistência e CPF mascarado no retorno.

Injeção de falhas antes e depois de seis fases da mudança (intenção, versão de autorização, usuário, revisão, auditoria e marcador final). A leitura de sessão recupera a mudança pendente e recusa a sessão desativada; reenvios não duplicam auditoria/cadastro. Mudança de perfil exige novo e-mail/PIN/passkey e não reutiliza a credencial antiga. Reenvio de uma edição com CPF em branco conserva a semântica do comando.

Limitações: não valida IAM, quotas/entrega MailApp, domínio real, backup/restauração, proteção de tráfego, Safari, biometria ou passkeys físicas. Captura móvel em `work/qa-staff/equipe-celular.png`, inspecionada visualmente. Sem rolagem horizontal da página a 390 px; modal e botões operáveis por teclado. Testes browser usam apenas dados fictícios e serviços locais descartáveis.
