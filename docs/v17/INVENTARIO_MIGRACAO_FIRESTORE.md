# Etapa 1 — inventário e extração somente de leitura

## Estado e objetivo

O estado por ambiente e evidência está em [MATRIZ_STATUS_MIGRACAO.md](MATRIZ_STATUS_MIGRACAO.md). A conclusão dos testes sintéticos não equivale à conclusão da extração real ou do cutover.

O script `scripts/inventory-sheet-metadata.mjs` implementa o inventário de metadados e cabeçalhos. O script separado `scripts/inventory-fixture-records.mjs` analisa registros exclusivamente de fixtures JSON locais; não acessa Sheets ou Firestore e não cria snapshot. A extração de registros reais permanece não implementada.

## Análise sanitizada de registros sintéticos

Execute `node scripts/inventory-fixture-records.mjs --fixture /caminho/absoluto/fixture.json`. O JSON deve conter `sheets`, com exatamente as sete abas mapeadas; cada aba tem `name`, `headers` completos e ordenados conforme o schema e `rows`, matriz de linhas com uma célula por cabeçalho. As células aceitam string, número, booleano ou null. O arquivo é somente lido, com limite de 2 MB e 50 mil linhas.

O relatório contém somente nomes conhecidos de abas e colunas, quantidade de registros não vazios, linhas inteiramente vazias, contagens por coluna de células nulas/em branco e inválidas e total de linhas com valores inválidos. Não inclui valores, IDs, posições de linhas, CPF, e-mail ou telefone. As regras de invalidade são preliminares: fórmulas ou valores iniciados pelos marcadores `=`, `+`, `@`, `-` são sinalizados, assim como campos numéricos selecionados que não sejam inteiros válidos ou quantidades não positivas. Campos vazios são contabilizados separadamente, inclusive quando opcionais; o relatório não classifica obrigatoriedade, valida CPF nem prova integridade referencial. O relatório não autoriza importação (`importReady: false`).

`snapshotSha256` é o SHA-256 dos bytes exatos do JSON lido, inclusive espaços e linhas em branco; não é hash canônico dos registros nem prova da origem ou consistência. O hash não anonimiza PII e pode permitir comparação ou inferência: use exclusivamente fixtures sintéticas e trate relatórios como restritos. Não direcione a saída para logs públicos. Erros não incluem valores ou caminhos.

## Consolidação preliminar de fixture

### Simulação isolada do plano de importação

Execute `node scripts/inventory-dry-run.mjs --fixture /caminho/absoluto/fixture.json` para reutilizar o consolidador e executar o validador de produtos/nichos em memória. A execução só aceita fixture local, não acessa Sheets/GAS ou Firestore e não altera o arquivo. Um resultado de sucesso do validador só é aceito se seu retorno contiver `writePerformed: false` exatamente; ausência, valor diferente ou resultado inválido causa falha fechada. Em caso de rejeição pelo validador, seu indicador de escrita é `null` porque não houve retorno, enquanto o relatório do dry-run declara que o próprio script não escreveu dados.

O JSON contém `rejections` agregadas por tipo, aba e campo conhecido, sem valores ou IDs; relações órfãs ou ambíguas não interrompem a geração do relatório. Uma linha pode contribuir para várias ocorrências; não somar contagens de tipos distintos como se fossem registros únicos. `alerts` indicam que a validação é parcial e não autoriza importação real. Código de saída: 0 para aprovação mínima, 1 para relatório com pendências e 2 para entrada estruturalmente inválida ou erro de execução; erros estruturais não geram relatório parcial. O relatório e seu hash continuam restritos, apesar da omissão de PII.

Execute `node scripts/inventory-consolidated.mjs --fixture /caminho/absoluto/fixture.json`, com o mesmo formato e limites da análise de registros. Não há conexão externa nem escrita. O relatório combina a validação estrita de cabeçalhos e o hash da fixture com contagens por aba de linhas que passaram nas verificações preliminares e linhas pendentes. Os grupos são exclusivos: uma linha com múltiplos problemas conta uma vez. Linhas totalmente vazias são contabilizadas à parte. Passar nas verificações **não** significa registro completo ou apto a importação; nulos em campos não chave não são classificados como falhas.

O consolidador verifica chaves primárias presentes, duplicatas e referências entre produtos, nichos, vendas, clientes e movimentações; referências opcionais vazias são permitidas e destinos duplicados são ambíguos. Somente contagens e nomes de campos conhecidos são mostrados; nenhum identificador ou valor de linha é emitido. Não verifica totais financeiros, histórico de saldo, identidade de operadores, validade completa de PII ou todos os contratos Firestore.

