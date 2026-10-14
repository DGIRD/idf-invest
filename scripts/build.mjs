// Build Immo-Zen : bundle esbuild + copie des fichiers statiques + service worker versionné.
// Usage : node scripts/build.mjs [--serve]
// Variables lues depuis l'environnement ou un fichier .env (jamais commité) :
//   IMMOZEN_ENV                 development | test | production
//   IMMOZEN_SUPABASE_URL        URL du projet Supabase
//   IMMOZEN_SUPABASE_ANON_KEY   clé publique (anon / publishable) – JAMAIS la clé service_role
//   IMMOZEN_BASE_PATH           chemin de publication (ex. /idf-invest/ sur GitHub Pages), défaut ./
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serve = process.argv.includes('--serve');
const out = join(root, 'dist');

function loadDotEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv();

const env = {
  IMMOZEN_ENV: process.env.IMMOZEN_ENV || (serve ? 'development' : 'production'),
  IMMOZEN_SUPABASE_URL: process.env.IMMOZEN_SUPABASE_URL || '',
  IMMOZEN_SUPABASE_ANON_KEY: process.env.IMMOZEN_SUPABASE_ANON_KEY || '',
};

// Garde-fou : refuser toute clé secrète dans le frontend.
function assertPublicKey(key) {
  if (!key) return;
  if (/^sb_secret_/i.test(key)) throw new Error('IMMOZEN_SUPABASE_ANON_KEY contient une clé secrète (sb_secret_…). Utilisez la clé publique.');
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') throw new Error('IMMOZEN_SUPABASE_ANON_KEY est une clé service_role. Utilisez la clé anon.');
    } catch (e) {
      if (e instanceof Error && e.message.includes('service_role')) throw e;
    }
  }
}
assertPublicKey(env.IMMOZEN_SUPABASE_ANON_KEY);

const define = Object.fromEntries(Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]));

const options = {
  entryPoints: [join(root, 'src/main.tsx')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  sourcemap: env.IMMOZEN_ENV !== 'production',
  minify: env.IMMOZEN_ENV === 'production',
  define,
  outdir: join(out, 'assets'),
  entryNames: serve ? 'app' : 'app-[hash]',
  assetNames: '[name]-[hash]',
  loader: { '.css': 'css' },
  metafile: true,
  logLevel: 'info',
  legalComments: 'none',
};

function writeShell(jsFile, cssFile) {
  const html = readFileSync(join(root, 'src/index.html'), 'utf8')
    .replace('%APP_CSS%', cssFile ? `<link rel="stylesheet" href="assets/${cssFile}">` : '')
    .replace('%APP_JS%', `<script type="module" src="assets/${jsFile}"></script>`);
  writeFileSync(join(out, 'index.html'), html);
}

function writeServiceWorker(files, version) {
  // Ne met en cache que les fichiers statiques de l'application – jamais les réponses API.
  const sw = readFileSync(join(root, 'src/service-worker.template.js'), 'utf8')
    .replace('__CACHE_VERSION__', version)
    .replace('__FILES__', JSON.stringify(files));
  writeFileSync(join(out, 'service-worker.js'), sw);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'public'), out, { recursive: true });

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.rebuild();
  writeShell('app.js', 'app.css');
  writeServiceWorker([], 'dev');
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: Number(process.env.PORT || 5173), host: '127.0.0.1' });
  console.log(`Immo-Zen (${env.IMMOZEN_ENV}) : http://127.0.0.1:${port}/`);
} else {
  const result = await esbuild.build(options);
  const outputs = Object.keys(result.metafile.outputs).map((p) => p.split('/').pop());
  const js = outputs.find((f) => f.startsWith('app-') && f.endsWith('.js'));
  const css = outputs.find((f) => f.startsWith('app-') && f.endsWith('.css'));
  writeShell(js, css);
  const statics = ['./', 'index.html', 'manifest.webmanifest', ...readdirSync(join(out)).filter((f) => f.endsWith('.png')), `assets/${js}`, ...(css ? [`assets/${css}`] : [])];
  const version = createHash('sha256').update(statics.join('|') + js).digest('hex').slice(0, 12);
  writeServiceWorker(statics, version);
  console.log(`Build ${env.IMMOZEN_ENV} terminé → dist/ (cache ${version})${env.IMMOZEN_SUPABASE_URL ? '' : ' – AUCUN projet Supabase configuré : mode démonstration local uniquement'}`);
}
