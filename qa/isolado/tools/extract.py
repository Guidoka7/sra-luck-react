#!/usr/bin/env python3
"""Extrai o último resultado de execute_sql (Supabase MCP) que contém MARKER do transcript.
Uso: extract.py MARKER FIELD > arquivo.sql   (concatena FIELD de todas as linhas)"""
import json, re, sys
path = '/root/.claude/projects/-home-user-sra-luck-react/5f8a4ea9-a954-566a-a721-0d205eb0b0ca.jsonl'
marker, field = sys.argv[1], sys.argv[2]
last = None
def texts(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, list):
        for x in obj: yield from texts(x)
    elif isinstance(obj, dict):
        for k, v in obj.items(): yield from texts(v)
with open(path) as f:
    for line in f:
        if marker not in line: continue
        try: rec = json.loads(line)
        except Exception: continue
        if rec.get('type') != 'user': continue
        for t in texts(rec.get('message', {}).get('content', [])):
            if marker in t and 'untrusted-data' in t:
                last = t
if not last: sys.exit('not found')
outer = json.loads(last)['result'] if last.lstrip().startswith('{') else last
m = re.search(r'<untrusted-data-[0-9a-f-]+>\n(\[.*?\])\n</untrusted-data', outer, re.S)
rows = json.loads(m.group(1))
sys.stdout.write('\n'.join(str(r[field]) for r in rows if r.get(field) is not None) + '\n')
