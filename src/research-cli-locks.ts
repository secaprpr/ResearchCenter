const locks = new Map<string, number>();
export function lockCliNode(topicId: string, nodeId: string) {
  const key = `${topicId}\0${nodeId}`; locks.set(key, (locks.get(key) || 0) + 1);
  let released = false;
  return () => { if (released) return; released = true; const count = (locks.get(key) || 1) - 1; if (count) locks.set(key, count); else locks.delete(key); };
}
export function isCliNodeLocked(topicId: string, nodeId?: string) {
  return nodeId ? locks.has(`${topicId}\0${nodeId}`) || locks.has(`${topicId}\0`) : [...locks.keys()].some(key => key.startsWith(`${topicId}\0`));
}
