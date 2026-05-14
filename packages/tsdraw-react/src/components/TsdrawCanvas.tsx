import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ColorStyle, DashStyle, DefaultToolId, FillStyle, SizeStyle, ToolDefinition, ToolId, Viewport, TsdrawDocumentSnapshot, TsdrawEditorSnapshot, TsdrawBackgroundOptions, AutoShapeOptions } from '@tsdraw/core';
import type { TsdrawCameraOptions, TsdrawTouchOptions, TsdrawKeyboardShortcutOptions, TsdrawPenOptions } from '../canvas/canvasOptions.js';
import { SelectionOverlay } from './SelectionOverlay.js';
import { StylePanel, type TsdrawStylePanelCustomPart, type TsdrawStylePanelMenuPlacement, type TsdrawStylePanelPartItem } from './ui/StylePanel.js';
import { ToolOverlay } from './ToolOverlay.js';
import { Toolbar, getDefaultToolbarIcon, type ToolbarPart } from './ui/Toolbar.js';
import {
  resolvePlacementStyle,
  resolveOrientation,
  calculateSnap,
  type ComponentDragEndPayload,
  type DraggedPosition,
  type UiAnchor,
  type TsdrawUiPlacement,
} from './ui/BaseComponent.js';
import {
  useTsdrawCanvasController,
  type TsdrawCursorContext,
  type TsdrawMountApi,
  type TsdrawToolOverlayState,
} from '../canvas/useTsdrawCanvasController.js';

const DEFAULT_TOOLBAR_PARTS: ToolbarPartItem[][] = [['undo', 'redo'], ['select', 'hand', 'pen', 'eraser', 'square', 'circle']];
const EMPTY_CUSTOM_TOOLS: TsdrawCustomTool[] = [];
const EMPTY_CUSTOM_ELEMENTS: TsdrawCustomElement[] = [];
const EMPTY_STYLE_PANEL_PARTS: TsdrawStylePanelPartItem[] = [];
const EMPTY_STYLE_PANEL_CUSTOM_PARTS: TsdrawStylePanelCustomPart[] = [];
const DEFAULT_STYLE_PANEL_PARTS_BY_TOOL: Partial<Record<DefaultToolId, TsdrawStylePanelPartItem[]>> = {
  pen: ['colors', 'dashes', 'sizes'],
  square: ['colors', 'dashes', 'fills', 'sizes'],
  circle: ['colors', 'dashes', 'fills', 'sizes'],
};

const DEFAULT_TOOL_LABELS: Record<DefaultToolId, string> = {
  select: 'Select',
  pen: 'Pen',
  square: 'Rectangle',
  circle: 'Ellipse',
  eraser: 'Eraser',
  hand: 'Hand',
};

function getMenuPlacementForToolbar(anchor: UiAnchor): TsdrawStylePanelMenuPlacement {
  if (anchor.includes('bottom')) return 'top';
  if (anchor.includes('top')) return 'bottom';
  if (anchor.includes('left')) return 'right';
  if (anchor.includes('right')) return 'left';
  return 'top';
}

export type { UiAnchor, TsdrawUiPlacement } from './ui/BaseComponent.js';

export interface TsdrawCustomTool {
  id: ToolId;
  label: string;
  icon: ReactNode;
  iconSelected?: ReactNode;
  definition: ToolDefinition;
  stylePanel?: {
    parts?: TsdrawStylePanelPartItem[];
    customParts?: TsdrawStylePanelCustomPart[];
  };
}

export type TsdrawToolbarBuiltInAction = 'undo' | 'redo';
export type ToolbarPartItem = ToolId | TsdrawToolbarBuiltInAction;