Para produtos e nichos, constrói em memória um candidato mínimo com `environment: dev` e chama `validateProductImport` real; o candidato não é salvo. `validatorAccepted` indica somente que esse candidato reduzido passou; `minimumReady` também exige nenhuma pendência nas verificações preliminares de todas as abas. Isso não valida campos omitidos na transformação, nem representa autorização ou prontidão de migração (`fullMigrationReady` é sempre false). A fixture original não está no formato aceito pelo validador, e clientes/vendas não fazem parte do contrato desse validador. O comando retorna código 1 quando não passa ou a estrutura é inválida. O hash e relatórios continuam restritos, mesmo sem valores de linhas.

## Uso do inventário de metadados

Para um JSON sintético local: `node scripts/inventory-sheet-metadata.mjs --fixture /caminho/absoluto/fixture.json`. O formato é `{"sheets":[{"name":"Produtos","headers":["ID_Produto"],"rowCapacity":100,"columnCapacity":30}]}`; inclua as sete abas e todos os cabeçalhos do schema para compatibilidade. Campos adicionais como linhas são ignorados. Fixtures JSON são suportadas; CSV não está implementado.

Para uma futura leitura real explicitamente autorizada, fornecer `INVENTORY_ALLOW_REAL_READ=YES`, `INVENTORY_SPREADSHEET_ID` e `INVENTORY_SHEETS_TOKEN` no ambiente e executar `node scripts/inventory-sheet-metadata.mjs --google-read-only`. O token deve ser emitido separadamente com escopo Sheets somente leitura e acesso restrito à origem aprovada; o script não verifica o escopo nem comprova que a origem é DEV. Não colocar token em argumentos ou arquivos versionados. O operador deve validar ambiente, identidade e permissões antes de executar.

O relatório inclui apenas nomes de abas/colunas esperados, contagens de cabeçalhos divergentes e capacidade da grade. `rowCapacity` é número de linhas alocadas, **não** contagem de registros; obter esta última exigiria ler dados e não é realizado. O relatório indica incompatibilidade e sai com código 1 para abas/cabeçalhos ausentes, duplicados, desconhecidos ou fora de ordem. Erros de transporte e respostas inválidas falham sem imprimir detalhes. Leituras separadas não constituem snapshot consistente; não usar o relatório como evidência de integridade dos dados ou autorização para importar.

## Contrato de segurança do futuro extrator

1. Usar uma identidade dedicada com permissão de leitura apenas na planilha expressamente autorizada e acesso somente leitura à API Sheets. Fixar e conferir privadamente a identidade da planilha e o ambiente antes da execução; não inferir segurança apenas do nome `dev` nem usar credenciais de produção por conveniência.
2. Usar leituras diretas da API Sheets (metadados e valores); não chamar operações GAS de catálogo ou vendas, pois podem executar recuperação e alterar dados. Proibir endpoints de escrita, deploy, triggers, alterações de propriedades, chamadas ao Firestore e dependências de clientes Firestore. Nenhuma credencial, ID privado, linha, CPF ou conteúdo de célula em logs.
3. Começar por metadados: listar abas e cabeçalhos, inclusive ausentes, adicionais, duplicados, vazios e fora de ordem, comparando com `schema/workspace-v1.json`. Tratar este schema como contrato esperado, não como prova do conteúdo da instalação. Abas inesperadas são apenas contabilizadas, não extraídas automaticamente. Não registrar títulos inesperados ou cabeçalhos desconhecidos literalmente: podem conter dados sensíveis.
4. Somente após aprovação explícita do escopo e do destino privado, ler as sete abas da tabela abaixo em lotes limitados, sem fórmulas executáveis no destino. Preservar ordem das linhas, cabeçalhos, tipos e representação dos identificadores; definir e registrar opções de renderização de valores, datas e fórmulas. Não interpretar uma célula de fórmula como texto seguro nem executar seu conteúdo. Um campo com fórmula exige marcação e revisão antes da importação.
5. Escrever eventual snapshot apenas em destino local privado fora do repositório, com permissões restritas e política de criptografia, retenção e descarte aprovadas. Não gravar em stdout, logs de CI ou pastas públicas. O manifesto separado contém versão do formato, instante, opções de leitura, contagens, hash SHA-256 dos bytes exatos do snapshot e resultado das verificações; o hash não anonimiza o snapshot nem deve ser publicado como proteção de PII. Chaves e identificadores privados ficam fora do manifesto compartilhável. O inventário agregado não contém valores de linhas.
6. A leitura em lotes não é snapshot transacional: definir janela de congelamento de escritas ou cópia consistente da origem, previamente autorizada; caso contrário, marcar o resultado como não consistente e não apto à importação. Registrar início/fim e método da captura. Não prometer que duas leituras iguais comprovam atomicidade.
7. Falhar fechado para respostas incompletas, aba ou cabeçalho obrigatório ausente, cabeçalhos duplicados, paginação incompleta, limites excedidos, erros de autorização e origem divergente. Contabilizar linhas vazias e inconsistências sem revelar valores. Não corrigir dados automaticamente. Uma captura parcial nunca é identificada como completa.

