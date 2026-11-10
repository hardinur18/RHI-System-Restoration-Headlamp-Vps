// Transitional relay for provider retries to old Supabase webhook URLs.
// Deploy only AFTER the VPS is synchronized and ready to receive callbacks.
// Signatures and raw bytes remain intact; the VPS performs provider validation.
Deno.serve(async (request) => {
  const source = new URL(request.url);
  const slug = source.pathname.split('/').find(part =>
    part === 'meta-messaging-webhook' || part === 'kirimdev-messaging-webhook');
  if (!slug || !['GET', 'POST'].includes(request.method)) {
    return new Response('Not found', { status: 404 });
  }
  const target = new URL('https://api-rhi.polesheadlamp.id/functions/v1/' + slug);
  target.search = source.search;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.delete('connection');
  try {
    return await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    // Never acknowledge an event the destination has not accepted.
    return new Response('Destination temporarily unavailable', {
      status: 503, headers: { 'Retry-After': '30' },
    });
  }
});
