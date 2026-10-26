#!/usr/bin/python3
"""Root-installed deploy entry point. Runtime application always runs as voting."""
import fcntl, hashlib, http.client, json, os, pathlib, pwd, re, shutil, subprocess, sys, tarfile, tempfile, time
import importlib.util, socket, ssl
import boto3
_policy_spec = importlib.util.spec_from_file_location('release_policy', pathlib.Path(__file__).with_name('release-policy.py'))
policy = importlib.util.module_from_spec(_policy_spec)
_policy_spec.loader.exec_module(policy)
PUBLIC_HOST = 'gusto-thadingyut-festival.eddiespace.com'
PRODUCTION_CLIENT = '307069587123-a38ssh3vg3fg7o0tvgnaan3mcssa9unb.apps.googleusercontent.com'
CONFIG = pathlib.Path('/etc/king-queen-voting/config.env')
class LocalHTTPS(http.client.HTTPSConnection):
    def connect(self):
        self.sock = ssl.create_default_context().wrap_socket(socket.create_connection(('127.0.0.1',443),timeout=3),server_hostname=PUBLIC_HOST)


BASE = pathlib.Path('/srv/king-queen-voting')
BUCKET = 'kqv-releases-052081696303-ap-southeast-1'
SERVICE = 'king-queen-voting.service'
ALLOWED_ROOTS = {'app.js','server.js','package.json','package-lock.json','controller','middleware','model','route','utils','frontend','admin','RELEASE_COMMIT','RELEASE_MANIFEST.json'}

