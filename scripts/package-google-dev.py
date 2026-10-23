"""Package only reviewed Apps Script source and public setup instructions; no secrets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
args = parser.parse_args()
output = args.output.resolve()
if output == root or root in output.parents:
    raise SystemExit('Write the installation kit outside the repository/public build.')
files = [
    'google-apps-script/Code.gs', 'google-apps-script/Schema.gs',
    'google-apps-script/Sales.gs', 'google-apps-script/SessionStore.gs',
    'google-apps-script/AuthControl.gs', 'google-apps-script/PasskeyStore.gs', 'google-apps-script/appsscript.json',
    'docs/v17/INSTALACAO_GOOGLE.md', 'docs/v17/BACKUP_RECUPERACAO.md',
]
for name in files:
    if (root / name).is_symlink():
        raise SystemExit('Refusing symlinked kit source.')
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as kit:
    for name in files:
        kit.write(root / name, name)
    kit.writestr('LEIA-ME.txt', '''KIT GOOGLE DEV - LIVRARIA

Nao possui credenciais. Nao configura nem altera producao.
Este codigo esta em revisao e nao conclui a integracao funcional.

1. Abra https://script.google.com/ usando uma conta dedicada a DEV.
2. Crie projeto novo e copie os arquivos da pasta google-apps-script.
3. Siga docs/v17/INSTALACAO_GOOGLE.md para configurar propriedades privadas.
4. Execute provisionDevelopment e autorize os escopos revisados no Google.
5. Execute inspectDevelopmentSchema para conferir a instalacao.

Nao envie PIN, senha, tokens, chave de assinatura ou JSON de credenciais no chat.
IDs e URL da implantacao nao concedem acesso por si so.
Mantenha WORKSPACE_BACKEND_ENABLED=false ate concluir identidade e homologacao.
Nao executar recuperacao de vendas com dados compartilhados ou de producao.
''')
print(f'Installation kit created: {output.name} ({len(files) + 1} files; no runtime configuration).')
