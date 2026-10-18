export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
