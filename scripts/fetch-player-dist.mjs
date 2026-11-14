import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The web player is not downloaded from another project. The local coming-soon
// page is what the server serves until a player is placed in public/player.
const comingSoonHtml = join(dirname(fileURLToPath(import.meta.url)), 'player-coming-soon.html');
const targetDir = join(process.cwd(), 'public', 'player');
const indexPath = join(targetDir, 'index.html');
await fs.mkdir(targetDir, { recursive: true });
try {
  await fs.access(indexPath);
} catch {
  const page = await fs.readFile(comingSoonHtml);
  await fs.writeFile(indexPath, page);
}
