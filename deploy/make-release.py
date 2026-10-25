#!/usr/bin/env python3
"""Package runtime code and built frontends; never package secrets or node_modules."""
import argparse, io, pathlib, re, subprocess, tarfile

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[1]
    commit = subprocess.check_output(['git','rev-parse','HEAD'], cwd=root, text=True).strip()
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise SystemExit('Invalid Git commit')
    entries = ['app.js','server.js','package.json','package-lock.json','controller','middleware','model','route','utils','frontend/dist','admin/dist']
    for name in entries + ['frontend/dist/index.html','admin/dist/index.html']:
        if not (root / name).exists():
            raise SystemExit('Missing build input: '+name)
    def filter_entry(info):
        parts=pathlib.PurePosixPath(info.name).parts
        if any(p.startswith('.env') or p=='config.env' or p=='node_modules' for p in parts):
            return None
        if info.issym() or info.islnk():
            raise ValueError('Symlinks are not allowed in release inputs')
        info.uid=info.gid=0
        info.uname=info.gname=''
        info.mode=0o755 if info.isdir() else 0o644
        return info
    with tarfile.open(args.output,'w:gz') as tar:
        for name in entries:
            tar.add(root/name,arcname=name,filter=filter_entry)
        data=(commit+'\n').encode()
        meta=tarfile.TarInfo('RELEASE_COMMIT')
        meta.size=len(data)
        meta.mode=0o644
        tar.addfile(meta,io.BytesIO(data))
    print('Packaged release:',commit)

if __name__=='__main__':
    main()
