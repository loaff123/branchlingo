"""Linux test harness: kernel-deny socket/connect, then exercise CLI and API.

This harness is test-only. It is not loaded by the runtime package.
"""
import ctypes
import errno
import json
import pathlib
import socket
import subprocess
import sys
import tempfile

root = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[1]
seccomp = ctypes.CDLL('libseccomp.so.2', use_errno=True)
seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
seccomp.seccomp_init.restype = ctypes.c_void_p
seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
context = seccomp.seccomp_init(0x7FFF0000)
assert context, 'seccomp initialization failed'
try:
    for syscall in [b'socket', b'connect']:
        number = seccomp.seccomp_syscall_resolve_name(syscall)
        assert number >= 0
        assert seccomp.seccomp_rule_add(context, 0x00050000 | errno.EPERM, number, 0) == 0
    assert seccomp.seccomp_load(context) == 0, 'seccomp filter could not be installed'
finally:
    seccomp.seccomp_release(context)
for family in (socket.AF_INET, socket.AF_INET6):
    try:
        socket.socket(family, socket.SOCK_STREAM)
    except PermissionError as error:
        assert error.errno == errno.EPERM
    else:
        raise AssertionError('network socket was not kernel-denied')

def node(*args):
    result = subprocess.run(['node', *map(str, args)], cwd=root, text=True, capture_output=True, timeout=35)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout

with tempfile.TemporaryDirectory(prefix='branchlingo-offline-') as directory:
    pack = pathlib.Path(directory) / 'pack.json'
    report = pathlib.Path(directory) / 'report.json'
    node(root / 'bin/branchlingo.mjs', 'generate', root / 'examples/manifest.json', '--out', pack)
    node(root / 'bin/branchlingo.mjs', 'replay', pack, '--manifest', root / 'examples/manifest.json', '--out', report)
    assert json.loads(pack.read_text())['status'] == 'complete'
    assert json.loads(report.read_text())['status'] == 'verified'
    script = """
import fs from 'node:fs';
import {analyzeCatalog,generateCases,replayCases} from './src/index.mjs';
const manifestBytes=fs.readFileSync('./examples/manifest.json');
const bytes=fs.readFileSync('./examples/files.json');
const input={manifestBytes,catalogsById:new Map(['en','fr','ja'].map(id=>[id,bytes]))};
const a=await analyzeCatalog(input);if(a.status!=='analyzed')throw Error(JSON.stringify(a));
const p=await generateCases(a.analysis);if(p.status!=='complete')throw Error(JSON.stringify(p));
const r=await replayCases({...input,packBytes:Buffer.from(JSON.stringify(p))});
if(r.status!=='verified')throw Error(JSON.stringify(r));
console.log('API verified under inherited kernel network denial');
"""
    node('--input-type=module', '-e', script)
print(json.dumps({'kernelDenied': ['socket', 'connect'], 'ipv4Probe': 'EPERM', 'ipv6Probe': 'EPERM', 'cliGenerate': 'complete', 'cliReplay': 'verified', 'apiReplay': 'verified'}))
