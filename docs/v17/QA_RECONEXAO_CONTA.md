# QA — reconexão da conta

Validação local em 26/10/2026 (America/Sao_Paulo), dados descartáveis, Google/Sheets/Drive/MailApp emulados e autenticadores virtuais Chromium. Nenhuma credencial, mensagem, conta Google ou código de recuperação real foi usado.

## Backend completo

**332 testes aprovados em cada versão Node 22.23.4 e Node 24.19.0**, sem falhas, cancelamentos ou testes ignorados. São os mesmos 332 casos em dois runtimes. Comando: `node --test --test-concurrency=2 --test-reporter=tap tests/backend/*.test.mjs`. Logs locais: `work/account-reconnection-full22.log` e `work/account-reconnection-full24.log`.

O build Netlify permanece `npm test && npm run build`, incluindo todos os arquivos `tests/backend/*.test.mjs`. Não houve remoção de testes. As contagens de navegador abaixo são deste bloco e das regressões selecionadas; não representam todos os fluxos de navegador do sistema.

## Navegador: 58 cenários únicos aprovados

| Grupo | Casos |
| --- | ---: |
| Reconexão do perfil | 10 |
| Reconexão da alteração de e-mail | 6 |
| Reconexão de passkeys/códigos | 9 |
| Regressões do perfil | 5 |
| Regressões de e-mail | 5 |
| Regressões da gestão de passkeys | 6 |
| Regressões da recuperação emergencial | 5 |
| Regressões de equipe | 6 |
| Regressões de escalas | 6 |

Novos cenários em `scripts/test-account-reconnection.py`:

- Perfil: rascunho oculto offline com identidade/menu removidos; conteúdo original no replay; sessão expirada limpa dados e mantém pendência; outra conta bloqueada; salvamento conhecido com leitura posterior falha; revisão concorrente exige descarte explícito; saída/retorno preservam pedido; foto atrasada descartada; validade de 90 segundos; celular sem overflow.
- E-mail: início repetido sem duplicar entrega; confirmação incerta repete o mesmo código/pedido; sessão expirada conserva apenas a referência na interface genérica; outra conta bloqueada; saída limpa campos sem descartar pedido; offline impede novo envio.
- Passkeys/códigos: início incerto repetido sem nova chave; prova incerta sobrevive à saída da mesma aba; sessão expirada conserva a conferência externa; outra conta bloqueada; credencial recebida após queda não gera POST de prova; códigos removidos offline não reaparecem automaticamente; conclusão conhecida com lista indisponível não duplica chave; validade de 90 segundos bloqueia novo início; celular sem códigos expostos após queda.

As regressões preservam perfil/foto atualizando o menu, remoção explícita de foto, recuperação de PIN com assinatura real e cookie anterior revogado, encerramento de outras sessões, alteração de e-mail com prova/código e login pelo novo endereço, conflitos, fluxos retomados sem dados pessoais no armazenamento, cadastro/remoção com dois autenticadores, última chave protegida, limites e provas adulteradas recusadas. Recuperação emergencial cobre download, código de uso único, nova chave, lista substituída, prazo de exibição e código inválido. Equipe e escalas exercitam o menu comum, permissões e fluxos existentes.

As 25 verificações novas foram aprovadas por caso: 22 na execução inicial e três após corrigir a sincronização/fixture dos testes. Duas verificações aguardavam indevidamente um botão habilitado enquanto offline; passaram a observar a resposta protegida/retomada. A confirmação incerta de e-mail passou a aguardar o término do pedido, pois o perfil já podia mostrar o novo e-mail antes do replay terminar. A fixture de credencial atrasada usa polling pelo protocolo do navegador, preservando o CSP sem unsafe-eval. As verificações de conteúdo original, ausência de POST indevido e efeito único foram mantidas.

Após vincular o módulo de e-mail explicitamente à identidade original do perfil, os seis novos casos de e-mail e as cinco regressões foram executados novamente e aprovados. Os números da tabela contam cada cenário uma vez, sem somar repetições. Logs ficam em `work/account-reconnection-*.log`, ignorados.

Sinais de rede/visibilidade, conta alternativa, negativas de sessão e respostas retidas são fixtures. A resposta perdida ocorre depois de o backend descartável executar a operação. A credencial atrasada contém assinatura WebAuthn real do autenticador virtual, retida antes do envio. Não é teste com biometria, dispositivo físico ou instalação Google real.

Build final, sintaxe JS, AST Python e diff check aprovados. Capturas de celular em `work/qa-account-reconnection/` inspecionadas. Integração somente DEV exige preview aprovado no head exato. Main/PROD, segredos e instalação Google permanecem preservados; estes testes não encerram a homologação do v17.
