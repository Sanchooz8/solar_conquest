// Assemble le jeu en un seul fichier : dist/index.html (à glisser sur Netlify).
// Usage : npm run build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'client');
const html = readFileSync(join(client, 'index.html'), 'utf8');
const css = readFileSync(join(client, 'style.css'), 'utf8');

const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const js = scripts.map(f => readFileSync(join(client, f), 'utf8')).join('\n')
  .replace("const APP_VERSION = 'dev';", `const APP_VERSION = '${version}';`);

let out = html
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
  .replace(/\s*<script src="js\/[^"]+"><\/script>/g, '')
  .replace('</body>', () => `<script>\n${js}\n</script>\n</body>`);

// Images (illustrations du tutoriel) : intégrées au fichier unique
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' };
let images = 0;
out = out.replace(/src="(img\/[^"]+\.(webp|png|jpe?g|svg))"/g, (m, f, ext) => {
  images++;
  return `src="data:${MIME[ext]};base64,${readFileSync(join(client, f)).toString('base64')}"`;
});

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), out);
console.log(`dist/index.html : version ${version}, ${scripts.length} scripts, ${images} images, ${(out.length / 1024).toFixed(0)} Ko`);
