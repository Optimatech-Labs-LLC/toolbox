#!/usr/bin/env python3
"""Compute Subresource Integrity hashes for a tool folder, write them into its index.html,
and record the release in release.txt. Plain Python 3, no dependencies.

Usage: python3 build/release.py evidence-hash 1.0.0
"""
import base64, hashlib, html, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def sri(path):
    with open(path, 'rb') as f:
        return 'sha384-' + base64.b64encode(hashlib.sha384(f.read()).digest()).decode()

def sha256(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()

def main(tool, version):
    folder = os.path.join(ROOT, tool)
    index = os.path.join(folder, 'index.html')
    src = open(index, encoding='utf-8').read()
    referenced = []
    def fix(match):
        tag, before, attr, ref, after = match.groups()
        if ref.startswith(('http:', 'https:', '//')):
            raise SystemExit(f'External resource in {tool}: {ref}')
        target = os.path.normpath(os.path.join(folder, ref))
        if not os.path.exists(target):
            raise SystemExit(f'Missing file referenced by {tool}/index.html: {ref}')
        referenced.append(target)
        before = re.sub(r'\s+integrity="[^"]*"', '', before)
        after = re.sub(r'\s+integrity="[^"]*"', '', after)
        return f'<{tag}{before} {attr}="{ref}"{after} integrity="{sri(target)}"'
    out = re.sub(r'<(script|link)\b([^>]*?)\s(src|href)="([^"]+)"([^>]*)', fix, src)
    open(index, 'w', encoding='utf-8').write(out)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    lines = [f'Optimatech Labs Toolbox: {tool} {version}', f'Built {stamp}', '', 'SHA-256 of every file in this release:', '']
    # Every file that ships with the tool, not only the ones the page links: workers are loaded by script.
    shipped = [os.path.join(folder, n) for n in sorted(os.listdir(folder)) if n not in ('release.txt', 'VERSION') and os.path.isfile(os.path.join(folder, n))]
    # The shell ships with every tool: stylesheet, script, fonts and their licenses.
    shell_dir = os.path.join(ROOT, 'shell')
    shell_files = sorted(os.path.join(dp, f) for dp, _, fs in os.walk(shell_dir) for f in fs if not f.startswith('.'))
    files = []
    for p in [index] + shipped + sorted(set(referenced)) + shell_files:
        if p not in files:
            files.append(p)
    for p in files:
        lines.append(f'{sha256(p)}  {os.path.relpath(p, ROOT)}')
    open(os.path.join(folder, 'release.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    open(os.path.join(folder, 'VERSION'), 'w').write(version + '\n')
    print(f'{tool} {version}: {len(files)} files hashed, integrity attributes written, release.txt updated')

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
