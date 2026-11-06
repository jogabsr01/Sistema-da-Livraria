"""Run the existing browser regression against the actual public build, not source."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from test_v16 import V16

class PublicBuild(V16):
    @classmethod
    def setUpClass(cls):
        artifact = ROOT / 'dist' / 'index.html'
        if not artifact.is_file():
            raise RuntimeError('Run npm run build before the public browser regression')
        super().setUpClass()
        cls.source = artifact.read_text()

if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(PublicBuild))
    sys.exit(0 if result.wasSuccessful() else 1)
