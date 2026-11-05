import { Search, Plus, Upload } from 'lucide-react';
import { useStore } from '../store';
import { requestEditor } from '../editorBus';
import { LIBRARY_IMPORT_EVENT, useLibraryStore } from '../library/store';

export function TopBar() {
  const { search, setSearch, workspaces, workspaceFilter, setWorkspaceFilter, view, types } = useStore();
  const library = useLibraryStore();
  const isLibrary = view === 'library-basic';

  const currentType = types.find((t) => t.id === view);

  if (view === 'library' || currentType?.kind === 'project' || currentType?.kind === 'todo') return null;

  return (
    <div className="topbar">
      <div className="search-box">
        <Search size={15} color="#a8a294" />
        <input
          value={isLibrary ? library.query : search}
          onChange={(e) => isLibrary ? useLibraryStore.setState({ query: e.target.value }) : setSearch(e.target.value)}
          aria-label={isLibrary ? '搜索文献' : '搜索记录'}
          placeholder={isLibrary ? '搜索标题、作者、标签或备注…' : '搜索标题、正文、自定义字段…'}
        />
      </div>
      {!isLibrary && <select
        className="workspace-select"
        value={workspaceFilter}
        onChange={(e) => setWorkspaceFilter(e.target.value)}
        aria-label="工作区筛选"
      >
        <option value="all">全部工作区</option>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>}
      <div className="topbar-spacer" />
      {isLibrary ? <button className="btn btn-primary" disabled={library.importing || library.loading || !!library.error}
        onClick={() => window.dispatchEvent(new Event(LIBRARY_IMPORT_EVENT))}><Upload size={15} />{library.importing ? '正在导入…' : '导入 PDF'}</button> : view !== 'settings' && (
        <button
          className="btn btn-primary"
          onClick={() => requestEditor(currentType ? { typeId: currentType.id } : {})}
        >
          <Plus size={15} />
          {currentType ? `新建${currentType.name}` : '新建记录'}
        </button>
      )}
    </div>
  );
}
