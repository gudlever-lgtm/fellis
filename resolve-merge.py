#!/usr/bin/env python3
"""
Resolves merge conflicts for the business-analytics branch merge.

Strategy per file:
  index.html        — keep production server's version (manages its own build)
  src/App.css       — keep BOTH sides (server changes + our new analytics CSS)
  src/Platform.jsx  — keep BOTH sides (server changes + our analytics code)

Run from /var/www/fellis.eu while in the conflicted merge state:
  python3 resolve-merge.py
"""
import re, sys, os

CONFLICT_RE = re.compile(
    r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]+\n',
    re.DOTALL
)

def accept_both(path):
    """Keep HEAD (server) content first, then MERGE_HEAD (analytics branch) content."""
    with open(path) as f:
        text = f.read()

    if '<<<<<<< HEAD' not in text:
        print(f'  {path}: no conflicts, skipping')
        return

    count = len(CONFLICT_RE.findall(text))
    resolved = CONFLICT_RE.sub(lambda m: m.group(1) + m.group(2), text)

    with open(path, 'w') as f:
        f.write(resolved)
    print(f'  {path}: resolved {count} conflict(s) — kept both sides')

def accept_ours(path):
    """Keep HEAD (production server) version only."""
    with open(path) as f:
        text = f.read()

    if '<<<<<<< HEAD' not in text:
        print(f'  {path}: no conflicts, skipping')
        return

    count = len(CONFLICT_RE.findall(text))
    resolved = CONFLICT_RE.sub(lambda m: m.group(1), text)

    with open(path, 'w') as f:
        f.write(resolved)
    print(f'  {path}: resolved {count} conflict(s) — kept server version')

base = os.path.dirname(os.path.abspath(__file__))

print('Resolving merge conflicts...')
accept_ours(os.path.join(base, 'index.html'))
accept_both(os.path.join(base, 'src/App.css'))
accept_both(os.path.join(base, 'src/Platform.jsx'))

print()
print('Done. Now run:')
print('  git add index.html src/App.css src/Platform.jsx')
print('  git commit -m "Merge business analytics branch"')
