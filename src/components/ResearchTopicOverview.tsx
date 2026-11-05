import { type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowUpRight, MoreHorizontal, Plus, Star } from 'lucide-react';
import { STATUS_LABEL, type RecordItem } from '../types';
import { topicData } from '../topics';
import { processEvents, TASK_STATUS } from '../research-tasks';

export function ResearchTopicOverview({projects,choose,context,create}:{projects:RecordItem[];choose:(id:string)=>void;create:()=>void;context:(event:MouseEvent<HTMLElement>|KeyboardEvent<HTMLElement>,topic:RecordItem)=>void}) {
  return <nav className="rt-project-overview" aria-label="课题总览列表"><div className="rt-project-overview-rows">{projects.map(project=>{
    const data=topicData(project),tasks=data.tasks||[],latest=[...tasks].sort((a,b)=>b.updatedAt-a.updatedAt)[0];
    const progress=latest&&processEvents(latest).sort((a,b)=>(b.occurredAt??b.recordedAt)-(a.occurredAt??a.recordedAt))[0];
    const next=tasks.find(t=>t.status==='running'&&t.nextStep)?.nextStep||data.nextStep;
    return <article key={project.id} className="rt-project-summary" onContextMenu={e=>context(e,project)}>
      <button className="rt-project-summary-open" onClick={()=>choose(project.id)}>
        <span className="rt-topic-card-state">{project.starred&&<Star size={12} fill="currentColor"/>}{STATUS_LABEL[project.status]}<ArrowUpRight size={16}/></span>
        <strong>{project.title}</strong><span className="rt-topic-card-question">{data.question||data.focus||'尚未填写研究问题'}</span>
        <span className="rt-topic-card-latest"><small>最近进展</small>{latest?<><span>{progress?.title||latest.title}</span><time>{new Date(progress?.occurredAt??latest.updatedAt).toLocaleDateString('zh-CN')}<span> · {TASK_STATUS[latest.status]}</span></time></>:<span className="is-empty">尚无节点</span>}</span>
        {next&&<span className="rt-topic-card-next"><small>下一步</small><span>{next}</span></span>}
        <span className="rt-topic-card-foot"><span>{tasks.length} 节点<span> · </span>{data.papers.length} 论文</span><span>{tasks.filter(t=>t.status==='running').length} 进行中</span></span>
      </button><button className="rt-icon rt-topic-card-menu" aria-label="课题操作" aria-haspopup="menu" onClick={e=>context(e,project)}><MoreHorizontal size={16}/></button>
    </article>;
  })}<button className="rt-topic-create-card" aria-label="创建新课题" onClick={create}><Plus size={20}/><span>新建课题</span></button></div></nav>;
}
