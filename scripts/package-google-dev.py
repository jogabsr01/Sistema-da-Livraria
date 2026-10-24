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
    'google-apps-script/Sales.gs', 'google-apps-script/Stock.gs', 'google-apps-script/Notifications.gs', 'google-apps-script/Staff.gs', 'google-apps-script/Customers.gs', 'google-apps-script/Operations.gs', 'google-apps-script/SessionStore.gs',
    'google-apps-script/AuthControl.gs', 'google-apps-script/PasskeyStore.gs',
    'google-apps-script/OwnerAccess.gs', 'google-apps-script/Recovery.gs', 'google-apps-script/Profile.gs', 'google-apps-script/EmailChange.gs', 'google-apps-script/Niches.gs', 'google-apps-script/Schedules.gs', 'google-apps-script/Audit.gs', 'google-apps-script/SecurityAudit.gs', 'google-apps-script/Reports.gs', 'google-apps-script/Catalog.gs', 'google-apps-script/CoverPhotos.gs', 'google-apps-script/appsscript.json',
    'docs/v17/INSTALACAO_GOOGLE.md', 'docs/v17/BACKUP_RECUPERACAO.md',
    'docs/v17/PERFIL_RECUPERACAO_DEV.md', 'docs/v17/EMAIL_VERIFICADO_DEV.md', 'docs/v17/NICHOS_DEV.md', 'docs/v17/ESCALAS_DEV.md', 'docs/v17/AUDITORIA_DEV.md', 'docs/v17/EVENTOS_AUDITORIA_DEV.md', 'docs/v17/RELATORIOS_COMERCIAIS_DEV.md', 'docs/v17/OPERACOES_ADMIN_DEV.md', 'docs/v17/CEP_BRASILAPI_DEV.md', 'docs/v17/CLIENTES_CAIXA_DEV.md', 'docs/v17/EQUIPE_DEV.md', 'docs/v17/ESTOQUE_REPOSICAO_DEV.md', 'docs/v17/NOTIFICACOES_REPOSICAO_DEV.md',
    'docs/v17/PRIMEIRO_ACESSO_OWNER.md', 'docs/v17/CATALOGO_COMPARTILHADO_DEV.md', 'docs/v17/ISBN_COMPARTILHADO_DEV.md', 'docs/v17/FOTOS_CAPAS_DEV.md',
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

1. Abra https://script.google.com/ na conta proprietaria de DEV.
2. Na instalacao existente, atualize os arquivos preservando propriedades,
   recursos e URL da implantacao. Nao crie outra instalacao por cima dos dados.
3. Para uma instalacao nova, siga docs/v17/INSTALACAO_GOOGLE.md primeiro.
4. Para primeiro acesso e catalogo, siga PRIMEIRO_ACESSO_OWNER.md e
   CATALOGO_COMPARTILHADO_DEV.md, somente apos revisao e homologacao combinada.
5. Autorize os escopos revisados no Google e confira o ambiente DEV.

Nao envie PIN, senha, tokens, chave de assinatura ou JSON de credenciais no chat.
IDs e URL da implantacao nao concedem acesso por si so.
Mantenha WORKSPACE_BACKEND_ENABLED=false ate concluir identidade e homologacao.
Nao executar recuperacao de vendas com dados compartilhados ou de producao.
''')
print(f'Installation kit created: {output.name} ({len(files) + 1} files; no runtime configuration).')