export interface TsdrawUiOptions {
  toolbar?: {
    hide?: boolean;
    placement?: TsdrawUiPlacement;
    parts?: ToolbarPartItem[][];
    draggable?: boolean;
    saveDraggedPosition?: boolean;
    disabledDragPositions?: UiAnchor[];
  };
  stylePanel?: {
    hide?: boolean;
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
  applyDrawStyle: (partial: Partial<{ color: ColorStyle; dash: DashStyle; fill: FillStyle; size: SizeStyle }>) => void;
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
  customTools?: TsdrawCustomTool[];
  initialToolId?: ToolId;
  uiOptions?: TsdrawUiOptions;
  onMount?: (api: TsdrawMountApi) => void | (() => void);
  cameraOptions?: TsdrawCameraOptions;
  touchOptions?: TsdrawTouchOptions;
  keyboardShortcuts?: TsdrawKeyboardShortcutOptions;
  penOptions?: TsdrawPenOptions;
  autoShape?: boolean | AutoShapeOptions;
  background?: TsdrawBackgroundOptions;
  readOnly?: boolean;
  autoFocus?: boolean;
  snapshot?: TsdrawEditorSnapshot;
  onChange?: (snapshot: TsdrawDocumentSnapshot) => void;
  onCameraChange?: (viewport: Viewport) => void;
  onToolChange?: (toolId: ToolId) => void;
}

export type TsdrawCanvasProps = TsdrawProps;

function isToolbarAction(item: ToolbarPartItem): item is TsdrawToolbarBuiltInAction {
  return item === 'undo' || item === 'redo';
}

export function Tsdraw(props: TsdrawProps) {
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const customTools = props.customTools ?? EMPTY_CUSTOM_TOOLS;
  const toolbarPartIds = props.uiOptions?.toolbar?.parts ?? DEFAULT_TOOLBAR_PARTS;
  const toolbarPlacement = props.uiOptions?.toolbar?.placement;
  const toolbarEdgeOffset = toolbarPlacement?.edgeOffset ?? 14;
  const isToolbarDraggable = props.uiOptions?.toolbar?.draggable === true;
  const shouldSaveDraggedToolbarPosition = props.uiOptions?.toolbar?.saveDraggedPosition === true;
  const disabledDragPositionsArray = props.uiOptions?.toolbar?.disabledDragPositions;
  const disabledDragPositionsSet = useMemo(
    () => disabledDragPositionsArray && disabledDragPositionsArray.length > 0 ? new Set(disabledDragPositionsArray) : undefined,
    [disabledDragPositionsArray]
  );
  const toolbarDraggedSessionKey = useMemo(
    () => `tsdraw-toolbar-pos-${props.persistenceKey ?? 'default'}`,
    [props.persistenceKey]
  );
  const [draggedToolbarPosition, setDraggedToolbarPosition] = useState<DraggedPosition | null>(null);
  const customToolMap = useMemo(
    () => new Map(customTools.map((customTool) => [customTool.id, customTool])),
    [customTools]
  );
  const toolbarToolIds = useMemo(() => {
    const ids = new Set<ToolId>();
    for (const toolbarPart of toolbarPartIds) {
      for (const item of toolbarPart) {
        if (isToolbarAction(item)) continue;
        if (item in DEFAULT_TOOL_LABELS || customToolMap.has(item)) {
          ids.add(item);
        }
      }
    }
    return ids;
  }, [customToolMap, toolbarPartIds]);
  const toolDefinitions = useMemo(
    () => customTools.filter((customTool) => toolbarToolIds.has(customTool.id)).map((customTool) => customTool.definition),
    [customTools, toolbarToolIds]
  );
  const firstToolbarTool = useMemo(() => {
    for (const toolbarPart of toolbarPartIds) {
      for (const item of toolbarPart) {
        if (isToolbarAction(item)) continue;
        if (item in DEFAULT_TOOL_LABELS || customToolMap.has(item)) {
          return item;
        }
      }
    }
    return undefined;
  }, [customToolMap, toolbarPartIds]);
  const initialTool: ToolId = props.initialToolId ?? firstToolbarTool ?? 'pen';
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
    drawFill,
    drawSize,
    selectedShapeIds,
    selectionBrush,
    selectionBounds,
    selectionRotationDeg,
    vertexHandleScreenPositions,
    canvasCursor: defaultCanvasCursor,
    cursorContext,
    toolOverlay,
    isPersistenceReady,
    canUndo,
    canRedo,
    undo,
    redo,
    setTool,
    applyDrawStyle,
    handleResizePointerDown,
    handleRotatePointerDown,
  } = useTsdrawCanvasController({
    toolDefinitions,
    initialTool,
    theme: resolvedTheme,
    persistenceKey: props.persistenceKey,
    onMount: props.onMount,
    cameraOptions: props.cameraOptions,
    touchOptions: props.touchOptions,
    keyboardShortcuts: props.keyboardShortcuts,
    penOptions: props.penOptions,
    autoShape: props.autoShape,
    background: props.background,
    readOnly: props.readOnly,
    autoFocus: props.autoFocus,
    snapshot: props.snapshot,
    onChange: props.onChange,
    onCameraChange: props.onCameraChange,
    onToolChange: props.onToolChange,
  });

