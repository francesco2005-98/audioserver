import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// The admin interface is not downloaded from another project. A checkout that
// already has public/admin is left as it is; otherwise a short placeholder is written
// so the server still has a page to serve.
const targetDir = join(process.cwd(), 'public', 'admin');
const indexPath = join(targetDir, 'index.html');
await fs.mkdir(targetDir, { recursive: true });
try {
  await fs.access(indexPath);
} catch {
  await fs.writeFile(
    indexPath,
    '<!doctype html><meta charset="utf-8"><title>Audioserver</title><p>The admin interface is not included in this build.</p>\n',
  );
}
