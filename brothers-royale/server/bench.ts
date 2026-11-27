/** El entorno por sí solo nunca arma jugadores. Producción falla de forma explícita. */
export function benchPrefix(env: Record<string, string | undefined> = process.env, args: readonly string[] = process.argv): string | undefined {
  const prefix = env.BR_BENCH_LOADOUT;
  if (!prefix) return undefined;
  if (env.NODE_ENV !== 'test' || !args.includes('--br-bench-loadout')) {
    throw new Error('BR_BENCH_LOADOUT requiere NODE_ENV=test y --br-bench-loadout; prohibido en producción');
  }
  return prefix;
}
