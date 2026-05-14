import type { CSSProperties, ReactNode } from 'react';
import type { ToolId } from '@tsdraw/core';
import { IconArrowBackUp, IconArrowForwardUp, IconEraser, IconHandStop, IconPencil, IconPointer, IconSquare, IconCircle } from '@tabler/icons-react';
import { BaseComponent, type ComponentDragEndPayload } from './BaseComponent.js';

export interface ToolbarToolItem {
  type: 'tool';
  id: ToolId;
  label: string;
  icon: ReactNode | ((isActive: boolean) => ReactNode);
}

export interface ToolbarActionItem {
  type: 'action';
  id: 'undo' | 'redo';
  label: string;
  disabled: boolean;
  onSelect: () => void;
}

export type ToolbarRenderItem = ToolbarToolItem | ToolbarActionItem;

export interface ToolbarPart {
  id: string;
  items: ToolbarRenderItem[];
}

interface ToolbarProps {
  parts: ToolbarPart[];
  currentTool: ToolId | null;
  onToolChange: (tool: ToolId) => void;
  disabled?: boolean;
  style?: CSSProperties;
  orientation?: 'horizontal' | 'vertical';
  draggable?: boolean;
  onDragEnd?: (payload: ComponentDragEndPayload) => void;
}

export function getDefaultToolbarIcon(toolId: ToolId, isActive: boolean): ReactNode {
  if (toolId === 'select') return <IconPointer size={18} stroke={1.75} fill={isActive ? 'currentColor' : 'none'} />;
  if (toolId === 'pen') return <IconPencil size={18} stroke={1.75} fill={isActive ? 'currentColor' : 'none'} />;
  if (toolId === 'square') return <IconSquare size={18} stroke={1.75} fill={isActive ? 'currentColor' : 'none'} />;
  if (toolId === 'circle') return <IconCircle size={18} stroke={1.75} fill={isActive ? 'currentColor' : 'none'} />;
  if (toolId === 'eraser') return <IconEraser size={18} stroke={1.75} fill={isActive ? 'currentColor' : 'none'} />;
  if (toolId === 'hand') return <IconHandStop size={18} stroke={isActive ? 1 : 1.75} fill={isActive ? 'currentColor' : 'none'} />;
  return null;
}

function getActionIcon(actionId: 'undo' | 'redo'): ReactNode {
  if (actionId === 'undo') return <IconArrowBackUp size={18} stroke={1.75} />;
  return <IconArrowForwardUp size={18} stroke={1.75} />;
}

export function Toolbar({ parts, currentTool, onToolChange, disabled, style, orientation='horizontal', draggable=false, onDragEnd }: ToolbarProps) {
  const orientationClass = orientation === 'vertical' ? ' tsdraw-toolbar--vertical' : '';

  return (
    <BaseComponent className={`tsdraw-toolbar${orientationClass}`} style={style} draggable={draggable} onDragEnd={onDragEnd}>
      {parts.map((part, partIndex) => (
        <div key={part.id} className="tsdraw-toolbar-part">
          {part.items.map((item) => {
            if (item.type === 'action') {
              return (
                <button
                  key={item.id}
                  type="button"
                  className="tsdraw-toolbar-btn"
                  onClick={item.onSelect}
                  title={item.label}
                  aria-label={item.label}
                  disabled={disabled || item.disabled}
                >
                  {getActionIcon(item.id)}
                </button>
              );
            }

            const isActive = currentTool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className="tsdraw-toolbar-btn"
                data-active={isActive ? 'true' : undefined}
                onClick={() => onToolChange(item.id)}
                title={item.label}
                aria-label={item.label}
                disabled={disabled}
              >
                {typeof item.icon === 'function' ? item.icon(isActive) : item.icon}
              </button>
            );
          })}
          {partIndex < parts.length - 1 ? <div className="tsdraw-toolbar-separator" /> : null}
        </div>
      ))}
    </BaseComponent>
  );
}
