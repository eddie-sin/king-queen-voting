#!/usr/bin/env python3
"""Build provenance and exact-commit packaging. No credentials or dependencies."""
import argparse, gzip, hashlib, io, json, pathlib, re, subprocess, tarfile
RUNTIME = ['app.js','server.js','package.json','package-lock.json','controller','middleware','model','route','utils']
COMPATIBILITY = {'databaseSchema':2,'authentication':1}
def git(root,*args):
    return subprocess.check_output(['git',*args],cwd=root)
def clean_commit(root):
    commit=git(root,'rev-parse','HEAD').decode().strip()
    if not re.fullmatch('[0-9a-f]{40}',commit): raise ValueError('Invalid commit')
    if git(root,'status','--porcelain','--untracked-files=no').strip(): raise ValueError('Commit tracked changes before building a release')
    if git(root,'ls-files','--others','--exclude-standard','--',*RUNTIME).strip(): raise ValueError('Untracked runtime inputs must be reviewed and committed')
    return commit

def digest(data): return hashlib.sha256(data).hexdigest()
def built_files(root,site):
    directory=root/site/'dist'
    files={}
    for p in sorted(directory.rglob('*')):
        if p.is_symlink(): raise ValueError('Symlinks are not release inputs')
        if p.is_file() and p.name!='BUILD_PROVENANCE.json': files[p.relative_to(root).as_posix()]=p.read_bytes()
    if f'{site}/dist/index.html' not in files: raise ValueError('Build input missing: '+site)
    return files

def stamp(root,commit):
    for site in ['frontend','admin']:
        files=built_files(root,site)
        (root/site/'dist/BUILD_PROVENANCE.json').write_text(json.dumps({'commit':commit,'files':{p:digest(b) for p,b in files.items()}},sort_keys=True)+'\n')

def package(root,output):
    commit=clean_commit(root)
    files={}
    with tarfile.open(fileobj=io.BytesIO(git(root,'archive','HEAD',*RUNTIME))) as source:
        for member in source.getmembers():
            if member.isdir(): continue
            if not member.isfile(): raise ValueError('Invalid tracked runtime input')
            files[member.name]=source.extractfile(member).read()
    for site in ['frontend','admin']:
        built=built_files(root,site)
        provenance=json.loads((root/site/'dist/BUILD_PROVENANCE.json').read_text())
        if provenance!={'commit':commit,'files':{p:digest(b) for p,b in built.items()}}: raise ValueError('Stale or modified frontend build: '+site)
        files.update(built)
    files['RELEASE_COMMIT']=(commit+'\n').encode()
    files['RELEASE_MANIFEST.json']=(json.dumps({'commit':commit,'compatibility':COMPATIBILITY,'files':{p:digest(b) for p,b in files.items()}},sort_keys=True)+'\n').encode()
    output=pathlib.Path(output)
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('wb') as raw, gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz, tarfile.open(fileobj=gz,mode='w') as tar:
        for name,data in sorted(files.items()):
            if any(p.startswith('.env') or p in ['config.env','node_modules'] for p in pathlib.PurePosixPath(name).parts): raise ValueError('Forbidden release input')
            meta=tarfile.TarInfo(name);meta.size=len(data);meta.mode=0o644;meta.mtime=0
            tar.addfile(meta,io.BytesIO(data))
    checksum=digest(output.read_bytes())
    output.with_suffix(output.suffix+'.sha256').write_text(checksum+'  '+output.name+'\n')
    print('Packaged exact commit:',commit,'SHA256:',checksum)
    return checksum

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    package(pathlib.Path(__file__).resolve().parents[1],args.output)
if __name__=='__main__': main()
