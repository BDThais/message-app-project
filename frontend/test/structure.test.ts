import { describe, expect, it } from 'vitest';

// Rules from "Conventions" in frontend.doc.md that a slip breaks without anything else failing.
// These read the source of every file in src/ and test/ as text (a Vite glob, so no Node types are needed).
const sourceFiles = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const testFiles = import.meta.glob('/test/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

/** Everything a file imports from: `from '...'`, `import '...'` and `import('...')`. */
function importedFrom(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

/** "<file> imports <specifier>" for each import in the files of `folder` whose specifier matches `forbidden`. */
function violations(folder: string, forbidden: RegExp): string[] {
  return Object.entries(sourceFiles)
    .filter(([file]) => file.startsWith(`/src/${folder}`))
    .flatMap(([file, source]) =>
      importedFrom(source)
        .filter((specifier) => forbidden.test(specifier))
        .map((specifier) => `${file} imports ${specifier}`),
    );
}

describe('the layout of src/', () => {
  it('has no test file: vitest.config.ts only runs test/, so one in src/ would never run', () => {
    const strays = Object.keys(sourceFiles).filter((file) => /\.test\.tsx?$/.test(file));
    expect(strays, 'move these to test/, in the same folders as the files they test').toEqual([]);
  });

  it('keeps lib/ and components/ free of imports from features/ and routes/', () => {
    const forbidden = /(^|\/)(features|routes)\//;
    expect([...violations('lib/', forbidden), ...violations('components/', forbidden)]).toEqual([]);
  });

  it('never imports anything from test/', () => {
    expect(violations('', /(^|\/)test\//)).toEqual([]);
  });
});

describe('the way into the server\'s folder', () => {
  // Only the API's shapes (server/src/contract/) are shared with the server, through the @contract/
  // alias. Anything else from server/ would pull the database client or Express into the browser bundle.
  const everyFile = { ...sourceFiles, ...testFiles };

  it('goes through @contract/ and nothing else: no import path reaches into server/', () => {
    const reaching = Object.entries(everyFile).flatMap(([file, source]) =>
      importedFrom(source)
        .filter((specifier) => /(^|\/)server(\/|$)/.test(specifier))
        .map((specifier) => `${file} imports ${specifier}`),
    );
    expect(reaching, 'import the shape from @contract/... instead').toEqual([]);
  });

  it('takes only types from @contract/: `import type`, not `import { type X }`, which still loads the file', () => {
    // `import { type X } from '...'` keeps an empty import of the module under verbatimModuleSyntax, and
    // a value from the contract would need the dev server to serve a file outside the frontend folder.
    const valueImport = /(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]@contract\//;
    const sideEffectImport = /import\s+['"]@contract\//;
    const offenders = Object.entries(everyFile)
      .filter(([, source]) => valueImport.test(source) || sideEffectImport.test(source))
      .map(([file]) => file);
    expect(offenders, 'write `import type { ... } from \'@contract/...\'`').toEqual([]);
  });
});
