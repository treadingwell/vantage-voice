// Downloads the offline speech models listed in src/speech/models/catalog.json into
// public/models/ so they deploy alongside the app (GitHub Pages serves them with CORS,
// unlike GitHub release downloads). public/models/ is gitignored; files already present
// are skipped.
//
// Usage: node scripts/fetch-models.mjs
import { createWriteStream, existsSync, mkdirSync, copyFileSync, renameSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'src/speech/models/catalog.json'), 'utf8'));
const outRoot = join(root, 'public', 'models');

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

// The sherpa runtime WASM comes from the pinned npm package
const runtimeDir = join(outRoot, catalog.runtime.dir);
mkdirSync(runtimeDir, { recursive: true });
copyFileSync(
  join(root, 'node_modules/sherpa-onnx/sherpa-onnx-wasm-nodejs.wasm'),
  join(runtimeDir, 'sherpa.wasm')
);
console.log('runtime: sherpa.wasm copied');

// GitHub Pages rejects files over 100 MB, so catalog "parts" files are served in pieces
// (name.part0, name.part1, ...) that the app joins back together while downloading
function partPaths(model, dir, f) {
  const n = model.parts?.[f];
  return n ? Array.from({ length: n }, (_, i) => join(dir, `${f}.part${i}`)) : [join(dir, f)];
}

function splitFile(path, parts) {
  const data = readFileSync(path);
  const size = Math.ceil(data.length / parts.length);
  parts.forEach((p, i) => writeFileSync(p, data.subarray(i * size, (i + 1) * size)));
  rmSync(path);
}

for (const model of catalog.models) {
  const dir = join(outRoot, model.dir);
  // A whole copy of a split file (from before it was split) only needs splitting
  for (const f of Object.keys(model.parts ?? {})) {
    if (existsSync(join(dir, f))) splitFile(join(dir, f), partPaths(model, dir, f));
  }
  const missing = model.files.filter((f) => !partPaths(model, dir, f).every((p) => existsSync(p)));
  if (missing.length === 0) {
    console.log(`${model.id}: up to date`);
    continue;
  }

  if (model.source.type === 'http') {
    for (const f of missing) {
      await download(`${model.source.url}/${f}`, join(dir, f));
    }
  } else if (model.source.type === 'tar') {
    const work = mkdtempSync(join(tmpdir(), 'vantage-models-'));
    try {
      const archive = join(work, 'model.tar.bz2');
      await download(model.source.url, archive);
      // bsdtar (Windows, macOS) and GNU tar both read bzip2. Relative paths, because
      // GNU tar treats "C:\..." as a remote host.
      execFileSync('tar', ['-xjf', 'model.tar.bz2'], { cwd: work, stdio: 'inherit' });
      for (const f of missing) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        copyFileSync(join(work, model.source.root, f), join(dir, f));
        if (model.parts?.[f]) splitFile(join(dir, f), partPaths(model, dir, f));
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  console.log(`${model.id}: fetched ${missing.length} file(s)`);
}
