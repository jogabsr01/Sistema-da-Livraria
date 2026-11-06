"""Package the complete reviewed GAS source, with exact hashes and no runtime config."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZipFile, ZIP_DEFLATED

FILES = [
    'google-apps-script/Code.gs', 'google-apps-script/Schema.gs', 'google-apps-script/Maintenance.gs',
    'google-apps-script/Sales.gs', 'google-apps-script/Stock.gs', 'google-apps-script/Notifications.gs', 'google-apps-script/Staff.gs', 'google-apps-script/Customers.gs', 'google-apps-script/Operations.gs', 'google-apps-script/SessionStore.gs',
    'google-apps-script/AuthControl.gs', 'google-apps-script/PasskeyStore.gs', 'google-apps-script/PasskeyManagement.gs',
    'google-apps-script/OwnerAccess.gs', 'google-apps-script/Recovery.gs', 'google-apps-script/EmergencyRecovery.gs', 'google-apps-script/Profile.gs', 'google-apps-script/EmailChange.gs', 'google-apps-script/Niches.gs', 'google-apps-script/Schedules.gs', 'google-apps-script/Audit.gs', 'google-apps-script/SecurityAudit.gs', 'google-apps-script/Reports.gs', 'google-apps-script/CustomerInsights.gs', 'google-apps-script/Catalog.gs', 'google-apps-script/CoverPhotos.gs', 'google-apps-script/appsscript.json',
    'instalacao-google-dev/CodigoUnico.gs.txt', 'instalacao-google-dev/LEIA-ME.md',
    'docs/v17/INSTALACAO_GOOGLE.md', 'docs/v17/HOMOLOGACAO_GOOGLE_DEV.md', 'docs/v17/QA_INSTALACAO_GOOGLE_DEV.md', 'docs/v17/TESTE_CONEXAO_DEV.md', 'docs/v17/BACKUP_RECUPERACAO.md', 'docs/v17/MANUTENCAO_RECUPERACAO_DEV.md', '.env.example',
    'docs/v17/PERFIL_RECUPERACAO_DEV.md', 'docs/v17/EMAIL_VERIFICADO_DEV.md', 'docs/v17/NICHOS_DEV.md', 'docs/v17/ESCALAS_DEV.md', 'docs/v17/AUDITORIA_DEV.md', 'docs/v17/EVENTOS_AUDITORIA_DEV.md', 'docs/v17/RELATORIOS_COMERCIAIS_DEV.md', 'docs/v17/PERFIL_COMPRA_DEV.md', 'docs/v17/GESTAO_PASSKEYS_DEV.md', 'docs/v17/RECUPERACAO_EMERGENCIAL_DEV.md', 'docs/v17/OPERACOES_ADMIN_DEV.md', 'docs/v17/CEP_BRASILAPI_DEV.md', 'docs/v17/CLIENTES_CAIXA_DEV.md', 'docs/v17/EQUIPE_DEV.md', 'docs/v17/ESTOQUE_REPOSICAO_DEV.md', 'docs/v17/NOTIFICACOES_REPOSICAO_DEV.md',
    'docs/v17/ABERTURA_ACESSO_LATENCIA_DEV.md', 'docs/v17/DIAGNOSTICO_IDENTIDADE_DEV.md',
    'docs/v17/PRIMEIRO_ACESSO_OWNER.md', 'docs/v17/CATALOGO_COMPARTILHADO_DEV.md', 'docs/v17/ISBN_COMPARTILHADO_DEV.md', 'docs/v17/FOTOS_CAPAS_DEV.md',
]

README = '''KIT GOOGLE DEV — LIVRARIA

Inclui todos os arquivos GAS revisados, inclusive Maintenance.gs, manifesto,
modelo de variáveis vazio, instalação e roteiro de homologação. Não inclui
credenciais, configurações privadas ou prova de conexão Google real.

1. Confira MANIFESTO.json e os hashes antes de copiar os arquivos.
2. Na conta proprietária DEV, abra o projeto Apps Script correto. Se já existir,
   preserve propriedades, IDs, dados e URL /exec. Não reprovisione por cima.
3. Use a modalidade única em instalacao-google-dev/LEIA-ME.md OU atualize
   o lote COMPLETO modular. Não misture as duas modalidades no editor.
4. Siga docs/v17/INSTALACAO_GOOGLE.md e HOMOLOGACAO_GOOGLE_DEV.md por etapas.
5. Cadastre chaves somente em interfaces privadas; nunca no código ou no chat.
6. Faça o diagnóstico assinado antes da ativação gradual e dos testes reais.

Não alterar main/PROD, promover cópia restaurada, instalar gatilho ou excluir
histórico automaticamente. A autorização Google acontece na conta correta.
O kit e os testes locais não comprovam IAM, entrega de e-mail, quotas ou RPO/RTO.
'''


def checked_source(root, name):
    file = root / name
    for part in [file, *file.parents]:
        if part.is_symlink():
            raise ValueError('Refusing symlinked kit source.')
        if part == root:
            break
    if not file.is_file() or not file.resolve().is_relative_to(root):
        raise ValueError('Missing or invalid reviewed kit source.')
    return file.read_bytes()


def build_kit(source_root, destination):
    if any(part.is_symlink() for part in [Path(source_root).absolute(), *Path(source_root).absolute().parents]):
        raise ValueError('Refusing symlinked source root.')
    root = Path(source_root).resolve()
    output = Path(destination).absolute()
    if output.suffix.lower() != '.zip':
        raise ValueError('The destination must be a new ZIP file.')
    if any(part.is_symlink() for part in [output, *output.parents]):
        raise ValueError('Refusing symlinked kit destination.')
    output = output.resolve()
    if output == root or root in output.parents:
        raise ValueError('Write the kit outside the repository/public build.')
    if output.exists():
        raise ValueError('Refusing to overwrite an existing destination.')
    directory = root / 'google-apps-script'
    if directory.is_symlink():
        raise ValueError('Refusing symlinked GAS directory.')
    actual = {str(p.relative_to(root)) for p in directory.iterdir() if p.suffix == '.gs'}
    expected = {name for name in FILES if name.endswith('.gs')}
    if actual != expected:
        raise ValueError('GAS source inventory differs from reviewed kit; update the complete list.')
    contents = {name: checked_source(root, name) for name in FILES}
    for line in contents['.env.example'].decode('utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        if name.strip().endswith(('_KEY', '_SECRET', '_PEPPER')) and value.strip():
            raise ValueError('Refusing populated private keys in the example template.')
    contents['LEIA-ME.txt'] = README.encode('utf-8')
    manifest = {'format': 'livraria-google-dev-kit', 'version': 1,
                'environment': 'dev', 'runtimeConfigured': False,
                'googleHomologated': False,
                'files': [{'path': name, 'bytes': len(body), 'sha256': sha256(body).hexdigest()}
                          for name, body in sorted(contents.items())]}
    contents['MANIFESTO.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
    # Capture validated bytes before writing; publish atomically without replacing a file.
    temporary = None
    try:
        with NamedTemporaryFile(dir=output.parent, prefix='.google-dev-kit-', delete=False) as temp:
            temporary = Path(temp.name)
        with ZipFile(temporary, 'w', compression=ZIP_DEFLATED) as kit:
            for name, body in sorted(contents.items()):
                kit.writestr(name, body)
        os.link(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {'files': len(contents), 'gasFiles': len(expected),
            'sha256': sha256(output.read_bytes()).hexdigest(),
            'runtimeConfigured': False, 'googleHomologated': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    try:
        result = build_kit(Path(__file__).resolve().parents[1], args.output)
    except (ValueError, OSError):
        parser.exit(1, 'GOOGLE_DEV_KIT_FAILED: verify reviewed sources and a new private destination.\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
