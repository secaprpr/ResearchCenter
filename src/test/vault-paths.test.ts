import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { relativePath, inside } = require('../../electron/research-vault.cjs');

describe('迁移存储路径边界', () => {
  it('拒绝父目录穿越、绝对路径和空路径', () => {
    for (const value of ['../original.md', 'Research/../../data.json', 'C:/Users/private.txt', '/private', '', 'x\0y']) expect(() => relativePath(value)).toThrow();
    expect(relativePath('Research\\10 Papers\\example.md')).toBe('Research/10 Papers/example.md');
  });
  it('合法路径只能解析到应用自己管理的目录内', async () => {
    const target = await inside('E:/codex/managed-vault-test', 'Research/10 Papers/example.md');
    expect(target.replaceAll('\\', '/')).toBe('E:/codex/managed-vault-test/Research/10 Papers/example.md');
    await expect(inside('E:/codex/managed-vault-test', '../source-vault/data.json')).rejects.toThrow();
  });
});
