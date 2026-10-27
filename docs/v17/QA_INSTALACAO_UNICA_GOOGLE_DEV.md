# QA — instalação Google DEV com uma colagem

Data: 27/10/2026, America/Sao_Paulo. Nova opção de entrega para reduzir a cópia manual de 26 módulos. Não houve acesso ou alteração autenticada de Google/Netlify nesta sessão.

`instalacao-google-dev/CodigoUnico.gs.txt` reúne os mesmos 26 módulos de `google-apps-script`, sem minificação ou mudança de regras, com marcadores e hashes de cada fonte. O gerador não lê configuração privada nem chama serviços externos. O arquivo modular e a versão única são alternativas; não devem coexistir no mesmo projeto Apps Script. Manifesto, propriedades, IDs e URL existentes são preservados pelo procedimento.

Validações aprovadas:

- 364 testes completos de backend em Node 22.23.4 com `LIVRARIA_TEST_GAS_SOURCE=single`; os contratos que usam o emulador GAS carregam a versão única.
- 364 testes completos em Node 24.19.0 no modo modular padrão, preservando a alternativa anterior.
- Dois novos casos: geração atual/completa com compilação como script único e preparação retomável de schema/controles/proprietário/catálogo, preservando IDs e chave.
- Seis testes Python do kit, agora incluindo a alternativa única no ZIP e no manifesto.
- Build, verificação de geração atual e diff check aprovados. Arquivo único ausente de `dist/`.

São 364 casos distintos nos dois runtimes, não 728 funcionalidades. Não houve mudança de interface nem repetição de testes de navegador. A alteração do emulador afeta somente testes; `LIVRARIA_TEST_GAS_SOURCE` não é configuração de produção.

As verificações não comprovam instalação no editor Google, consentimento OAuth, IAM, quotas ou integração real. A orientação manual é remover somente scripts duplicados do editor, colar no script existente e conferir o schema antes de prosseguir. Não apagar propriedades, recursos do Drive ou implantação.
