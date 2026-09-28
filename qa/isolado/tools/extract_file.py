#!/usr/bin/env python3
"""Extrai FIELD do resultado salvo de execute_sql (arquivo tool-results)."""
import json, re, sys
raw = open(sys.argv[1]).read()
field = sys.argv[2]
try:
    obj = json.loads(raw)
    outer = obj['result'] if isinstance(obj, dict) else obj
    if isinstance(outer, list):
        outer = ''.join(x.get('text', '') for x in outer)
        try: outer = json.loads(outer)['result']
        except Exception: pass
except Exception:
    outer = raw
m = re.search(r'<untrusted-data-[0-9a-f-]+>\n(\[.*?\])\n</untrusted-data', outer, re.S)
rows = json.loads(m.group(1))
sys.stdout.write('\n'.join(str(r[field]) for r in rows if r.get(field) is not None) + '\n')