## Mapeamento inicial sujeito a validação

| Aba legada | Chave e relacionamento | Destino proposto e verificações |
|---|---|---|
| `Nichos` | `ID_Nicho` | `niches/{id}`: `Nome`, `Descricao`, `Cor_Destaque`, `Ordem_Exibicao`, `Ativo`, criação e autor. Validar UUID, nome único e campos obrigatórios. `Imagem_Drive_ID` é legado; não interpretar como subdocumento migrado. |
| `Produtos` | `ID_Produto`; `ISBN` ou `Codigo_Interno` | `products/{id}`: título, autor, editora, edição, fornecedor, categoria, ano, páginas, sinopse, preço, estoque, ativo, versão e datas. `Preco_Venda` é esperado em centavos inteiros pelo schema; conferir dados reais. `Capa_URL_Externa` é link; `Capa_Drive_ID` não é byte de mídia. |
| `Produto_Nichos` | par `ID_Produto`, `ID_Nicho` | Compor `nicheIds` no produto, verificando duplicatas, referências ausentes e IDs válidos. Confirmar política para produtos sem nicho. |
| `Clientes` | `ID_Cliente`; `CPF_Indice` | `customers/{id}` e reserva de unicidade: campos pessoais para `contact` selado pelo mecanismo da aplicação; índice CPF recalculado com a chave do destino. Revisar datas, consentimento e preferências. Não copiar ciphertext nem índice entre ambientes sem verificar compatibilidade criptográfica e autorização. |
| `Movimentacoes_Estoque` | `ID_Movimentacao`, `ID_Produto`, `ID_Venda` opcional | `stockMovements`: data, tipo, quantidade, saldos anterior/posterior, motivo e operador. Comparar cadeia de saldos com `Produtos.Estoque_Atual`; definir tratamento de histórico incompleto e versões ausentes. |
| `Vendas` | `ID_Venda`, `Idempotency_Key`; cliente opcional | `sales`: data, cliente, atendente, total, pagamento, status e origem. O serviço atual usa idempotency key como ID do documento: resolver diferenças entre as duas chaves e colisões antes de importar. |
| `Itens_Venda` | par `ID_Venda`, `ID_Produto` | `sales/{saleId}/items/{productId}`: quantidade, preço unitário e subtotal. Validar referências e somas. O destino espera título no item: definir origem histórica confiável ou bloquear; não inventar valores. |

IDs, nomes finais de campos, reservas de unicidade, índice de busca, versões, auditoria e projeções devem ser conferidos contra os serviços e modelos Firestore antes da implementação. Identidades de atendentes/autores devem ser resolvidas sem criar usuários implicitamente. Produtos ou nichos existentes no destino exigem política explícita de conflito e preservação de `hasPhoto`/`hasImage` e subdocumentos. A extração não migra mídias.

## Critérios de aceite e decisões pendentes

- Testes com fixtures sintéticas devem demonstrar somente leituras, detecção de cabeçalhos/abas e falhas, privacidade dos relatórios e ausência de qualquer chamada Firestore ou escrita na origem.
- Definir planilha e conta autorizadas, origem das chaves criptográficas de clientes, acesso a dados pessoais, destino seguro do snapshot, limites de volume, janela consistente e responsáveis pela aprovação.
- Antes de implementar importação, produzir relatório de contagens, duplicidades e relações quebradas; comparar somatórios de itens e vendas, saldo atual e movimentações. Não aplicar novamente os efeitos de vendas ao saldo importado.
- Esta especificação não constitui autorização para ler a origem real nem para executar importação ou reconciliação pesada.