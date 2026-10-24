# QA de nichos — 23/10/2026 (São Paulo)

Base DEV `db6c5005a2f44e017a8b732cdf9252000dd7030f`. [Contrato e limites](NICHOS_DEV.md).

248 contratos backend aprovados em Node 24.19.0 e 22.23.4. Os cinco grupos novos de nichos foram reexecutados nas duas versões após o ajuste final de auditoria e conferência de vínculo da imagem; catálogo/nichos também reexecutados após agrupar as leituras de metadados. Build, sintaxe JS/Python e diff check aprovados. Kit de instalação inclui `Niches.gs` e guia, sem configuração privada.

47 cenários browser afetados aprovados: nichos 5, catálogo 6, Caixa 10, estoque 5, notificações 7, clientes/CEP 8, operações 6. Screenshot `work/qa-niches/nichos-caixa-celular.png` inspecionada: cards, fundo, filtro, estoque zero sem venda e ausência de rolagem horizontal.

## Casos críticos

- Criar/editar/desativar com ID estável; vínculos e livros preservados; livro com nicho desativado continua editável, enquanto associação nova ao mesmo nicho é recusada. Seleção múltipla preservada no editor.
- Nome duplicado por caixa/acentos, revisão concorrente, outro ator e reutilização de comando com carga diferente recusados. Mesma carga repetida não duplica nicho/auditoria.
- Falhas antes/depois de intenção, linha do nicho, revisão, auditoria e marcador são recuperadas antes de aceitar leituras mesmo com a flag desligada.
- Imagem 768×384 sem EXIF, pasta/arquivo privados, proxy autenticado e sem cache; tornar arquivo público ou apontar para a imagem de outro nicho falha. Repetição não duplica arquivo, edição só de metadados preserva imagem, remoção explícita mantém original privado.
- Atendente não gere nichos, sessão administrativa antiga exige reautenticação; origem/CSRF, campos extras/forjados, cor inválida, corpo excessivo e flags fechadas recusados.
- Browser cobre criação, fundo, ordem, filtro no Caixa, múltiplas seleções, desativação com edição do livro, atualização por foco após outra aba e resposta perdida com repetição exata. Não persiste nichos/imagens em localStorage. Sem erros de página nos cenários.

Google Sheets/Drive, CEP e pagamentos são emulados. WebAuthn usa assinaturas de autenticador virtual nos fluxos de entrada dos testes. Não comprova hardware, IAM, quotas reais, impressão física ou ativação Google. Não há cobrança/reembolso bancário. Nenhuma flag ou instalação real alterada. Retenção/restauração real, escalas e demais pendências continuam abertas; o v17 não terminou.
