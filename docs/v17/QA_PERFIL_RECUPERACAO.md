# QA de perfil e recuperação de PIN — 24/10/2026

Base DEV: `c5615eb754a0572d4d124f73613ab3eb56b9be2b`. Escopo e limites em [PERFIL_RECUPERACAO_DEV.md](PERFIL_RECUPERACAO_DEV.md).

## Evidências locais

- 234 contratos backend aprovados em Node 24.19.0 e 22.23.4. Dez grupos novos em `profile.test.mjs` e `recovery.test.mjs`; cada grupo de recuperação percorre falhas antes/depois das projeções. O caso adicional de recuperação de funcionário com flags desligadas foi executado novamente nas duas versões.
- 59 cenários Chromium afetados aprovados: acesso 6, equipe 6, perfil 5, catálogo 6, Caixa 10, estoque 5, notificações 7, clientes/CEP 8, operações 6.
- 37 cenários do build público aprovados com biblioteca ZXing 0.21.3 verificada, totalizando 96 cenários browser neste incremento.
- Build público, validação de sintaxe JS/Python e `git diff --check` aprovados. Kit privado de instalação gerado fora do repositório, conferido com os dois novos arquivos Apps Script e guia.
- Screenshot móvel `work/qa-profile/perfil-celular.png` inspecionada: cards, avatar/menu, formulário, ações de sessão e ausência de rolagem horizontal.

## Contratos críticos

Perfil: origem/CSRF, sessão forte recente, impossibilidade de definir outra conta/papel/CPF/e-mail, campos administrativos protegidos, contato cifrado, CPF mascarado, revisão concorrente com administração, foto JPEG 256×256 sem EXIF, pasta/arquivo privados, proxy próprio sem cache, remoção explícita e repetição sem duplicar foto. Falhas antes/depois de intenção, usuário, contato do proprietário, revisão, auditoria e marcador são recuperadas mesmo após desligar a flag.

Recuperação: e-mail vinculado mais passkey existente, resposta genérica para contas inelegíveis/envio falho, impossibilidade de registrar chave substituta usando apenas e-mail, fluxo vencido recusado, PIN antigo recusado e novo aceito, versão incrementada, sessões antigas negadas, uma única nova sessão/auditoria em reenvios. Falhas antes/depois de intenção, versão, PIN, chave, revogação, usuário, sessão nova, auditoria e marcador são exercitadas. Funcionário preserva papel e entrega no e-mail cadastrado ao localizar por CPF; recuperação já comprometida conclui mesmo com flags de equipe/recuperação desligadas.

Browser: assinaturas WebAuthn efetivas com autenticador virtual, troca de cookie, cookie antigo recusado, PIN antigo/novo, saída, revogação das outras sessões, reenvio da mesma carga após perda de resposta, atualização de nome/avatar no menu, layout móvel e ausência de dados em localStorage/sessionStorage. A regressão da equipe passou a aguardar o painel de conclusão antes de verificar o cookie, evitando observar texto antigo de uma sessão anterior; o painel também limpa esse texto ao sair.

## Limites

Google Sheets, Drive e MailApp são emulados com dados descartáveis; não há envio real de e-mail, alteração de conta ou flag privada. Provas de armazenamento dos contratos Node são fixtures explícitas; a suíte browser valida assinaturas separadamente. Autenticador virtual Chromium não comprova Safari, Android/iOS físicos, sincronização de passkeys nem cotas Google reais. Impressão e CEP das regressões permanecem emulados/interceptados.

Recuperação após perda de todas as passkeys, alteração autônoma de e-mail e gestão completa das credenciais continuam pendentes. Não há nova aba, escopo OAuth ou migração da estrutura v1. Não há limpeza automática das fotos substituídas. Publicar código DEV não conclui instalação Google, aceite em produção ou o Prompt Master v17.
