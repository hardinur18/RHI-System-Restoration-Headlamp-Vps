// VPS router for immutable production bundles. No provider actions on startup.
// Staging workers are restricted to this VPS API; the Docker network also has
// no external route. Production mode is enabled only during coordinated cutover.
// Preserve each function's production gateway JWT setting.
type FunctionRecord = { slug: string; verify_jwt: boolean; sha256: string };
const records: FunctionRecord[] = JSON.parse(await Deno.readTextFile('/home/deno/functions/bundles/manifest.json'));
const functions = new Map(records.map(record => [record.slug, record]));
const bundles = new Map<string, Uint8Array>();
const encoder = new TextEncoder();
const deploymentMode = Deno.env.get('RHI_DEPLOYMENT_MODE') || 'staging';
if (!['staging', 'production'].includes(deploymentMode)) throw new Error('Invalid deployment mode');
const internalApi = new URL(Deno.env.get('SUPABASE_URL') || 'https://api-rhi.polesheadlamp.id');
const internalApiHost = internalApi.hostname + ':' + (internalApi.port || (internalApi.protocol === 'https:' ? '443' : '80'));
// An empty allow list is Deno's explicit unrestricted network permission.
// This restores the provider/media access of the original production workers.
const allowedNetworks = deploymentMode === 'production'
  ? [] : [internalApiHost, 'api-gw:8000'];
const jwtSecret = Deno.env.get('JWT_SECRET');
if (!jwtSecret) throw new Error('JWT_SECRET missing');
const jwtKey = await crypto.subtle.importKey('raw', encoder.encode(jwtSecret),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);

function fromBase64Url(input: string) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0));
}

async function validJwt(request: Request) {
  try {
    const header = request.headers.get('authorization') || '';
    if (!header.startsWith('Bearer ')) return false;
    const parts = header.slice(7).split('.');
    if (parts.length !== 3) return false;
    const head = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
    const now = Date.now() / 1000;
    if (head.alg !== 'HS256' || typeof claims.exp !== 'number' || claims.exp <= now) return false;
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)) return false;
    return await crypto.subtle.verify('HMAC', jwtKey, fromBase64Url(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
  } catch {
    return false;
  }
}

Deno.serve(async request => {
  const slug = new URL(request.url).pathname.split('/')[1];
  const record = functions.get(slug);
  if (!record) return Response.json({ error: 'Function not found' }, { status: 404 });
  if (record.verify_jwt && request.method !== 'OPTIONS' && !await validJwt(request)) {
    return Response.json({ error: 'Invalid JWT' }, { status: 401 });
  }
  try {
    let bundle = bundles.get(slug);
    if (!bundle) {
      bundle = await Deno.readFile(`/home/deno/functions/bundles/${slug}.eszip`);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bundle)),
        n => n.toString(16).padStart(2, '0')).join('');
      if (digest !== record.sha256) throw new Error('Bundle checksum mismatch');
      bundles.set(slug, bundle);
    }
    const env = { ...Deno.env.toObject(), SUPABASE_FUNCTION_SLUG: slug };
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${slug}`,
      maybeEszip: bundle,
      envVars: Object.entries(env),
      memoryLimitMb: 256,
      workerTimeoutMs: 400_000,
      cpuTimeSoftLimitMs: 10_000,
      cpuTimeHardLimitMs: 20_000,
      noModuleCache: false,
      permissions: {
        allow_env: ['*'],
        allow_net: allowedNetworks,
      },
    });
    const forwarded = new Request(request);
    forwarded.headers.delete('sb-api-key');
    EdgeRuntime.applySupabaseTag(request, forwarded);
    return await worker.fetch(forwarded);
  } catch (error) {
    // Never log request headers, request data, or the environment.
    console.error('Worker failed', slug, error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Function unavailable' }, { status: 503 });
  }
});
