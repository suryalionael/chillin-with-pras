// Access to the Cloudflare Worker environment (D1, R2, vars).
//
// `cloudflare:workers` only exists inside the Worker. It is imported lazily so
// the static build (which prerenders the public site in Node) never loads it.
export async function getEnv(): Promise<Cloudflare.Env> {
  const { env } = await import('cloudflare:workers');
  return env as Cloudflare.Env;
}
