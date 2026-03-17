import type { ToolId } from 'tsdraw-core';
import { IconEraser, IconHandStop, IconPencil, IconPointer } from '@tabler/icons-react';

interface ToolbarProps {
  currentTool: ToolId;
  onToolChange: (tool: ToolId) => void;
}

export function Toolbar({ currentTool, onToolChange }: ToolbarProps) {
  return (
    <div className="tsdraw-toolbar">
      <button
        type="button"
        className="tsdraw-toolbar-btn"
        data-active={currentTool === 'select' ? 'true' : undefined}
        onClick={() => onToolChange('select')}
        title="Select"
        aria-label="Select"
      >
        <IconPointer
          size={18}
          stroke={1.8}
          fill={currentTool === 'select' ? 'currentColor' : 'none'}
        />
      </button>
      <button
        type="button"
        className="tsdraw-toolbar-btn"
        data-active={currentTool === 'pen' ? 'true' : undefined}
        onClick={() => onToolChange('pen')}
        title="Pen"
        aria-label="Pen"
      >
        <IconPencil
          size={18}
          stroke={1.8}
          fill={currentTool === 'pen' ? 'currentColor' : 'none'}
        />
      </button>
      <button
        type="button"
        className="tsdraw-toolbar-btn"
        data-active={currentTool === 'eraser' ? 'true' : undefined}
        onClick={() => onToolChange('eraser')}
        title="Eraser"
        aria-label="Eraser"
      >
        <IconEraser
          size={18}
          stroke={1.8}
          fill={currentTool === 'eraser' ? 'currentColor' : 'none'}
        />
      </button>
      <button
        type="button"
        className="tsdraw-toolbar-btn"
        data-active={currentTool === 'hand' ? 'true' : undefined}
        onClick={() => onToolChange('hand')}
        title="Hand"
        aria-label="Hand"
      >
        <IconHandStop
          size={18}
          stroke={currentTool === 'hand' ? 1 : 1.8}
          fill={currentTool === 'hand' ? 'currentColor' : 'none'}
          style={currentTool === 'hand' ? { stroke: '#000000' } : undefined}
        />
      </button>
    </div>
  );
}
