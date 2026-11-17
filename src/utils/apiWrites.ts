// Opt-in lifecycle observation for local draft guards. No request payloads or
// credentials are exposed to observers; successful writes acknowledge snapshots.
type Observer = (path: string, method: string) => (() => void) | undefined;
const observers = new Set<Observer>();
export function observeAPIWrites(observer: Observer) {
  observers.add(observer);
  return () => { observers.delete(observer); };
}
export function beginAPIWrite(path: string, method: string): () => void {
  if (method === "GET" || method === "HEAD" || !observers.size) return () => {};
  const acknowledgements: Array<() => void> = [];
  for (const observer of observers) {
    try { const acknowledge = observer(path, method); if (acknowledge) acknowledgements.push(acknowledge); }
    catch { /* An optional UI observer must never prevent an API request. */ }
  }
  return () => { for (const acknowledge of acknowledgements) { try { acknowledge(); } catch {} } };
}
