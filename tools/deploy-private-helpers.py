#!/usr/bin/env python3
"""Private operator transport. Inspect is read-only; apply requires a reviewed hash manifest.

No schema installation, service changes, permission expansion, or business-data writes.
The only SQL statements are SELECTs in explicit read-only transactions.
"""
import base64
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import uuid

ROOT = Path('/home/emrullah/voltguard-site-bridge')
TARGETS = ('company_store.py', 'saha_store.py', 'saha-source-schema.json')
CONFIGS = ('config.json', 'saha-config.json')
EXPECTED_MODES = {name: 0o700 if name.endswith('.py') else 0o600 for name in TARGETS + CONFIGS}
LOCK = '.deploy-private-helpers.lock'
VOLATILE = {'https-bridge.json.nonces.sqlite3', 'https-bridge.json.nonces.sqlite3-wal', 'https-bridge.json.nonces.sqlite3-shm'}
HASH = re.compile(r'[a-f0-9]{64}')


class RolloutError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise RolloutError(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def json_digest(value):
    return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def guarded_file(name):
    path = ROOT / name
    require(path.parent == ROOT and path.is_file() and not path.is_symlink() and path.resolve().parent == ROOT, 'private_file_invalid')
    require(path.stat().st_uid == os.getuid(), 'private_file_owner')
    return path


def metadata(name):
    path = guarded_file(name)
    mode = stat.S_IMODE(path.stat().st_mode)
    if name in EXPECTED_MODES:
        require(mode == EXPECTED_MODES[name], 'private_file_mode')
    return {'sha256': digest(path.read_bytes()), 'mode': format(mode, '04o')}


def file_inventory():
    result = {}
    for path in sorted(ROOT.iterdir()):
        if path.name == LOCK or path.name in VOLATILE:
            continue
        require(not path.is_symlink(), 'private_root_symlink')
        if path.is_file():
            result[path.name] = metadata(path.name)
    return result


def read_config(name):
    value = json.loads(guarded_file(name).read_bytes())
    require(isinstance(value, dict), 'private_config_invalid')
    for key in ('container', 'database', 'user'):
        require(isinstance(value.get(key), str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', value[key]), 'private_config_invalid')
    return value


def sql(config, query):
    command = ['docker', 'exec', '-i', config['container'], 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', config['user'], '-d', config['database']]
    body = "BEGIN READ ONLY;\nSET LOCAL statement_timeout='25s';\nSET LOCAL lock_timeout='5s';\n" + query + '\nCOMMIT;\n'
    result = subprocess.run(command, input=body, capture_output=True, text=True, timeout=35)
    require(result.returncode == 0, 'readonly_metadata_failed')
    return json.loads(result.stdout)


def fingerprint(config):
    value = sql(config, """SELECT json_build_object(
      'relations',(SELECT md5(coalesce(string_agg(n.nspname||'.'||c.relname||':'||c.relkind::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,''),E'\\n' ORDER BY c.oid),'')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth')),
      'policies',(SELECT md5(coalesce(string_agg(to_jsonb(p)::text,E'\\n' ORDER BY schemaname,tablename,policyname),'')) FROM pg_policies p WHERE schemaname IN ('public','auth')),
      'functions',(SELECT md5(coalesce(string_agg(p.oid::text||':'||p.proname||':'||p.prosrc||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,''),E'\\n' ORDER BY p.oid),'')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth')),
      'constraints',(SELECT md5(coalesce(string_agg(c.oid::text||':'||pg_get_constraintdef(c.oid),E'\\n' ORDER BY c.oid),'')) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','auth')),
      'triggers',(SELECT md5(coalesce(string_agg(t.oid::text||':'||pg_get_triggerdef(t.oid),E'\\n' ORDER BY t.oid),'')) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth')),
      'identityTables',(SELECT coalesce(json_agg(n.nspname||'.'||c.relname ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND (n.nspname='auth' AND c.relname='users' OR n.nspname='public' AND c.relname='profiles')));""")
    identities = value.pop('identityTables')
    require(isinstance(identities, list) and 'auth.users' in identities, 'readonly_identity_metadata')
    identity_hashes = {}
    for table in identities:
        require(table in ('auth.users', 'public.profiles'), 'readonly_identity_metadata')
        # Only an aggregate fingerprint is returned, never an identity record.
        rows = sql(config, "SELECT json_build_object('rows',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),''))) FROM " + table + ' t;')
        identity_hashes[table] = json_digest(rows)
    return {'metadataSha256': json_digest(value), 'identitySha256': json_digest(identity_hashes)}


def health(directory, name, config):
    request = {'op': 'health', 'site': '0' * 32, 'actor': {'id': 's' + '0' * 24, 'role': 'admin'}}
    result = subprocess.run(['python3', '-B', str(directory / name), '--config', str(ROOT / config)], input=json.dumps(request), capture_output=True, text=True, timeout=35, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    require(result.returncode == 0, 'readonly_health_process')
    value = json.loads(result.stdout)
    require(value.get('ok') is True and value.get('healthy') is True, 'readonly_health_failed')
    return True


def inspect():
    require(ROOT.is_dir() and not ROOT.is_symlink() and ROOT.resolve() == ROOT and ROOT.stat().st_uid == os.getuid(), 'private_root_invalid')
    require(stat.S_IMODE(ROOT.stat().st_mode) == 0o700, 'private_root_mode')
    inventory = file_inventory()
    require(set(TARGETS + CONFIGS) <= set(inventory), 'private_files_missing')
    configs = {name: read_config(name) for name in CONFIGS}
    require(configs['config.json']['container'] == 'sb-voltguard-db' and configs['saha-config.json']['container'] == 'sb-sahatakip-db', 'private_target_changed')
    healthy = {'company': health(ROOT, 'company_store.py', 'config.json'), 'saha': health(ROOT, 'saha_store.py', 'saha-config.json')}
    fingerprints = {key: fingerprint(configs[name]) for key, name in [('company', 'config.json'), ('saha', 'saha-config.json')]}
    require(inventory == file_inventory(), 'private_files_changed_during_inspection')
    return {'rootMode': '0700', 'files': inventory, 'healthy': healthy, 'fingerprints': fingerprints}


def sync_directory(directory):
    descriptor = os.open(str(directory), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_private(path, data, mode):
    descriptor = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def apply(payload):
    plan, supplied = payload.get('manifest'), payload.get('files')
    require(isinstance(plan, dict) and plan.get('version') == 1 and plan.get('host') == 'sunucu' and plan.get('root') == str(ROOT), 'reviewed_manifest_required')
    require(isinstance(supplied, dict) and set(supplied) == set(TARGETS), 'candidate_files_invalid')
    require(isinstance(plan.get('candidateHashes'), dict) and set(plan['candidateHashes']) == set(TARGETS), 'candidate_hashes_invalid')
    candidate = {name: base64.b64decode(supplied[name], validate=True) for name in TARGETS}
    require(all(HASH.fullmatch(plan['candidateHashes'][name]) and digest(candidate[name]) == plan['candidateHashes'][name] for name in TARGETS), 'candidate_hash_mismatch')
    for name in TARGETS:
        require(0 < len(candidate[name]) <= 2 * 1024 * 1024, 'candidate_size')
        if name.endswith('.py'):
            compile(candidate[name].decode('utf-8'), name, 'exec')
    schema = json.loads(candidate['saha-source-schema.json'])
    require(isinstance(schema, dict) and len(schema) == 72 and {'user_id', 'customer_id', 'start_at', 'end_at', 'status'} <= set(schema['visits']), 'candidate_schema_invalid')
    # A lock is created only for an explicit apply, never by inspection/planning.
    lock_path = ROOT / LOCK
    require(not lock_path.is_symlink(), 'rollout_lock_invalid')
    descriptor = os.open(str(lock_path), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    require(os.fstat(descriptor).st_uid == os.getuid() and stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o600, 'rollout_lock_invalid')
    with os.fdopen(descriptor, 'a+b') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RolloutError('rollout_already_running') from None
        before = inspect()
        expected = plan.get('expectedInspection')
        require(isinstance(expected, dict) and before == expected, 'installed_state_changed_review_again')
        changes = [name for name in TARGETS if before['files'][name]['sha256'] != plan['candidateHashes'][name]]
        require(changes == plan.get('changes'), 'manifest_changes_mismatch')
        if not changes:
            return {'applied': False, 'alreadyCurrent': True, 'healthy': before['healthy']}
        old = {name: guarded_file(name).read_bytes() for name in TARGETS}
        protected = {name: value for name, value in before['files'].items() if name not in TARGETS}
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
        stage = ROOT / ('.helpers-stage-' + stamp)
        backup = ROOT / ('backup-helpers-' + stamp)
        stage.mkdir(mode=0o700)
        backup.mkdir(mode=0o700)
        changed = []
        try:
            for name in TARGETS:
                mode = int(before['files'][name]['mode'], 8)
                write_private(stage / name, candidate[name], mode)
                if name in changes:
                    write_private(backup / name, old[name], mode)
            write_private(backup / 'rollout-manifest.json', (json.dumps(plan, indent=2) + '\n').encode(), 0o600)
            sync_directory(stage)
            sync_directory(backup)
            health(stage, 'company_store.py', 'config.json')
            health(stage, 'saha_store.py', 'saha-config.json')
            require(before['files'] == file_inventory(), 'private_files_changed_during_staging')
            # The new source helper references the added validator. Install its
            # dependency first; rollback restores the source helper first.
            for name in TARGETS:
                if name in changes:
                    os.replace(stage / name, ROOT / name)
                    changed.append(name)
            sync_directory(ROOT)
            after = inspect()
            require(all(after['files'][name]['sha256'] == plan['candidateHashes'][name] for name in TARGETS), 'installed_hash_mismatch')
            require({name: value for name, value in after['files'].items() if name not in TARGETS} == protected, 'protected_file_changed')
            require(after['fingerprints'] == before['fingerprints'], 'identity_or_security_fingerprint_changed')
            return {'applied': True, 'changed': changes, 'helpers': {name: after['files'][name] for name in TARGETS}, 'healthy': after['healthy'], 'configsAndOtherFilesPreserved': True, 'identityAndSecurityPreserved': True, 'sqlInstalled': False, 'businessDataWrites': False, 'backup': str(backup)}
        except BaseException:
            for name in reversed(changed):
                rollback = stage / (name + '.rollback')
                write_private(rollback, old[name], int(before['files'][name]['mode'], 8))
                os.replace(rollback, ROOT / name)
            if changed:
                sync_directory(ROOT)
            raise
        finally:
            require(stage.parent == ROOT and stage.name.startswith('.helpers-stage-'), 'stage_cleanup_target')
            shutil.rmtree(stage)


def main():
    try:
        payload = json.load(sys.stdin)
        require(isinstance(payload, dict), 'operator_input_invalid')
        action = payload.get('action')
        require(action in ('inspect', 'apply'), 'operator_action_invalid')
        result = inspect() if action == 'inspect' else apply(payload)
        print(json.dumps({'ok': True, 'action': action, 'result': result}, sort_keys=True))
    except (RolloutError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        # No subprocess output, configs, SQL text, credentials or record contents.
        code = str(error) if isinstance(error, RolloutError) else 'operator_failed'
        print(json.dumps({'ok': False, 'code': code}))
        sys.exit(1)


if __name__ == '__main__':
    main()
