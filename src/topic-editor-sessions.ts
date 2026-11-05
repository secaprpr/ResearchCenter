const captures = new Set<() => void>();
export function registerTopicEditor(capture: () => void) { captures.add(capture); return () => { captures.delete(capture); }; }
export function captureTopicEditors() { for (const capture of [...captures]) capture(); }
