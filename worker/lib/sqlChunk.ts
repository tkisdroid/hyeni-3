export function chunkSqlVariables<T>(items: readonly T[], maxPerChunk: number): T[][] {
  const size = Math.max(1, Math.floor(maxPerChunk));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
