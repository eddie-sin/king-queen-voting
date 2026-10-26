"""Pure checks shared by activation and the isolated rollback rehearsal."""
import hashlib, json, pathlib
COMPATIBILITY={'databaseSchema':2,'authentication':1}
def manifest(path):
    try: return json.loads((path/'RELEASE_MANIFEST.json').read_text())
    except (OSError,ValueError): return {}
def validate_release(path,commit):
    data=manifest(path)
    if data.get('commit')!=commit or data.get('compatibility')!=COMPATIBILITY: raise ValueError('Incompatible release metadata')
    expected=data.get('files',{})
    if not {'app.js','server.js','package-lock.json','frontend/dist/index.html','admin/dist/index.html','RELEASE_COMMIT'}<=expected.keys(): raise ValueError('Incomplete release manifest')
    for name,digest in expected.items():
        p=pathlib.PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts or not (path/name).is_file() or hashlib.sha256((path/name).read_bytes()).hexdigest()!=digest: raise ValueError('Release content mismatch')
    return data
def rollback_allowed(previous,configuration_hash):
    return bool(previous and manifest(previous).get('compatibility')==COMPATIBILITY and (previous/'.configuration-sha256').is_file() and (previous/'.configuration-sha256').read_text().strip()==configuration_hash)
def activate(base,path):
    temporary=base/'next';temporary.unlink(missing_ok=True);temporary.symlink_to(path);temporary.replace(base/'current')
def recover(base,previous,configuration_hash,stop,start,healthy):
    stop()
    if not rollback_allowed(previous,configuration_hash):
        return 'stopped-incompatible'
    activate(base,previous);start()
    if not healthy(): stop();return 'stopped-unhealthy'
    return 'restored'
