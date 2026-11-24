// Bundles src/ into web/ (embedded by the Go server) and standalone/bpmn-editor.html.
import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');

await fs.mkdir(web, { recursive: true });
await fs.copyFile(path.join(root, 'src/index.html'), path.join(web, 'index.html'));

await esbuild.build({
  entryPoints: [ path.join(root, 'src/app.js') ],
  bundle: true,
  minify: true,
  format: 'iife',
  target: [ 'es2020' ],
  outdir: web,
  entryNames: 'app',
  loader: { '.bpmn': 'text', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl', '.svg': 'dataurl' },
  legalComments: 'eof',
  logLevel: 'info'
});

const js = await fs.readFile(path.join(web, 'app.js'), 'utf8');
const css = await fs.readFile(path.join(web, 'app.css'), 'utf8');
let html = await fs.readFile(path.join(web, 'index.html'), 'utf8');
html = html
  .replace('<link rel="stylesheet" href="app.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
await fs.mkdir(path.join(root, 'standalone'), { recursive: true });
await fs.writeFile(path.join(root, 'standalone', 'bpmn-editor.html'), html);
console.log('standalone/bpmn-editor.html', (html.length / 1024).toFixed(0), 'KB');
