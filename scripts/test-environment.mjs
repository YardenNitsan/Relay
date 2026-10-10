// Test-process setup only. Never imported by the production host.
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// macOS /var and Windows RUNNER~1 aliases are valid OS temp locations, but
// model-visible workspace roots deliberately reject aliases. Normalize the
// fixture parent before creating anything, including in inherited child envs.
const canonicalTemporaryDirectory = realpathSync.native(tmpdir());
for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = canonicalTemporaryDirectory;
