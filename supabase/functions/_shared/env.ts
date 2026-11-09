// Reading configuration in the Deno edge runtime.

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function envNumber(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name) ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
