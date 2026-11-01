"""Operator transaction tests. Only disposable synthetic files; no SSH, SQL or live root.

Run on Linux: python3 tools/tests/private-helper-rollout-unit.py tools/deploy-private-helpers.py
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest

CODE = globals().get('VG_OPERATOR_TEST_CODE')
if CODE is None:
    CODE = Path(sys.argv[1]).read_text(encoding='utf-8')


class Fixture:
    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix='vg-helper-rollout-qa-')
        self.root = Path(self.directory.name)
        os.chmod(self.root, 0o700)
        self.ops = {'__name__': 'operator_fixture'}
        exec(compile(CODE, 'deploy-private-helpers.py', 'exec'), self.ops)
        self.ops['ROOT'] = self.root
        self.ops['health'] = lambda *_: True
        self.ops['fingerprint'] = lambda config: {'metadataSha256': self.ops['digest'](config['container'].encode()), 'identitySha256': '0' * 64}
        self.ops['sql'] = lambda *_: self.fail_sql()
        self.old = {'company_store.py': b'# old company\n', 'saha_store.py': b'# old source\n'}
        self.schema = {'visits': {name: {} for name in ['user_id', 'customer_id', 'start_at', 'end_at', 'status']}, **{'table_' + str(i): {} for i in range(71)}}
        self.old['saha-source-schema.json'] = json.dumps(self.schema).encode()
        for name, data in self.old.items():
            self.write(name, data, 0o700 if name.endswith('.py') else 0o600)
        for name, container in [('config.json', 'sb-voltguard-db'), ('saha-config.json', 'sb-sahatakip-db')]:
            self.write(name, json.dumps({'container': container, 'database': 'synthetic', 'user': 'synthetic'}).encode(), 0o600)
        self.write('https_bridge.py', b'# unrelated transport\n', 0o600)
        self.write('https-bridge.json.nonces.sqlite3', b'synthetic live replay state', 0o600)
        self.protected = {name: (self.root / name).read_bytes() for name in ['config.json', 'saha-config.json', 'https_bridge.py', 'https-bridge.json.nonces.sqlite3']}
        self.candidate = dict(self.old, **{'company_store.py': b'# new company\n', 'saha_store.py': b'# new source\n'})
        self.manifest = {'version': 1, 'host': 'sunucu', 'root': str(self.root), 'expectedInspection': self.ops['inspect'](), 'candidateHashes': {name: self.ops['digest'](value) for name, value in self.candidate.items()}, 'changes': ['company_store.py', 'saha_store.py']}

    def fail_sql(self):
        raise AssertionError('No SQL is permitted in this synthetic transaction test')

    def write(self, name, data, mode):
        (self.root / name).write_bytes(data)
        os.chmod(self.root / name, mode)

    def payload(self):
        return {'manifest': self.manifest, 'files': {name: base64.b64encode(value).decode() for name, value in self.candidate.items()}}

    def apply(self):
        return self.ops['apply'](self.payload())

    def unchanged(self, test):
        for name, value in self.old.items():
            test.assertEqual((self.root / name).read_bytes(), value)
        for name, value in self.protected.items():
            test.assertEqual((self.root / name).read_bytes(), value)
        test.assertEqual(list(self.root.glob('.helpers-stage-*')), [])

    def close(self):
        self.directory.cleanup()


class RolloutTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()

    def tearDown(self):
        self.fixture.close()

    def test_success_preserves_configs_schema_other_files_and_private_backup(self):
        f = self.fixture
        result = f.apply()
        self.assertTrue(result['applied'])
        self.assertFalse(result['sqlInstalled'])
        self.assertFalse(result['businessDataWrites'])
        for name, value in f.candidate.items():
            self.assertEqual((f.root / name).read_bytes(), value)
        for name, value in f.protected.items():
            self.assertEqual((f.root / name).read_bytes(), value)
        backup = Path(result['backup'])
        self.assertEqual(backup.parent, f.root)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
        for name in f.manifest['changes']:
            self.assertEqual((backup / name).read_bytes(), f.old[name])
            self.assertEqual(stat.S_IMODE((backup / name).stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((backup / 'rollout-manifest.json').stat().st_mode), 0o600)
        self.assertEqual(list(f.root.glob('.helpers-stage-*')), [])

    def test_drift_rejects_before_any_replacement(self):
        f = self.fixture
        f.manifest['expectedInspection']['files']['company_store.py']['sha256'] = '0' * 64
        with self.assertRaisesRegex(f.ops['RolloutError'], 'installed_state_changed_review_again'):
            f.apply()
        f.unchanged(self)
        self.assertEqual(list(f.root.glob('backup-helpers-*')), [])

    def test_candidate_hash_mismatch_rejects_before_any_private_file_write(self):
        f = self.fixture
        f.manifest['candidateHashes']['company_store.py'] = '0' * 64
        with self.assertRaisesRegex(f.ops['RolloutError'], 'candidate_hash_mismatch'):
            f.apply()
        f.unchanged(self)
        self.assertFalse((f.root / f.ops['LOCK']).exists())

    def test_post_replacement_health_failure_rolls_back_both_helpers(self):
        f = self.fixture
        def health(directory, *_):
            if directory == f.root and (f.root / 'company_store.py').read_bytes() == f.candidate['company_store.py']:
                raise f.ops['RolloutError']('synthetic_health_failure')
            return True
        f.ops['health'] = health
        with self.assertRaisesRegex(f.ops['RolloutError'], 'synthetic_health_failure'):
            f.apply()
        f.unchanged(self)

    def test_second_atomic_replace_failure_restores_first_helper(self):
        f = self.fixture
        original = os.replace
        failed = False
        def replace(source, destination):
            nonlocal failed
            if not failed and Path(destination) == f.root / 'saha_store.py':
                failed = True
                raise OSError('synthetic second replacement failure')
            return original(source, destination)
        os.replace = replace
        try:
            with self.assertRaisesRegex(OSError, 'synthetic second replacement failure'):
                f.apply()
        finally:
            os.replace = original
        f.unchanged(self)

    def test_identity_fingerprint_change_rolls_back_helpers(self):
        f = self.fixture
        original = f.ops['fingerprint']
        def fingerprint(config):
            value = original(config)
            if (f.root / 'company_store.py').read_bytes() == f.candidate['company_store.py']:
                value['identitySha256'] = '1' * 64
            return value
        f.ops['fingerprint'] = fingerprint
        with self.assertRaisesRegex(f.ops['RolloutError'], 'identity_or_security_fingerprint_changed'):
            f.apply()
        f.unchanged(self)

    def test_legitimate_runtime_nonce_changes_are_preserved_not_pinned_as_code(self):
        f = self.fixture
        nonce = f.root / 'https-bridge.json.nonces.sqlite3'
        nonce.write_bytes(b'new synthetic replay state')
        result = f.apply()
        self.assertTrue(result['applied'])
        self.assertEqual(nonce.read_bytes(), b'new synthetic replay state')

    def test_configuration_drift_rejects_without_replacement(self):
        f = self.fixture
        config = f.root / 'config.json'
        config.write_bytes(config.read_bytes().replace(b'synthetic', b'another_synthetic'))
        with self.assertRaisesRegex(f.ops['RolloutError'], 'installed_state_changed_review_again'):
            f.apply()
        for name, value in f.old.items():
            self.assertEqual((f.root / name).read_bytes(), value)
        self.assertEqual(list(f.root.glob('backup-helpers-*')), [])


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]])
