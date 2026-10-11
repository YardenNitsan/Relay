"""One-time exclusive freeze before any v2 test results are inspected."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(__file__).resolve().parent
report = json.loads((ROOT / 'output/final-evolution/semantic-calibration-v2.json').read_text(encoding='utf-8'))
with (BASE / 'calibration-v2.json').open('x',encoding='utf-8') as stream:
    stream.write(json.dumps(report,indent=2)+'\n')
first = json.loads((BASE / 'freeze-v1.json').read_text(encoding='utf-8'))
names = ['candidates.py','baseline.ts','calibrate-v2.py','calibration-v2.json','evaluate-v2.py',
         'protocol-v2.md','heldout-v2.json','development-v1.json','heldout-v1.json','freeze-v2.py']
paths = [BASE / name for name in names] + [ROOT / 'benchmarks/task-intent/development-v1.json',ROOT / 'server/models/intent-phrases.ts']
hashes = {p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest() for p in paths}
manifest = {'protocol':'relay-semantic-comparison-v2','frozenAt':datetime.now(timezone.utc).isoformat(),
            'selectedOnConsumedDevelopment':report['selected'],'model':first['candidates'][report['selected']]['model'],
            'hashEncoding':'bytes with CRLF normalized to LF','hashes':hashes,
            'gate':{'minimumImprovement':8,'minimumSatisfiedFraction':.65,'maximumExtraForbidden':2,
                    'p95LimitMs':250,'rssLimitBytes':int(1.5*1024**3),'initializationLimitMs':30000}}
with (BASE / 'freeze-v2.json').open('x',encoding='utf-8') as stream:
    stream.write(json.dumps(manifest,indent=2)+'\n')
print('Frozen v2 without reading test objectives or running inference.')