def command(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def healthy():
    for _ in range(30):
        try:
            c = http.client.HTTPConnection('127.0.0.1', 5000, timeout=3)
            c.request('GET', '/api/v1/health/ready')
            r = c.getresponse(); data = json.loads(r.read()); c.close()
            ready = data.get('data',{})
            if r.status != 200 or not ready.get('ready') or ready.get('environment') != 'production' or ready.get('authenticationVersion') != 1:
                raise ValueError('Authentication is not production-ready')
            c = LocalHTTPS(PUBLIC_HOST,timeout=3)
            c.request('GET','/api/v1/auth/config'); r=c.getresponse(); data=json.loads(r.read()); cookie=r.getheader('Set-Cookie',''); c.close()
            if r.status != 200 or data.get('data',{}).get('googleClientId') != PRODUCTION_CLIENT or '__Host-kq_browser=' not in cookie or 'Secure' not in cookie or 'HttpOnly' not in cookie or 'Domain=' in cookie:
                raise ValueError('Public authentication contract failed')
            for page in ['/', '/admin/', '/privacy']:
                web=LocalHTTPS(PUBLIC_HOST,timeout=3);web.request('GET',page);response=web.getresponse();body=response.read();web.close()
                if response.status != 200 or b'id="root"' not in body: raise ValueError('Website page unavailable')
            return True
        except (OSError, ValueError, http.client.HTTPException):
            pass
        time.sleep(2)
    return False

def activate(path):
    policy.activate(BASE,path)

def deploy(commit, expected_hash):
    if not re.fullmatch('[0-9a-f]{40}', commit) or not re.fullmatch('[0-9a-f]{64}', expected_hash):
        raise ValueError('Invalid release identifier')
    if not CONFIG.is_file():
        raise RuntimeError('Protected production configuration is missing')
    configuration_hash = hashlib.sha256(CONFIG.read_bytes()).hexdigest()
    current = BASE / 'current'
    previous = current.resolve() if current.is_symlink() else None
    if previous and (previous / 'RELEASE_COMMIT').read_text().strip() == commit and healthy():
        print('Release is already healthy:', commit)
        return
    release = pathlib.Path(tempfile.mkdtemp(prefix=commit[:12]+'-', dir=BASE / 'releases'))
    release.chmod(0o755)
    archive = release / 'artifact.tar.gz'
    switched = False
    try:
        boto3.client('s3', region_name='ap-southeast-1').download_file(BUCKET, f'releases/{commit}.tar.gz', str(archive))
        with archive.open('rb') as f:
            digest = hashlib.file_digest(f, 'sha256').hexdigest()
        if digest != expected_hash:
            raise RuntimeError('Deployment archive checksum mismatch')
        with tarfile.open(archive, 'r:gz') as tar:
            members = tar.getmembers()
            total = 0
            for m in members:
                p = pathlib.PurePosixPath(m.name)
                if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0] not in ALLOWED_ROOTS:
                    raise ValueError('Unexpected archive path')
                if not (m.isfile() or m.isdir()) or any(part.startswith('.env') or part == 'config.env' for part in p.parts):
                    raise ValueError('Unexpected archive entry')
                if p.parts[0] in {'frontend','admin'} and len(p.parts)>1 and p.parts[1]!='dist':
                    raise ValueError('Only built frontends may be deployed')
                total += m.size
            if total > 512 * 1024 * 1024:
                raise ValueError('Deployment archive is too large')
            tar.extractall(release, members=members, filter='data')
        archive.unlink()
        if (release / 'RELEASE_COMMIT').read_text().strip() != commit:
            raise ValueError('Release metadata mismatch')
        policy.validate_release(release, commit)
        for required in ['server.js','package-lock.json','frontend/dist/index.html','admin/dist/index.html']:
            if not (release / required).is_file():
                raise ValueError('Required release file is missing')
        voting = pwd.getpwnam('voting')
        for directory, folders, files in os.walk(release):
            os.chown(directory, voting.pw_uid, voting.pw_gid)
            for name in folders + files:
                os.chown(pathlib.Path(directory)/name, voting.pw_uid, voting.pw_gid)
        env = {'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/var/lib/king-queen-voting','NODE_ENV':'production','npm_config_cache':'/var/lib/king-queen-voting/.npm'}
        command('/usr/sbin/runuser','-u','voting','--','/usr/local/bin/npm','ci','--omit=dev','--no-audit','--no-fund',cwd=release,env=env,timeout=600)
        (release/'config.env').symlink_to('/etc/king-queen-voting/config.env')
        # This check reads the selected database; it never seeds, starts a worker or sends email.
        command('/usr/sbin/runuser','-u','voting','--','/usr/local/bin/node','utils/accounts/health.js',str(CONFIG),cwd=release,env={**env,'AUTH_ENVIRONMENT':'production'},timeout=20,stdout=subprocess.DEVNULL)
        (release/'.configuration-sha256').write_text(configuration_hash+'\n')
        (release/'.configuration-sha256').chmod(0o400)
        command('/usr/sbin/nginx','-t',stdout=subprocess.DEVNULL)
        command('/usr/bin/systemctl','stop',SERVICE)
        activate(release)
        switched = True
        command('/usr/bin/systemctl','reset-failed',SERVICE)
        command('/usr/bin/systemctl','start',SERVICE)
        if not healthy():
            raise RuntimeError('Backend did not become healthy')
        for directory, folders, files in os.walk(release):
            os.chown(directory, 0, 0)
            for name in folders + files:
                p=pathlib.Path(directory)/name
                if not p.is_symlink():
                    os.chown(p,0,0)
        command('/usr/bin/systemctl','reload','nginx')
        keep={release, previous}
        for old in (BASE/'releases').iterdir():
            if old.is_dir() and old not in keep:
                shutil.rmtree(old)
        print('Deployment healthy:', commit)
    except Exception:
        if switched:
            result=policy.recover(BASE,previous,configuration_hash,
                lambda: command('/usr/bin/systemctl','stop',SERVICE),
                lambda: command('/usr/bin/systemctl','start',SERVICE), healthy)
            if result != 'restored':
                # Fail closed. Do not start legacy code against cookie-auth data.
                current.unlink(missing_ok=True)
            print('Recovery result:',result)
        shutil.rmtree(release, ignore_errors=True)
        raise

if __name__ == '__main__':
    with open('/run/lock/king-queen-voting-deploy.lock','w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            if len(sys.argv)!=3:
                raise ValueError('Expected commit and archive checksum')
            deploy(*sys.argv[1:])
        except Exception as exc:
            print('Deployment failed:', type(exc).__name__, str(exc), file=sys.stderr)
            sys.exit(1)
