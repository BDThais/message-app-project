import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// What keeps the contract the single source of truth: the three ways code could go around it. They
// read the source as text, so a slip fails here before it fails anywhere else.
const src = new URL('../../src/', import.meta.url);

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'generated') return [];
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
    return entry.isDirectory() ? sourceFiles(url) : entry.name.endsWith('.ts') ? [url] : [];
  });
}

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const files = sourceFiles(src).map((url) => ({ name: url.pathname.split('/src/')[1] ?? url.pathname, code: withoutComments(readFileSync(url, 'utf8')) }));

describe('how the server uses the contract', () => {
  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('types the response of every controller handler: `res: Response<...>`, not a bare `Response` that accepts any body', () => {
    const untyped = files
      .filter((file) => file.name.endsWith('.controller.ts'))
      .flatMap((file) => [...file.code.matchAll(/export async function (\w+)\([^)]*res: Response\s*[,)]/g)].map((match) => `${file.name}: ${match[1]}`));

    expect(untyped, 'write res: Response<TheContractsBody | ApiErrorBody>').toEqual([]);
  });

  it('has no ! on req.user or req.chatMembership: a handler is mounted with withUser or withChatMembership instead', () => {
    const assertions = files.filter((file) => /req\.(user|chatMembership)!/.test(file.code)).map((file) => file.name);

    expect(assertions).toEqual([]);
  });

  it('reads req.body and req.query only through a validator or bodyFields, never by hand', () => {
    const byHand = files.flatMap((file) =>
      file.code
        .split('\n')
        .filter((line) => /req\.(body|query)\b/.test(line))
        .filter((line) => !/(validate\w*|bodyFields<\w+>)\(\s*req\.(body|query)\b/.test(line))
        .map((line) => `${file.name}: ${line.trim()}`),
    );

    expect(byHand).toEqual([]);
  });
});
