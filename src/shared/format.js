export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1));
  return `${(bytes / 1024 ** index).toLocaleString('zh-TW', { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`;
}
