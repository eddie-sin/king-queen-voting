#!/usr/bin/env python3
"""One entry point builds the clean commit and stamps matching frontend assets."""
import argparse, importlib.util, pathlib, subprocess
spec=importlib.util.spec_from_file_location('release',pathlib.Path(__file__).with_name('make-release.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parents[1];commit=release.clean_commit(root)
    for site,extra in [('frontend',[]),('admin',['--','--base=/admin/'])]:
        subprocess.run(['npm','--prefix',site,'run','build',*extra],cwd=root,check=True)
    if release.clean_commit(root)!=commit: raise ValueError('Source changed during build')
    release.stamp(root,commit);release.package(root,args.output)
if __name__=='__main__': main()
