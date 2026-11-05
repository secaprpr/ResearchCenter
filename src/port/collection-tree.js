const PATH = '.workbench/collection-tree.json';
const empty = () => ({ version: 1, nodes: [], collapsed: [] });

export function normalizeCollectionTree(raw, names) {
  const known = new Set(names), seen = new Set(), nodes = [];
  for (const node of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    if (!node || !known.has(node.name) || seen.has(node.name)) continue;
    seen.add(node.name); nodes.push({ name: node.name, parent: known.has(node.parent) && node.parent !== node.name ? node.parent : null });
  }
  for (const name of names) if (!seen.has(name)) { seen.add(name); nodes.push({ name, parent: null }); }
  const byName = new Map(nodes.map(node => [node.name, node]));
  for (const node of nodes) {
    const visited = new Set([node.name]); let parent = node.parent;
    while (parent !== null) {
      if (visited.has(parent)) { node.parent = null; break; }
      visited.add(parent); parent = byName.get(parent)?.parent ?? null;
    }
  }
  return { version: 1, nodes, collapsed: [...new Set((Array.isArray(raw?.collapsed) ? raw.collapsed : []).filter(name => known.has(name)))] };
}

export function canMoveCollection(tree, name, target, position) {
  if (!['inside', 'before', 'after', 'root'].includes(position)) return false;
  const byName = new Map(tree.nodes.map(node => [node.name, node]));
  if (!byName.has(name) || name === target || (position !== 'root' && !byName.has(target))) return false;
  let parent = position === 'root' ? null : position === 'inside' ? target : byName.get(target).parent;
  while (parent !== null) { if (parent === name) return false; parent = byName.get(parent)?.parent ?? null; }
  return true;
}

export function moveCollection(tree, name, target, position) {
  if (!canMoveCollection(tree, name, target, position)) throw new Error('不能将文献集放入自身或其子文献集。');
  const nodes = tree.nodes.filter(node => node.name !== name).map(node => ({ ...node }));
  const targetNode = nodes.find(node => node.name === target);
  const parent = position === 'root' ? null : position === 'inside' ? target : targetNode.parent;
  let index = nodes.length;
  if (position === 'before' || position === 'after') index = nodes.findIndex(node => node.name === target) + (position === 'after' ? 1 : 0);
  nodes.splice(index, 0, { name, parent });
  return { ...tree, nodes, collapsed: position === 'inside' ? tree.collapsed.filter(value => value !== target) : tree.collapsed };
}

export function collectionRows(tree) {
  const children = new Map();
  for (const node of tree.nodes) { const group = children.get(node.parent) || []; group.push(node); children.set(node.parent, group); }
  const rows = [];
  const visit = (parent, depth) => {
    for (const node of children.get(parent) || []) {
      const hasChildren = children.has(node.name), collapsed = tree.collapsed.includes(node.name);
      rows.push({ ...node, depth, hasChildren, collapsed });
      if (!collapsed) visit(node.name, depth + 1);
    }
  };
  visit(null, 0); return rows;
}

export function createCollectionTree({ vault }) {
  let state = empty(), queue = Promise.resolve(), loadError = null;
  const listeners = new Set(), attached = new WeakSet();
  let getNames = () => [];
  const view = () => normalizeCollectionTree(state, getNames().slice().sort((a, b) => a.localeCompare(b, 'zh-CN')));
  const publish = () => listeners.forEach(listener => listener());
  const transact = (change, action = async () => {}) => {
    const task = queue.then(async () => {
      if (loadError) throw loadError;
      const previous = state, next = change(view());
      await vault.adapter.write(PATH, JSON.stringify(next, null, 2));
      let result;
      try { result = await action(); }
      catch (error) { await vault.adapter.write(PATH, JSON.stringify(previous, null, 2)); throw error; }
      state = next; publish(); return result;
    });
    queue = task.catch(() => {}); return task;
  };
  const api = {
    async load() {
      if (!await vault.adapter.exists(PATH)) return;
      try {
        const raw = JSON.parse(await vault.adapter.read(PATH));
        if (raw.version !== 1 || !Array.isArray(raw.nodes)) throw new Error('文献集层级文件格式无效');
        state = raw; loadError = null; publish();
      } catch (error) { loadError = new Error('文献集层级读取失败：' + error.message); throw loadError; }
    },
    view, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    move(name, target, position) { return transact(tree => moveCollection(tree, name, target, position)); },
    toggle(name) { return transact(tree => ({ ...tree, collapsed: tree.collapsed.includes(name) ? tree.collapsed.filter(value => value !== name) : [...tree.collapsed, name] })); },
    reveal(name) { return transact(tree => {
      const parents = new Map(tree.nodes.map(node => [node.name, node.parent])), ancestors = new Set();
      let parent = parents.get(name); while (parent) { ancestors.add(parent); parent = parents.get(parent); }
      return { ...tree, collapsed: tree.collapsed.filter(value => !ancestors.has(value)) };
    }); },
    attach(model) {
      getNames = () => model.allOrganizationNames('collection');
      if (attached.has(model)) return; attached.add(model);
      const create = model.createOrganizationEntity.bind(model), rename = model.renameOrganizationEntity.bind(model), remove = model.deleteOrganizationEntity.bind(model);
      model.createOrganizationEntity = async (type, name) => {
        if (type !== 'collection') return create(type, name);
        const clean = model.cleanOrganizationName(name);
        const existing = getNames().find(value => value.toLowerCase() === clean.toLowerCase());
        if (existing) return create(type, name);
        return transact(tree => ({ ...tree, nodes: [...tree.nodes, { name: clean, parent: null }] }), () => create(type, name));
      };
      model.renameOrganizationEntity = async (type, name, nextName) => {
        if (type !== 'collection') return rename(type, name, nextName);
        const clean = model.cleanOrganizationName(nextName);
        if (name !== clean && getNames().some(value => value !== name && value.toLowerCase() === clean.toLowerCase())) throw new Error('该文献集名称已存在。');
        return transact(tree => ({ ...tree, nodes: tree.nodes.map(node => ({ name: node.name === name ? clean : node.name, parent: node.parent === name ? clean : node.parent })), collapsed: tree.collapsed.map(value => value === name ? clean : value) }), () => rename(type, name, nextName));
      };
      model.deleteOrganizationEntity = async (type, name) => {
        if (type !== 'collection') return remove(type, name);
        return transact(tree => {
          const parent = tree.nodes.find(node => node.name === name)?.parent ?? null;
          const children = tree.nodes.filter(node => node.parent === name).map(node => ({ ...node, parent }));
          return { ...tree, nodes: tree.nodes.flatMap(node => node.name === name ? children : node.parent === name ? [] : [node]), collapsed: tree.collapsed.filter(value => value !== name) };
        }, () => remove(type, name));
      };
    },
  };
  return api;
}
