import hashlib, importlib.util, json, pathlib, subprocess, tempfile, unittest
HERE=pathlib.Path(__file__).parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
release=load('release','make-release.py');policy=load('policy','release-policy.py')
class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def repo(self):
        for name in release.RUNTIME:
            p=self.root/name
            if '.' not in name:
                p.mkdir();(p/'fixture.js').write_text('// fixture')
            else:p.write_text('{}' if name.endswith('.json') else '// fixture')
        subprocess.run(['git','init','-q'],cwd=self.root,check=True)
        subprocess.run(['git','add','.'],cwd=self.root,check=True)
        subprocess.run(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],cwd=self.root,check=True)
        commit=release.clean_commit(self.root)
        for site in ['frontend','admin']:
            p=self.root/site/'dist';p.mkdir(parents=True);(p/'index.html').write_text('<div id="root"></div>')
        release.stamp(self.root,commit);return commit
    def test_exact_commit_and_stale_build_refusal(self):
        commit=self.repo();archive=self.root/'out.tar.gz'
        first=release.package(self.root,archive);self.assertEqual(first,release.package(self.root,archive))
        import tarfile
        with tarfile.open(archive) as t:
            self.assertFalse(any('config.env' in n or 'node_modules' in n for n in t.getnames()))
            out=self.root/'unpack'
            for member in t.getmembers():
                target=out/member.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(t.extractfile(member).read())
        self.assertEqual(policy.validate_release(out,commit)['commit'],commit)
        (self.root/'frontend/dist/index.html').write_text('changed')
        with self.assertRaises(ValueError):release.package(self.root,archive)
    def test_dirty_or_untracked_runtime_refused(self):
        self.repo();(self.root/'server.js').write_text('changed')
        with self.assertRaises(ValueError):release.clean_commit(self.root)
    def test_atomic_activation_and_compatible_recovery(self):
        base=self.root;old=base/'old';new=base/'new';old.mkdir();new.mkdir()
        (old/'RELEASE_MANIFEST.json').write_text(json.dumps({'compatibility':release.COMPATIBILITY}))
        (old/'.configuration-sha256').write_text('config')
        policy.activate(base,new);actions=[]
        result=policy.recover(base,old,'config',lambda:actions.append('stop'),lambda:actions.append('start'),lambda:True)
        self.assertEqual(result,'restored');self.assertEqual((base/'current').resolve(),old.resolve());self.assertEqual(actions,['stop','start'])
        policy.activate(base,new)
        self.assertEqual(policy.recover(base,old,'changed',lambda:None,lambda:self.fail('must not start'),lambda:True),'stopped-incompatible')
        (old/'RELEASE_MANIFEST.json').write_text('{}')
        self.assertFalse(policy.rollback_allowed(old,'config'))
    def test_unhealthy_rollback_stops_service(self):
        old=self.root/'old';old.mkdir();(old/'RELEASE_MANIFEST.json').write_text(json.dumps({'compatibility':release.COMPATIBILITY}));(old/'.configuration-sha256').write_text('config')
        actions=[];result=policy.recover(self.root,old,'config',lambda:actions.append('stop'),lambda:actions.append('start'),lambda:False)
        self.assertEqual(result,'stopped-unhealthy');self.assertEqual(actions,['stop','start','stop'])
if __name__=='__main__':unittest.main()
