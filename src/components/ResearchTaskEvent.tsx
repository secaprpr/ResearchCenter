import { Check, ChevronDown, MoreHorizontal } from 'lucide-react';
import { safeTaskUrl, taskTime, type TaskEvent } from '../research-tasks';

export function ResearchTaskEvent({ event, taskId, inline, menu, edit, showDetails = false, toggleDetails }: {
  event: TaskEvent;
  taskId: string;
  inline: boolean;
  menu: (event: React.MouseEvent<HTMLElement>) => void;
  edit?: () => void;
  showDetails?: boolean;
  toggleDetails?: () => void;
}) {
  const stamp = taskTime(event.occurredAt);
  const fields = <div className="rt-field-capsules">{event.fields.map(field => (
    <span className={`rt-field-capsule ${['通过', '成功', '已完成'].includes(field.value) ? 'is-positive' : ''}`} key={field.id}>
      <span>{field.label}</span>
      {field.type === 'url' && safeTaskUrl(field.value)
        ? <a href={field.value} target="_blank" rel="noreferrer">{field.value}</a>
        : <span title={field.value}>{field.value}</span>}
    </span>
  ))}</div>;
  const provenance = <footer>由 {event.source} 记录 · {taskTime(event.recordedAt)}{event.evidence && <span>时间依据：{event.evidence}</span>}</footer>;
  return <article data-event-owner={inline ? taskId : undefined} className={`rt-event ${event.status === 'completed' ? 'is-completed' : ''} ${showDetails ? 'is-expanded' : ''}`}>
    {!inline && <span className="rt-event-node">{event.status === 'completed' && <Check size={12} strokeWidth={3} />}</span>}
    <time className={inline ? 'rtl-date rtl-event-date' : 'rt-event-time'} dateTime={event.occurredAt === null ? undefined : new Date(event.occurredAt).toISOString()} title={stamp}>
      {inline && event.occurredAt !== null
        ? <><span className="rtl-date-year">{stamp.slice(0, 5)}</span><span>{stamp.slice(5, 10)}</span><span className="rtl-date-clock">{stamp.slice(11)}</span></>
        : <span className="rtl-date-unknown">{stamp}</span>}
    </time>
    <div className={`rt-event-body ${event.fields.length || event.description ? 'has-content' : ''}`}>
      <header>
        <h3>{inline ? <button className="rtl-event-toggle" title={event.title} onClick={edit}><span>{event.title}</span></button> : event.title}</h3>
        <div className="rt-event-actions">{inline && (event.description || event.fields.length > 0) && <button className="rt-icon rtl-record-details" aria-label={`${showDetails ? '收起' : '展开'}记录详情 ${event.title}`} aria-expanded={showDetails} title="记录详情" onClick={toggleDetails}><ChevronDown size={13} /></button>}<button className="rt-icon" aria-label={`记录菜单 ${event.title}`} onClick={menu}><MoreHorizontal size={15} /></button></div>
      </header>
      {!inline && event.description && <p>{event.description}</p>}
      {fields}
      {inline && event.description && !event.fields.length && !showDetails && <p className="rtl-event-description" title={event.description}>{event.description}</p>}
      {inline ? showDetails && <div className="rtl-event-extra">{event.description && <p>{event.description}</p>}{provenance}</div> : provenance}
    </div>
  </article>;
}
