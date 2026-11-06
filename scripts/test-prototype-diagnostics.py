"""Run diagnostics/RPC integration against the public build."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
from test_prototype_diagnostics import PrototypeDiagnostics
if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PrototypeDiagnostics))
    raise SystemExit(0 if result.wasSuccessful() else 1)
