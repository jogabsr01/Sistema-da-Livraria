# Schema Workspace v1

A fonte de verdade dos cabeçalhos/constraints de projeto é [workspace-v1.json](workspace-v1.json). `npm run schema:generate` gera `google-apps-script/Schema.gs`; a suíte verifica que o arquivo gerado corresponde ao JSON sem regenerá-lo durante o teste.

Inclui as 14 abas solicitadas e três estruturas auxiliares justificadas na arquitetura. Os índices de CPF/e-mail e hashes de sessão são campos adicionais de segurança. O JSON declara chaves e regras; isso não instala constraints nativas no Sheets. As validações transacionais de negócio são da Fase B e a proteção de identidade da Fase C.

A migração inicial preserva abas desconhecidas e falha em cabeçalhos incompatíveis. Não importa clientes/vendas, não cria usuários administrativos e não armazena PINs. Campos de identidade, CPF/CEP/telefone/horário e timestamps recebem formato textual para preservar sua representação. Isso não substitui neutralização de fórmulas em futuras escritas.
