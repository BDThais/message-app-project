import { describe, expect, it } from 'vitest';

// Rules from "Conventions" in frontend.doc.md that a slip breaks without anything else failing.
// These read the source of every file in src/ as text (a Vite glob, so no Node types are needed).
const sourceFiles = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
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
