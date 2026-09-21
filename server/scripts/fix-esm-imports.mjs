import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc leaves relative imports exactly as they are written in the source
// (`from './app'`), but Node's ESM loader needs the real file name
// (`./app.js`) and does not resolve folders (`./modules` -> `./modules/index.js`).
// This script runs after tsc (see the "build" script in package.json) and fixes
// those imports inside dist/. It fails the build when a relative import points
// at nothing, so the problem shows up at build time instead of when
// `npm start` crashes.

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');

// Specifiers that already name a real file are left alone.
const EXPLICIT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.node'];

// Static imports/exports: tsc always starts these at the beginning of a line,
// so anchoring on the keyword keeps comments and strings out of the match.
const STATIC_IMPORT = /^(\s*(?:import|export)\b(?:[^'";]*?\bfrom)?\s*)(['"])(\.{1,2}\/[^'"]+)\2/gm;
// Dynamic imports: `await import('./x')` can appear anywhere on a line.
const DYNAMIC_IMPORT = /(\bimport\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

const problems = [];

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

// Returns the specifier with the extension Node needs, or null if nothing matches.
function resolveSpecifier(fromFile, specifier) {
  if (specifier.includes('?') || EXPLICIT_EXTENSIONS.some((ext) => specifier.endsWith(ext))) {
    return specifier;
  }

  const base = specifier.replace(/\/+$/, '');
  const target = path.resolve(path.dirname(fromFile), base);
  const asFile = { exists: isFile(`${target}.js`), value: `${base}.js` };
  const asFolder = { exists: isFile(path.join(target, 'index.js')), value: `${base}/index.js` };

  // `./dir/` can only mean the folder; otherwise a file wins over a folder, as in TypeScript.
  const candidates = specifier.endsWith('/') ? [asFolder, asFile] : [asFile, asFolder];
  return candidates.find((candidate) => candidate.exists)?.value ?? null;
}

function rewriteRelativeSpecifiers(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');

  const fix = (match, prefix, quote, specifier) => {
    const resolved = resolveSpecifier(filePath, specifier);
    if (resolved === null) {
      problems.push(`${path.relative(rootDir, filePath)}: no file found for '${specifier}'`);
      return match;
    }
    return `${prefix}${quote}${resolved}${quote}`;
  };

  const rewritten = source.replace(STATIC_IMPORT, fix).replace(DYNAMIC_IMPORT, fix);

  if (rewritten !== source) {
    fs.writeFileSync(filePath, rewritten);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.js')) {
      rewriteRelativeSpecifiers(fullPath);
    }
  }
}

if (fs.existsSync(distDir)) {
  walk(distDir);
}

if (problems.length > 0) {
  console.error('fix-esm-imports: relative imports in dist/ that point at nothing:');
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}
