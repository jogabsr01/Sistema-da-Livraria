# QA — preparação da instalação Google DEV

Data: 26/10/2026, America/Sao_Paulo. Escopo: kit de fontes Google, modelo de variáveis, preflight offline e atualização dos roteiros. Nenhuma configuração privada Google/Netlify foi alterada por este bloco.

## Resultados locais

- Backend completo: **362 testes aprovados** tanto no Node 22.23.4 quanto no Node 24.19.0, sem falhas, skips ou cancelamentos. São 362 casos distintos executados em dois runtimes, incluindo seis novos casos de configuração; não são 724 funcionalidades.
- Empacotamento: **seis testes Python aprovados**. Conferem inventário completo, bytes/hashes do manifesto, ausência de módulo ou módulo inesperado, fonte simbólica, destino dentro do repositório/simbólico, recusa de sobrescrita e rejeição de chave preenchida no modelo.
- Build aprovado; verificado que `dist/` não contém GAS, ZIP, `.env` ou manifesto privado do kit.
- Preflight no ambiente desta sessão: bloqueio esperado por falta de configuração privada, com `networkChecked: false` e `googleHomologated: false`. O relatório imprime nomes fixos de variáveis e códigos, sem seus valores.

Os seis novos casos Node cobrem fases de serviço/identidade/módulos sem mutação, contexto e bindings inválidos, flags e chaves malformadas/reutilizadas, dependências de identidade, desligamento do handshake após ativação, saída sem reflexão de valores e completude do modelo vazio.

Não houve alteração de interface neste bloco; testes de navegador não foram repetidos. Os cenários anteriores continuam documentados em seus respectivos relatórios.

## Limites e próximo aceite

O kit contém os 26 módulos GAS revisados, incluindo Maintenance.gs, e appsscript.json. Seu manifesto permite conferir o conteúdo; ele não atesta qual versão está implantada no Google. O preflight não lê Script Properties, não verifica IAM e não comprova que as chaves nos dois servidores coincidem.

Entrega de e-mail, consentimento OAuth, quotas, canal real Netlify→Google, passkeys em aparelhos físicos e restauração real permanecem sujeitos ao roteiro [HOMOLOGACAO_GOOGLE_DEV.md](HOMOLOGACAO_GOOGLE_DEV.md). Identificadores da instalação e endereço do proprietário não foram inseridos no pacote ou nos documentos públicos. Publicação PROD está fora do escopo.
