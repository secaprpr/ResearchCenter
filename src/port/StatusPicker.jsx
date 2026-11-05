import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Archive, Check, CirclePlay, Clock3, Layers2 } from 'lucide-react';
import { READING_STATES } from './reading-status.js';
import './status-picker.css';

const icons = { inbox: Layers2, queued: Clock3, reading: CirclePlay, read: Check, archived: Archive };

export function StatusPicker({ value, onChange, disabled = false, label = '论文阅读状态' }) {
  const status = Object.hasOwn(READING_STATES, value) ? value : 'inbox';
  const Icon = icons[status];
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); };
  return <>
    <button ref={trigger} type="button" className={`rw-status-pill state-${status}`} aria-label={label} aria-description={`当前状态：${READING_STATES[status]}`}
      aria-haspopup="listbox" aria-expanded={open} disabled={disabled} title="更改阅读状态"
      onClick={event => { event.stopPropagation(); setOpen(!open); }} onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setOpen(true); }
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
      }}><Icon size={13} strokeWidth={1.8} /><span className="rw-state">{READING_STATES[status]}</span></button>
    {open && !disabled && createPortal(<StatusMenu value={status} trigger={trigger} close={close} choose={next => { close(true); if (next !== status) onChange(next); }} />, document.body)}
  </>;
}

function StatusMenu({ value, trigger, close, choose }) {
  const menu = useRef(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const anchor = trigger.current.getBoundingClientRect();
    const rect = menu.current.getBoundingClientRect();
    const top = anchor.bottom + 6 + rect.height <= innerHeight - 8 ? anchor.bottom + 6 : anchor.top - rect.height - 6;
    setPosition({ left: Math.max(8, Math.min(anchor.left, innerWidth - rect.width - 8)), top: Math.max(8, Math.min(top, innerHeight - rect.height - 8)) });
    menu.current.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  }, [trigger]);
  useEffect(() => {
    const dismiss = event => { if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false); };
    const scroll = event => { if (!menu.current?.contains(event.target)) close(false); };
    const resize = () => close(false);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize); };
  }, [close, trigger]);
  return <div ref={menu} className="rw-status-menu" role="listbox" aria-label="阅读状态选项" style={position} onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (['Escape', 'Tab'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); close(true); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const options = [...menu.current.querySelectorAll('[role="option"]')];
        const index = options.indexOf(document.activeElement);
        options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus({ preventScroll: true });
      }
    }}>
    <div className="rw-status-menu-heading">阅读状态</div>
    {Object.entries(READING_STATES).map(([key, text]) => { const StateIcon = icons[key]; return <button type="button" key={key} role="option" aria-selected={value === key} tabIndex={value === key ? 0 : -1} onClick={() => choose(key)}>
      <span className={`rw-status-menu-icon state-${key}`}><StateIcon size={15} strokeWidth={1.8} /></span><span>{text}</span>{value === key && <Check size={14} className="rw-status-current" />}
    </button>; })}
  </div>;
}

export function mountStatusPicker(host, props) {
  const root = createRoot(host);
  root.render(<StatusPicker {...props} />);
  return { update: next => root.render(<StatusPicker {...next} />) };
}
