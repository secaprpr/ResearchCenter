import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import './context-menu.css';

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  action?: () => void;
  children?: MenuAction[];
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
}
interface MenuState { id: number; x: number; y: number; trigger: HTMLElement; label: string; items: MenuAction[] }

/** Shared by the workbench and the embedded literature workspace. */
export function useContextMenu() {
  const [state, setState] = useState<MenuState | null>(null);
  const sequence = useRef(0);
  const close = useCallback((restore = false, trigger?: HTMLElement) => {
    setState(null);
    if (restore && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, []);
  const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, items: MenuAction[], label: string) => {
    event.preventDefault(); event.stopPropagation();
    const trigger = event.currentTarget;
    const rect = trigger.getBoundingClientRect();
    const mouse = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
    document.dispatchEvent(new Event('workbench-close-context-menu'));
    setState({ id: ++sequence.current, x: mouse ? event.clientX : rect.left + 12, y: mouse ? event.clientY : rect.bottom, trigger, label, items });
  };
  useEffect(() => {
    const dismiss = () => close();
    document.addEventListener('workbench-close-context-menu', dismiss);
    return () => document.removeEventListener('workbench-close-context-menu', dismiss);
  }, [close]);
  return { open, close, menu: state ? <ActionMenu key={state.id} state={state} onClose={close} /> : null };
}

function ActionMenu({ state, onClose }: { state: MenuState; onClose: (restore?: boolean, trigger?: HTMLElement) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [trail, setTrail] = useState<Array<{ label: string; items: MenuAction[]; index: number }>>([]);
  const [position, setPosition] = useState({ x: state.x, y: state.y });
  const current = trail.at(-1) || state;
  const focusIndex = useRef(0);
  useLayoutEffect(() => {
    const rect = root.current!.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(state.y, window.innerHeight - rect.height - 8)) });
    const buttons = root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    (buttons[focusIndex.current] || buttons[0])?.focus();
    focusIndex.current = 0;
  }, [state, trail]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    const scroll = (event: Event) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss); };
  }, [onClose]);
  const back = () => {
    focusIndex.current = trail.at(-1)?.index || 0;
    setTrail(previous => previous.slice(0, -1));
  };
  return createPortal(<div ref={root} role="menu" aria-label={current.label} className="workbench-context-menu" style={{ left: position.x, top: position.y }}
    onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(true, state.trigger); return; }
      if (event.key === 'ArrowLeft' && trail.length) { event.preventDefault(); back(); return; }
      const items = [...root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup') === 'menu') { event.preventDefault(); (document.activeElement as HTMLButtonElement).click(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
    {trail.length ? <button role="menuitem" className="context-menu-back" onClick={back}><ChevronLeft size={15} /><span>{current.label}</span></button> : <div className="context-menu-heading" title={state.label}>{state.label}</div>}
    {current.items.map((item, index) => <div key={`${item.label}-${index}`}>
      {item.separator && <div role="separator" className="context-menu-divider" />}
      <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} aria-haspopup={item.children ? 'menu' : undefined} disabled={item.disabled} className={item.danger ? 'is-danger' : undefined}
        onClick={event => {
          if (item.children) { const buttons = [...root.current!.querySelectorAll('button:not(:disabled)')]; setTrail(previous => [...previous, { label: item.label, items: item.children!, index: buttons.indexOf(event.currentTarget) }]); }
          else { onClose(true, state.trigger); item.action?.(); }
        }}>
        <span className="context-menu-icon">{item.icon}</span><span className="context-menu-label">{item.label}</span>
        {item.checked && <Check size={14} />}{item.children && <ChevronRight size={14} />}
      </button>
    </div>)}
  </div>, document.body);
}
