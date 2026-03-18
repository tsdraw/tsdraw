import type { CSSProperties, ReactNode } from 'react';
import type { ToolId } from '@tsdraw/core';
import { IconEraser, IconHandStop, IconPencil, IconPointer } from '@tabler/icons-react';

export interface ToolbarItem {
  id: ToolId;
  label: string;
  icon: ReactNode | ((isActive: boolean) => ReactNode);
}

interface ToolbarProps {
  items: ToolbarItem[];
  currentTool: ToolId;
  onToolChange: (tool: ToolId) => void;
  style?: CSSProperties;
}

export function getDefaultToolbarIcon(toolId: ToolId, isActive: boolean): ReactNode {
  if (toolId === 'select') return <IconPointer size={16} stroke={1.8} fill={isActive ? 'currentColor' : 'none'} />;
  if (toolId === 'pen') return <IconPencil size={16} stroke={1.8} fill={isActive ? 'currentColor' : 'none'} />;
  if (toolId === 'eraser') return <IconEraser size={16} stroke={1.8} fill={isActive ? 'currentColor' : 'none'} />;
  if (toolId === 'hand') return <IconHandStop size={16} stroke={isActive ? 1 : 1.8} fill={isActive ? 'currentColor' : 'none'} style={isActive ? { stroke: '#000000' } : undefined} />;
  return null;
}

export function Toolbar({ items, currentTool, onToolChange, style }: ToolbarProps) {
  return (
    <div className="tsdraw-toolbar" style={style}>
      {items.map((item) => {
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
          >
            {typeof item.icon === 'function' ? item.icon(isActive) : item.icon}
          </button>
        );
      })}
    </div>
  );
}
