import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The rules for src/contract/ ("API contract" in backend.doc.md). The frontend compiles this
// folder into its own bundle's types, so a slip here breaks the frontend without anything on the
// server failing.
const folder = new URL('../../src/contract/', import.meta.url);
const files = readdirSync(folder).filter((name) => name.endsWith('.ts'));

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('src/contract/', () => {
  it('has files to check', () => {
    expect(files).toContain('types.ts');
  });

  it.each(files)('%s imports only other files of this folder', (name) => {
    const source = readFileSync(new URL(name, folder), 'utf8');
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

    // `./types`, never `../lib/...`, `express` or the Prisma client: the frontend has none of them.
    expect(specifiers.filter((specifier) => !/^\.\/[\w-]+$/.test(specifier))).toEqual([]);
  });

  it.each(files)('%s has no Date: on the wire a timestamp is an ISO 8601 string', (name) => {
    const source = withoutComments(readFileSync(new URL(name, folder), 'utf8'));

    expect(source).not.toMatch(/\bDate\b/);
  });
});
