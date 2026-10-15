/** Disk sizes in decimal units, like Finder and Explorer: "92 GB", "41.7 GB", "530 MB". */
export function diskSize(bytes: number): string {
  if (bytes >= 100e9) return `${(bytes / 1e9).toFixed(0)} GB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

/** RAM sizes in binary units, like Activity Monitor and Task Manager: "36.4 GB", "512 MB". */
export function ramSize(bytes: number): string {
  const g = bytes / 1024 ** 3;
  const m = bytes / 1024 ** 2;
  if (g >= 100) return `${g.toFixed(0)} GB`;
  if (g >= 1) return `${g.toFixed(1)} GB`;
  if (m >= 1) return `${m.toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
