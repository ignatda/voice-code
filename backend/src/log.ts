const ts = () => new Date().toISOString().split('T')[1].slice(0, -1);

export function log(message: string, sid?: string): void {
  const prefix = `[${ts()}]`;
  console.log(sid ? `${prefix} ${message}, sid=${sid.slice(0, 8)}` : `${prefix} ${message}`);
}

export function logError(message: string, sid?: string): void {
  const prefix = `[${ts()}]`;
  console.error(sid ? `${prefix} ${message}, sid=${sid.slice(0, 8)}` : `${prefix} ${message}`);
}