  // If toolbar is dragged use the dragged position. Otherwise use the placement anchor
  // By default, use the bottom center anchor
  const toolbarPlacementAnchor = draggedToolbarPosition?.anchor ?? toolbarPlacement?.anchor ?? 'bottom-center';
  const effectiveToolbarPlacement: TsdrawUiPlacement | undefined = draggedToolbarPosition
    ? { anchor: draggedToolbarPosition.anchor, edgeOffset: toolbarEdgeOffset, style: toolbarPlacement?.style }
    : toolbarPlacement;
  const toolbarPlacementStyle = resolvePlacementStyle(effectiveToolbarPlacement, 'bottom-center', 14);
  const toolbarOrientation = resolveOrientation(toolbarPlacementAnchor);
  const stylePanelMenuPlacement = getMenuPlacementForToolbar(toolbarPlacementAnchor);
  const stylePanelPlacementStyle = resolvePlacementStyle(props.uiOptions?.stylePanel?.placement, 'bottom-center', 88);
  const isToolbarHidden = props.uiOptions?.toolbar?.hide === true;
  useEffect(() => {
    if (!isToolbarDraggable || !shouldSaveDraggedToolbarPosition || typeof window === 'undefined') return;
    try {
      const rawPosition = window.sessionStorage.getItem(toolbarDraggedSessionKey);
      if (!rawPosition) return;
      const parsedPosition = JSON.parse(rawPosition) as Partial<DraggedPosition>;
      if (typeof parsedPosition.anchor !== 'string') return;
      setDraggedToolbarPosition({ anchor: parsedPosition.anchor as UiAnchor });
    } catch {}
  }, [isToolbarDraggable, shouldSaveDraggedToolbarPosition, toolbarDraggedSessionKey]);

  useEffect(() => {
    if (isToolbarDraggable) return;
    setDraggedToolbarPosition(null);
  }, [isToolbarDraggable]);

  const handleToolbarDragEnd = useCallback((payload: ComponentDragEndPayload) => {
    const containerNode = containerRef.current;
    if (!containerNode) return;
    const nextPosition = calculateSnap(payload, containerNode.getBoundingClientRect(), disabledDragPositionsSet);
    setDraggedToolbarPosition(nextPosition);
    if (!shouldSaveDraggedToolbarPosition || typeof window === 'undefined') return;
    window.sessionStorage.setItem(toolbarDraggedSessionKey, JSON.stringify(nextPosition));
  }, [containerRef, disabledDragPositionsSet, shouldSaveDraggedToolbarPosition, toolbarDraggedSessionKey]);

