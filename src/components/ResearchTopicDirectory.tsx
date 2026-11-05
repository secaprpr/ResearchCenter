import { Archive, ChevronDown, Code2, LayoutGrid, ListChecks, MoreHorizontal, Plus, Star, X } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { RecordItem, Workspace } from '../types';
import { topicData } from '../topics';

interface Props {
  projects:RecordItem[]; workspaces:Workspace[]; workspace:string; setWorkspace:(id:string)=>void;
  selected:string; home:boolean; allTasks:boolean; archived:boolean; open:boolean;
  choose:(id:string)=>void; overview:()=>void; tasks:()=>void; create:()=>void; close:()=>void; archive:()=>void; cli:()=>void;
  context:(event:MouseEvent<HTMLElement>|KeyboardEvent<HTMLElement>,topic:RecordItem)=>void;
}
export function ResearchTopicDirectory({projects,workspaces,workspace,setWorkspace,selected,home,allTasks,archived,open,choose,overview,tasks,create,close,archive,cli,context}:Props) {
  return <aside id="research-topic-directory" className={`rt-directory ${open?'is-open':''}`} aria-label="课题目录">
    <header><span>科研课题</span><button className="rt-icon rt-directory-close" aria-label="收起课题目录" onClick={close}><X size={16}/></button><button className="rt-icon" aria-label="创建课题" title="新建课题" onClick={create}><Plus size={17}/></button></header>
    <label className="rt-directory-workspace"><select aria-label="任务工作区" value={workspace} onChange={e=>setWorkspace(e.target.value)}><option value="all">全部工作区</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><ChevronDown size={13}/></label>
    <nav className="rt-directory-views" aria-label="课题视图"><button aria-label="课题总览" aria-pressed={home&&!archived} onClick={overview}><LayoutGrid size={15}/>课题总览<span>{projects.length}</span></button><button aria-pressed={allTasks} onClick={tasks}><ListChecks size={15}/>全部任务</button></nav>
    <div className="rt-directory-label">{archived?'已归档':'我的课题'}<span>{projects.length}</span></div>
    <nav className="rt-directory-list" aria-label="切换课题">{projects.map(project=>{const tasks=topicData(project).tasks||[],running=tasks.filter(t=>t.status==='running').length;return <div className={`rt-directory-item ${selected===project.id?'is-current':''}`} key={project.id} onContextMenu={e=>context(e,project)}>
      <button className="rt-directory-topic" aria-label={project.title} aria-current={selected===project.id?'page':undefined} onClick={()=>choose(project.id)}><span className="rt-directory-topic-name">{project.starred&&<Star size={11} fill="currentColor"/>}<span>{project.title}</span></span><span className="rt-directory-topic-meta">{running>0?<><i/>{running} 项进行中</>:<>{tasks.length} 个节点</>}</span></button>
      <button className="rt-icon rt-directory-more" aria-label={`课题操作 ${project.title}`} onClick={e=>context(e,project)}><MoreHorizontal size={14}/></button>
    </div>;})}{!projects.length&&<p className="rt-directory-empty">{archived?'暂无归档课题':'暂无课题'}</p>}</nav>
    <footer><button aria-pressed={archived} onClick={archive}><Archive size={15}/>{archived?'返回我的课题':'已归档课题'}</button><button onClick={cli}><Code2 size={15}/>CLI 接入</button></footer>
  </aside>;
}
