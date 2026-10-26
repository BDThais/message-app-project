// The server's Postgres INTEGER ceiling; the frontend cannot import the server's constant (see "API contract" in frontend.doc.md).
const MAX_ID = 2_147_483_647;

/** The id in a `/chat/:chatId` path, or null for anything the API would answer 400 to. */
export function parseChatId(param: string): number | null {
  if (!/^[1-9]\d*$/.test(param)) return null;
  const id = Number(param);
  return id <= MAX_ID ? id : null;
}
