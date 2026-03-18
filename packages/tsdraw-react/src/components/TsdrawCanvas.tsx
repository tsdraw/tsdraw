import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ColorStyle, DashStyle, DefaultToolId, SizeStyle, ToolDefinition, ToolId } from '@tsdraw/core';
import { SelectionOverlay } from './SelectionOverlay.js';
import { StylePanel } from './StylePanel.js';
import { ToolOverlay } from './ToolOverlay.js';
import { Toolbar, getDefaultToolbarIcon, type ToolbarItem } from './Toolbar.js';
import {
  useTsdrawCanvasController,
  type TsdrawCursorContext,
  type TsdrawMountApi,
  type TsdrawToolOverlayState,
} from '../canvas/useTsdrawCanvasController.js';

const DEFAULT_TOOL_IDS: DefaultToolId[] = ['select', 'pen', 'eraser', 'hand'];

const DEFAULT_TOOL_LABELS: Record<DefaultToolId, string> = {
  select: 'Select',
  pen: 'Pen',
  eraser: 'Eraser',
  hand: 'Hand',
};

type VerticalPart = 'top' | 'bottom' | 'center';
type HorizontalPart = 'left' | 'right' | 'center';
export type UiAnchor = | `${VerticalPart}-${HorizontalPart}` | `${HorizontalPart}-${VerticalPart}`;

function parseAnchor(anchor: UiAnchor): { vertical: VerticalPart; horizontal: HorizontalPart } {
  const parts = anchor.split('-') as string[];
  let vertical: VerticalPart = 'center';
  let horizontal: HorizontalPart = 'center';
  for (const part of parts) {
    if (part === 'top' || part === 'bottom') vertical = part;
    else if (part === 'left' || part === 'right') horizontal = part;
  }
  return { vertical, horizontal };
}

export interface TsdrawCustomTool {
  id: ToolId;
  label: string;
  icon: ReactNode;
  iconSelected?: ReactNode;
  definition: ToolDefinition;
  showStylePanel?: boolean;
}

export type TsdrawToolItem = DefaultToolId | TsdrawCustomTool;

export interface TsdrawUiPlacement {
  anchor?: UiAnchor;
  offsetX?: number;
  offsetY?: number;
  style?: CSSProperties;
}

export interface TsdrawUiOptions {
  toolbar?: {
    placement?: TsdrawUiPlacement;
  };
  stylePanel?: {
    placement?: TsdrawUiPlacement;
  };
  customElements?: TsdrawCustomElement[];
  cursor?: {
    getCursor?: (context: TsdrawCursorContext) => string;
  };
  overlays?: {
    renderToolOverlay?: (args: {
      defaultOverlay: ReactNode;
      overlayState: TsdrawToolOverlayState;
      currentTool: ToolId;
    }) => ReactNode;
  };
}

export interface TsdrawCustomElementRenderArgs {
  currentTool: ToolId;
  setTool: (tool: ToolId) => void;
  applyDrawStyle: (partial: Partial<{ color: ColorStyle; dash: DashStyle; size: SizeStyle }>) => void;
}

export interface TsdrawCustomElement {
  id: string;
  placement?: TsdrawUiPlacement;
  render: (args: TsdrawCustomElementRenderArgs) => ReactNode;
}

export interface TsdrawProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  theme?: 'light' | 'dark' | 'system';
  persistenceKey?: string;
  tools?: TsdrawToolItem[];
  initialToolId?: ToolId;
  uiOptions?: TsdrawUiOptions;
  onMount?: (api: TsdrawMountApi) => void | (() => void);
}

export type TsdrawCanvasProps = TsdrawProps;

function isCustomTool(toolItem: TsdrawToolItem): toolItem is TsdrawCustomTool {
  return typeof toolItem !== 'string';
}

function getToolId(toolItem: TsdrawToolItem): ToolId {
  return typeof toolItem === 'string' ? toolItem : toolItem.id;
}

function resolvePlacementStyle(
  placement: TsdrawUiPlacement | undefined,
  fallbackAnchor: UiAnchor,
  fallbackOffsetX: number,
  fallbackOffsetY: number
): CSSProperties {
  const anchor = placement?.anchor ?? fallbackAnchor;
  const offsetX = placement?.offsetX ?? fallbackOffsetX;
  const offsetY = placement?.offsetY ?? fallbackOffsetY;
  const { vertical, horizontal } = parseAnchor(anchor);
  const result: CSSProperties = {};
  const transforms: string[] = [];

  if (horizontal === 'left') {
    result.left = offsetX;
  } else if (horizontal === 'right') {
    result.right = offsetX;
  } else {
    result.left = '50%';
    transforms.push('translateX(-50%)');
    if (offsetX) transforms.push(`translateX(${offsetX}px)`);
  }

  if (vertical === 'top') {
    result.top = offsetY;
  } else if (vertical === 'bottom') {
    result.bottom = offsetY;
  } else {
    result.top = '50%';
    transforms.push('translateY(-50%)');
    if (offsetY) transforms.push(`translateY(${offsetY}px)`);
  }

  if (transforms.length > 0) result.transform = transforms.join(' ');

  return { ...result, ...(placement?.style ?? {}) };
}

