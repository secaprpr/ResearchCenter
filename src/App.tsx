import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { TopBar } from './components/TopBar';
import { Dashboard } from './components/Dashboard';
import { RecordsView } from './components/RecordsView';
import { TodayWorkspace } from './components/TodayWorkspace';
import { ScheduleView } from './components/ScheduleView';
import { SettingsView } from './components/SettingsView';
import { EditorModal } from './components/EditorModal';
import { EDITOR_EVENT, type EditorRequest } from './editorBus';
import { LibraryView } from './components/LibraryView';
import { useLibraryStore } from './library/store';
import { PortLibraryView } from './components/PortLibraryView';
import { ResearchTopics } from './components/ResearchTopics';

export default function App() {
  const { view, types } = useStore();
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [openedTaskTypes, setOpenedTaskTypes] = useState<string[]>([]);
  const type = types.find((t) => t.id === view);
  useEffect(() => {
    if (type?.kind === 'todo') setOpenedTaskTypes(previous => previous.includes(type.id) ? previous : [...previous, type.id]);
  }, [type?.id, type?.kind]);

  useEffect(() => { void useLibraryStore.getState().load(); }, []);

  useEffect(() => {
    const handler = (e: Event) => setEditor((e as CustomEvent<EditorRequest>).detail ?? {});
    window.addEventListener(EDITOR_EVENT, handler);
    return () => window.removeEventListener(EDITOR_EVENT, handler);
  }, []);

  const taskTypes = [...new Set([...openedTaskTypes, ...(type?.kind === 'todo' ? [type.id] : [])])].filter(id => types.some(item => item.id === id && item.kind === 'todo'));

  return (
    <div className={`app ${view === 'library' ? 'library-mode' : type?.kind === 'project' ? 'topics-mode' : ''}`}>
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <div className="main">
          <TopBar />
          <main className={`content ${view === 'library' || type?.kind === 'todo' ? 'content-port' : type?.kind === 'project' ? 'content-topics' : ''}`}>
            <div className="port-library-workspace" hidden={view !== 'library'}><PortLibraryView /></div>
            {taskTypes.map(id => <div key={id} className="today-workspace-slot" hidden={view !== id}><TodayWorkspace typeId={id} active={view === id} /></div>)}
            {view === 'library' ? null : view === 'library-basic' ? (
              <><button className="btn btn-ghost btn-sm" onClick={() => useStore.getState().setView('library')}>← 返回文献工作区</button>
              <LibraryView />
              </>
            ) : view === 'settings' ? (
              <SettingsView />
            ) : view === 'dashboard' || !type ? (
              <Dashboard />
            ) : type.kind === 'project' ? (
              <ResearchTopics typeId={type.id} />
            ) : type.kind === 'todo' ? (
              null
            ) : type.kind === 'schedule' ? (
              <ScheduleView typeId={type.id} />
            ) : (
              <RecordsView typeId={type.id} />
            )}
          </main>
        </div>
      </div>
      {editor && <EditorModal request={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}
