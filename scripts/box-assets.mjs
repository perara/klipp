// Keep the setup page's font local, including its SIL Open Font License.
import { cpSync } from 'node:fs';
cpSync('src/box/ui/assets', 'dist/box/ui/assets', { recursive: true });
