import { expect, it } from 'vitest';
import { normalizeCollectionTree, moveCollection, canMoveCollection, collectionRows, createCollectionTree } from '../port/collection-tree.js';

const flat = names => normalizeCollectionTree(null, names);
it('旧文献集保持根级，修复孤立父节点及循环，不丢失条目', () => {
  const tree = normalizeCollectionTree({ nodes: [{ name: 'A', parent: 'B' }, { name: 'B', parent: 'A' }, { name: 'C', parent: 'gone' }, { name: 'A' }, { name: 'gone' }] }, ['A', 'B', 'C', 'D']);
  expect(collectionRows(tree).map(node => node.name).sort()).toEqual(['A', 'B', 'C', 'D']);
  expect(tree.nodes.find(node => node.name === 'C').parent).toBe(null);
});
it('嵌套、同级排序和移至根级保留整棵子树，拒绝循环', () => {
  let tree = moveCollection(flat(['A', 'B', 'C', 'D']), 'B', 'A', 'inside');
  tree = moveCollection(tree, 'C', 'B', 'inside');
  expect(canMoveCollection(tree, 'A', 'C', 'inside')).toBe(false);
  expect(canMoveCollection(tree, 'A', 'C', 'before')).toBe(false);
  expect(canMoveCollection(tree, 'B', 'B', 'inside')).toBe(false);
  tree = moveCollection(tree, 'D', 'A', 'before');
  expect(collectionRows(tree).map(node => [node.name, node.depth])).toEqual([['D', 0], ['A', 0], ['B', 1], ['C', 2]]);
  tree = moveCollection(tree, 'B', null, 'root');
  expect(collectionRows(tree).map(node => [node.name, node.depth])).toEqual([['D', 0], ['A', 0], ['B', 0], ['C', 1]]);
  expect(() => moveCollection(tree, 'B', 'C', 'after')).toThrow();
});
function fixture() {
  let text, fail = false;
  const names = ['A', 'B', 'C', 'D'];
  const model = { allOrganizationNames: () => [...names], cleanOrganizationName: name => name.trim(),
    createOrganizationEntity: async (_, name) => { names.push(name); return name; },
    renameOrganizationEntity: async (_, name, next) => { if (next === 'fail') throw new Error('model write failed'); names.splice(names.indexOf(name), 1, next); return next; },
    deleteOrganizationEntity: async (_, name) => { names.splice(names.indexOf(name), 1); },
  };
  const vault = { adapter: { exists: async () => !!text, read: async () => text, write: async (_, next) => { if (fail) { fail = false; throw new Error('disk full'); } text = next; } } };
  const tree = createCollectionTree({ vault }); tree.attach(model);
  return { tree, model, vault, failNext: () => { fail = true; }, text: () => text };
}
it('顺序、层级、折叠保存后重开一致；重命名保留子级，删除仅提升子级', async () => {
  const { tree, model, vault } = fixture();
  await tree.move('B', 'A', 'inside'); await tree.move('C', 'B', 'inside'); await tree.toggle('A');
  const again = createCollectionTree({ vault }); await again.load(); again.attach(model);
  expect(again.view()).toEqual(tree.view()); expect(collectionRows(again.view()).map(node => node.name)).toEqual(['A', 'D']);
  await model.renameOrganizationEntity('collection', 'A', 'Renamed');
  expect(again.view().nodes.find(node => node.name === 'B').parent).toBe('Renamed');
  expect(again.view().collapsed).toEqual(['Renamed']);
  await model.deleteOrganizationEntity('collection', 'Renamed');
  expect(collectionRows(again.view()).map(node => [node.name, node.depth])).toEqual([['B', 0], ['C', 1], ['D', 0]]);
});
it('写入失败不修改内存或执行重命名，原模型失败时还原层级文件，之后可重试', async () => {
  const { tree, model, failNext, text } = fixture();
  await tree.move('B', 'A', 'inside'); const before = tree.view(), saved = text();
  failNext(); await expect(model.renameOrganizationEntity('collection', 'A', 'Changed')).rejects.toThrow('disk full');
  expect(tree.view()).toEqual(before); expect(text()).toBe(saved);
  await expect(model.renameOrganizationEntity('collection', 'A', 'fail')).rejects.toThrow('model write failed');
  expect(tree.view()).toEqual(before); expect(text()).toBe(saved);
  await tree.move('C', 'A', 'inside'); expect(tree.view().nodes.find(node => node.name === 'C').parent).toBe('A');
});