export function Tsdraw(props: TsdrawProps) {
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const toolItems = props.tools ?? DEFAULT_TOOL_IDS;
  const customTools = useMemo(
    () => toolItems.filter(isCustomTool),
    [toolItems]
  );
  const toolDefinitions = useMemo(
    () => customTools.map((tool) => tool.definition),
    [customTools]
  );
  const toolbarItems = useMemo<ToolbarItem[]>(
    () =>
      toolItems.map((tool) => {
        if (typeof tool === 'string') {
          return {
            id: tool,
            label: DEFAULT_TOOL_LABELS[tool],
            icon: (isActive) => getDefaultToolbarIcon(tool, isActive),
          };
        }
        return {
          id: tool.id,
          label: tool.label,
          icon: (isActive) => (isActive && tool.iconSelected ? tool.iconSelected : tool.icon),
        };
      }),
    [toolItems]
  );
  const stylePanelToolIds = useMemo<ToolId[]>(
    () =>
      toolItems
        .filter((tool) => {
          if (typeof tool === 'string') return tool === 'pen';
          return tool.showStylePanel ?? false;
        })
        .map(getToolId),
    [toolItems]
  );
  const initialTool: ToolId = props.initialToolId ?? toolbarItems[0]?.id ?? 'pen';
  const requestedTheme = props.theme ?? 'light';

  // Themes and so that system theme works
  useEffect(() => {
    if (requestedTheme !== 'system' || typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

    syncSystemTheme();
    mediaQuery.addEventListener('change', syncSystemTheme);

    return () => mediaQuery.removeEventListener('change', syncSystemTheme);
  }, [requestedTheme]);

  const resolvedTheme = requestedTheme === 'system' ? systemTheme : requestedTheme;

  const {
    containerRef,
    canvasRef,
    currentTool,
    drawColor,
    drawDash,
    drawSize,
    selectedShapeIds,
    selectionBrush,
    selectionBounds,
    selectionRotationDeg,
    canvasCursor: defaultCanvasCursor,
    cursorContext,
    toolOverlay,
    showStylePanel,
    setTool,
    applyDrawStyle,
    handleResizePointerDown,
    handleRotatePointerDown,
  } = useTsdrawCanvasController({
    toolDefinitions,
    initialTool,
    theme: resolvedTheme,
    persistenceKey: props.persistenceKey,
    stylePanelToolIds,
    onMount: props.onMount,
  });

  const toolbarPlacementStyle = resolvePlacementStyle(props.uiOptions?.toolbar?.placement, 'bottom-center', 0, 14);
  const stylePanelPlacementStyle = resolvePlacementStyle(props.uiOptions?.stylePanel?.placement, 'top-right', 8, 8);
  const canvasCursor = props.uiOptions?.cursor?.getCursor?.(cursorContext) ?? defaultCanvasCursor;
  const defaultToolOverlay = (
    <ToolOverlay
      visible={toolOverlay.visible}
      pointerX={toolOverlay.pointerX}
      pointerY={toolOverlay.pointerY}
      isPenPreview={toolOverlay.isPenPreview}
      penRadius={toolOverlay.penRadius}
      penColor={toolOverlay.penColor}
      eraserRadius={toolOverlay.eraserRadius}
    />
  );
  const overlayNode = props.uiOptions?.overlays?.renderToolOverlay?.({ defaultOverlay: defaultToolOverlay, overlayState: toolOverlay, currentTool }) ?? defaultToolOverlay;
  const customElements = props.uiOptions?.customElements ?? [];

  return (
    <div
      ref={containerRef}
      className={`tsdraw tsdraw-${resolvedTheme}mode ${props.className ?? ''}`}
      style={{
        width: props.width ?? '100%',
        height: props.height ?? '100%',
        position: 'relative',
        overflow: 'hidden',
        ...props.style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
          cursor: canvasCursor,
        }}
        data-testid="tsdraw-canvas"
      />
      {overlayNode}
      <SelectionOverlay
        selectionBrush={selectionBrush}
        selectionBounds={selectionBounds}
        selectionRotationDeg={selectionRotationDeg}
        currentTool={currentTool}
        selectedCount={selectedShapeIds.length}
        onRotatePointerDown={handleRotatePointerDown}
        onResizePointerDown={handleResizePointerDown}
      />
      <StylePanel
        visible={showStylePanel}
        style={stylePanelPlacementStyle}
        theme={resolvedTheme}
        drawColor={drawColor}
        drawDash={drawDash}
        drawSize={drawSize}
        onColorSelect={(color) => applyDrawStyle({ color })}
        onDashSelect={(dash) => applyDrawStyle({ dash })}
        onSizeSelect={(size) => applyDrawStyle({ size })}
      />
      {customElements.map((customElement) => (
        <div
          key={customElement.id}
          style={{
            position: 'absolute',
            zIndex: 130,
            pointerEvents: 'all',
            ...resolvePlacementStyle(customElement.placement, 'top-left', 8, 8),
          }}
        >
          {customElement.render({ currentTool, setTool, applyDrawStyle })}
        </div>
      ))}
      <Toolbar
        items={toolbarItems}
        style={toolbarPlacementStyle}
        currentTool={currentTool}
        onToolChange={setTool}
      />
    </div>
  );
}

export function TsdrawCanvas(props: TsdrawCanvasProps) {
  return <Tsdraw {...props} />;
}