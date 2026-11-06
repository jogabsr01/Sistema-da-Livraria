"""Artifact safety checks; no Google connection or credentials."""
import importlib.util
import json
from hashlib import sha256
from pathlib import Path
import shutil
import tempfile
import unittest
from zipfile import ZipFile

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('google_kit', REPO / 'scripts/package-google-dev.py')
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)

class KitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'source'
        for name in kit.FILES:
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / name, dest)
        self.output = self.base / 'kit.zip'

    def test_complete_inventory_and_exact_hashes(self):
        result = kit.build_kit(self.root, self.output)
        self.assertFalse(result['googleHomologated'])
        self.assertFalse(result['runtimeConfigured'])
        with ZipFile(self.output) as archive:
            names = set(archive.namelist())
            self.assertEqual(names, set(kit.FILES) | {'LEIA-ME.txt', 'MANIFESTO.json'})
            self.assertIn('google-apps-script/Maintenance.gs', names)
            manifest = json.loads(archive.read('MANIFESTO.json'))
            self.assertEqual({f['path'] for f in manifest['files']}, names - {'MANIFESTO.json'})
            for item in manifest['files']:
                body = archive.read(item['path'])
                self.assertEqual(item['bytes'], len(body))
                self.assertEqual(item['sha256'], sha256(body).hexdigest())
            for name in kit.FILES:
                self.assertEqual(archive.read(name), (REPO / name).read_bytes())

    def test_missing_or_extra_gas_fails_before_publication(self):
        module = self.root / 'google-apps-script/Maintenance.gs'
        original = module.read_bytes()
        module.unlink()
        with self.assertRaises(ValueError): kit.build_kit(self.root, self.output)
        self.assertFalse(self.output.exists())
        module.write_bytes(original)
        (module.parent / 'Unexpected.gs').write_text('unexpected')
        with self.assertRaises(ValueError): kit.build_kit(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_source_symlink_is_rejected(self):
        source = self.root / 'google-apps-script/Code.gs'
        source.unlink()
        source.symlink_to(REPO / 'google-apps-script/Code.gs')
        with self.assertRaises(ValueError): kit.build_kit(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_inside_repo_and_symlink_destination_are_rejected(self):
        with self.assertRaises(ValueError): kit.build_kit(self.root, self.root / 'public.zip')
        alias = self.base / 'alias'
        alias.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ValueError): kit.build_kit(self.root, alias / 'kit.zip')

    def test_existing_destination_is_never_overwritten(self):
        self.output.write_bytes(b'original')
        with self.assertRaises(ValueError): kit.build_kit(self.root, self.output)
        self.assertEqual(self.output.read_bytes(), b'original')
        self.assertEqual(list(self.base.glob('.google-dev-kit-*')), [])

    def test_populated_template_key_is_rejected(self):
        with (self.root / '.env.example').open('a') as file:
            file.write('\nWORKSPACE_HMAC_SECRET=' + 'a' * 64 + '\n')
        with self.assertRaises(ValueError): kit.build_kit(self.root, self.output)
        self.assertFalse(self.output.exists())

if __name__ == '__main__':
    unittest.main()
