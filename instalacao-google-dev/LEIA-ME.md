# Instalação Google DEV com uma única colagem

Esta alternativa reúne exatamente os mesmos módulos GAS do projeto em `CodigoUnico.gs.txt`. O arquivo é gerado, sem minificação ou alteração dos módulos, com seus nomes e hashes. Ele não contém propriedades privadas e não configura ou homologa o Google automaticamente.

1. No GitHub, abra `CodigoUnico.gs.txt` nesta pasta. Use **Copy raw file / Copiar conteúdo do arquivo** na barra do arquivo. Como alternativa, abra a visualização **Raw** e copie todo o texto com ⌘A e ⌘C.
2. No Apps Script DEV existente, mantenha `Código.gs` (ou `Code.gs`) e `appsscript.json`. Remova **somente os outros arquivos de código `.gs`** do editor: seus módulos estão reunidos na versão única. Não exclua o projeto, implantação, propriedades ou arquivos do Drive. Não misture o arquivo único com os módulos separados, pois isso duplica funções e pode reinicializar variáveis.
3. Substitua todo o conteúdo de `Código.gs` pelo texto copiado e salve. Na modalidade única, o projeto terá um script e seu manifesto. O nome `Código.gs` pode ser mantido.
4. Confira que `appsscript.json` corresponde ao manifest da mesma versão em `google-apps-script`. Preserve as Propriedades do script, IDs, chaves, planilhas e URL /exec existentes.
5. Execute `inspectDevelopmentSchema` e confira o retorno. Depois siga a preparação dos controles privados e identidade no [roteiro completo](../docs/v17/INSTALACAO_GOOGLE.md). Não reprovisione dados existentes para tentar corrigir erros.

A edição do projeto não atualiza uma implantação versionada existente. Atualize a mesma implantação somente na etapa indicada no roteiro; preserve a URL /exec. Nenhuma operação de venda/estoque é executada por copiar o código.

Para manutenção pelo desenvolvedor: alterar fontes em `google-apps-script`, executar `npm run google:single` e versionar a cópia gerada. A suíte confere que ela não ficou desatualizada. Fontes modulares continuam sendo a origem de desenvolvimento. Para voltar ao modo modular, substituir a versão única pelo lote completo de módulos; não manter ambos.