  const isStylePanelHidden = props.uiOptions?.stylePanel?.hide === true || props.readOnly === true;
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
  const customElements = props.uiOptions?.customElements ?? EMPTY_CUSTOM_ELEMENTS;
  const onColorSelect = useCallback((color: ColorStyle) => {
    applyDrawStyle({ color });
  }, [applyDrawStyle]);
  const onDashSelect = useCallback((dash: DashStyle) => {
    applyDrawStyle({ dash });
  }, [applyDrawStyle]);
  const onFillSelect = useCallback((fill: FillStyle) => {
    applyDrawStyle({ fill });
  }, [applyDrawStyle]);
  const onSizeSelect = useCallback((size: SizeStyle) => {
    applyDrawStyle({ size });
  }, [applyDrawStyle]);
  const activeCustomTool = customToolMap.get(currentTool);
  const stylePanelParts = useMemo<TsdrawStylePanelPartItem[]>(
    () => {
      const fromCustomTool = activeCustomTool?.stylePanel?.parts;
      if (fromCustomTool && fromCustomTool.length > 0) return fromCustomTool;
      if (activeCustomTool?.stylePanel?.customParts && activeCustomTool.stylePanel.customParts.length > 0) return activeCustomTool.stylePanel.customParts.map((customPart) => customPart.id);
      if (currentTool in DEFAULT_STYLE_PANEL_PARTS_BY_TOOL) return DEFAULT_STYLE_PANEL_PARTS_BY_TOOL[currentTool as DefaultToolId] ?? EMPTY_STYLE_PANEL_PARTS;
      return EMPTY_STYLE_PANEL_PARTS;
    },
    [activeCustomTool, currentTool]
  );
  const stylePanelCustomParts = activeCustomTool?.stylePanel?.customParts ?? EMPTY_STYLE_PANEL_CUSTOM_PARTS;
  const toolbarParts = useMemo<ToolbarPart[]>(
    () =>
      toolbarPartIds
        .map((toolbarPart, partIndex) => {
          const items = toolbarPart
            .map((item) => {
              if (item === 'undo') {
                return {
                  type: 'action' as const,
                  id: 'undo' as const,
                  label: 'Undo',
                  disabled: !canUndo,
                  onSelect: undo,
                };
              }

              if (item === 'redo') {
                return {
                  type: 'action' as const,
                  id: 'redo' as const,
                  label: 'Redo',
                  disabled: !canRedo,
                  onSelect: redo,
                };
              }

              if (item in DEFAULT_TOOL_LABELS) {
                return {
                  type: 'tool' as const,
                  id: item,
                  label: DEFAULT_TOOL_LABELS[item as DefaultToolId],
                  icon: (isActive: boolean) => getDefaultToolbarIcon(item, isActive),
                };
              }

              const customTool = customToolMap.get(item);
              if (!customTool) return null;
              return {
                type: 'tool' as const,
                id: customTool.id,
                label: customTool.label,
                icon: (isActive: boolean) => (isActive && customTool.iconSelected ? customTool.iconSelected : customTool.icon),
              };
            })
            .filter((nextItem): nextItem is NonNullable<typeof nextItem> => nextItem != null);
          return {
            id: `toolbar-part-${partIndex.toString(36)}`,
            items,
          };
        })
        .filter((part) => part.items.length > 0),
    [canRedo, canUndo, customToolMap, redo, toolbarPartIds, undo]
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`tsdraw tsdraw-${resolvedTheme}mode ${props.className ?? ''}`}
      style={{
        width: props.width ?? '100%',
        height: props.height ?? '100%',
        position: 'relative',
        overflow: 'hidden',
        outline: 'none',
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
        vertexHandleScreenPositions={vertexHandleScreenPositions}
        currentTool={currentTool}
        selectedCount={selectedShapeIds.length}
        onRotatePointerDown={handleRotatePointerDown}
        onResizePointerDown={handleResizePointerDown}
      />
      <StylePanel
        visible={!isStylePanelHidden && isPersistenceReady && stylePanelParts.length > 0}
        parts={stylePanelParts}
        customParts={stylePanelCustomParts}
        style={stylePanelPlacementStyle}
        theme={resolvedTheme}
        menuPlacement={stylePanelMenuPlacement}
        drawColor={drawColor}
        drawDash={drawDash}
        drawFill={drawFill}
        drawSize={drawSize}
        onColorSelect={onColorSelect}
        onDashSelect={onDashSelect}
        onFillSelect={onFillSelect}
        onSizeSelect={onSizeSelect}
      />
      {customElements.map((customElement) => (
        <div
          key={customElement.id}
          style={{
            position: 'absolute',
            zIndex: 130,
            pointerEvents: 'all',
            ...resolvePlacementStyle(customElement.placement, 'top-left', 8),
          }}
        >
          {customElement.render({ currentTool, setTool, applyDrawStyle })}
        </div>
      ))}
      {!isToolbarHidden ? (
        <Toolbar
          parts={toolbarParts}
          style={toolbarPlacementStyle}
          orientation={toolbarOrientation}
          currentTool={isPersistenceReady ? currentTool : null}
          onToolChange={setTool}
          disabled={!isPersistenceReady}
          draggable={isToolbarDraggable}
          onDragEnd={handleToolbarDragEnd}
        />
      ) : null}
    </div>
  );
}

export function TsdrawCanvas(props: TsdrawCanvasProps) {
  return <Tsdraw {...props} />;
}