/**
 * What a typed phone number becomes before it is searched for. The server accepts only the canonical
 * spelling (`+` and digits, see GET /api/friend/search/:tel in api.doc.md) and people type spaces,
 * dashes and brackets; anything else that is wrong is left for the server to refuse.
 */
export function normalizeTel(typed: string): string {
  return typed.replace(/[\s\-()]/g, '');
}
