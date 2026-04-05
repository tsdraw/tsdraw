import { createRoot } from 'react-dom/client';
import { useCallback, useRef, useState, useMemo, type MutableRefObject } from 'react';
import { Tsdraw, type TsdrawCustomTool, type TsdrawCustomElement, type AutoShapeKind, type AutoShapeOptions } from '@tsdraw/react';
import { DEFAULT_COLORS, type ColorStyle, type DashStyle, type SizeStyle } from '@tsdraw/core';
import Confetti from 'react-confetti-boom';
import { IconStar, IconStarFilled, IconMoodSmile } from '@tabler/icons-react';
import { wavyToolDefinition } from './wavyTool.js';
import { emojiToolDefinition } from './emojiTool.js';
import './App.css';

// These are custom tools which we can easily add to the toolbar using the customTools prop. After, position them in the toolbar using uiOptions.toolbar.parts
// Go to wavyTool.ts or emojiTool.ts to see how they're built using custom logic
const wavyTool: TsdrawCustomTool = {
  id: 'wavy',
  label: 'Wavy',
  icon: <IconStar size={16} />,
  iconSelected: <IconStarFilled size={16} />,
  definition: wavyToolDefinition,
  stylePanel: {
    parts: ['colors', 'dashes', 'sizes'],
  },
};

// These constants and functions are needed for the custom elements
const drawColors: ColorStyle[] = Object.keys(DEFAULT_COLORS).filter((colorKey) => colorKey !== 'white');
const drawDashes: DashStyle[] = ['draw', 'solid', 'dashed', 'dotted'];
const drawSizes: SizeStyle[] = ['s', 'm', 'l', 'xl'];
const emojiOptions = ['🐝', '🐓', '🦍', '🦧', '😭', '💔', '🛂', '🎻'];
const defaultEmoji = emojiOptions[0]!;

function pickRandomStyle<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function triggerConfetti() {
  const container = document.createElement('div');
  container.style.inset = '0';
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(<Confetti mode="boom" particleCount={100} shapeSize={15} spreadDeg={70} />);
}

function EmojiPickerPart({
  selectedEmojiRef,
  onSelect,
}: {
  selectedEmojiRef: MutableRefObject<string>;
  onSelect: (emoji: string) => void;
}) {
  const [selectedEmoji, setSelectedEmoji] = useState(selectedEmojiRef.current);

  const handleSelect = useCallback((emoji: string) => {
    setSelectedEmoji(emoji);
    onSelect(emoji);
  }, [onSelect]);

  return (
    <div className="tsdraw-style-colors" style={{ padding: 0, gridTemplateColumns: 'repeat(4, 1fr)' }}>
      {emojiOptions.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="tsdraw-style-color"
          data-active={selectedEmoji === emoji ? 'true' : undefined}
          onClick={() => handleSelect(emoji)}
          style={{ fontSize: '20px' }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

const ALL_SHAPE_KINDS: AutoShapeKind[] = ['polyline', 'polygon', 'rectangle', 'ellipse'];

const demoAutoShapeThresholds: NonNullable<AutoShapeOptions['thresholds']> = {
  rdpEpsilon: 0.06,
  closureDiagonalRatio: 0.22,
  ellipseFitTolerance: 0.28,
  rectAngleTolerance: Math.PI * 0.26,
  minPathLength: 6,
};

export function App() {
  const editorRef = useRef<any>(null);
  const selectedEmojiRef = useRef(defaultEmoji);
  const [autoShapeEnabled, setAutoShapeEnabled] = useState(true);
  const [autoShapeWhitelist, setAutoShapeWhitelist] = useState<AutoShapeKind[]>([...ALL_SHAPE_KINDS]);

  const autoShapeConfig = useMemo<AutoShapeOptions>(
    () => ({
      enabled: autoShapeEnabled,
      whitelist: autoShapeWhitelist.length === ALL_SHAPE_KINDS.length ? undefined : autoShapeWhitelist,
      thresholds: demoAutoShapeThresholds,
    }),
    [autoShapeEnabled, autoShapeWhitelist],
  );

  const toggleWhitelistKind = useCallback((kind: AutoShapeKind) => {
    setAutoShapeWhitelist((prev) => {
      if (prev.includes(kind)) return prev.filter((k) => k !== kind);
      return [...prev, kind];
    });
  }, []);

  const handleEmojiSelect = useCallback((nextEmoji: string) => {
    selectedEmojiRef.current = nextEmoji;
    if (editorRef.current) {
      editorRef.current.selectedEmoji = nextEmoji;
    }
  }, []);

  // Use useMemo to memoize the emoji tool to avoid re-rendering the Tsdraw instance unnecessarily
  const emojiTool = useMemo<TsdrawCustomTool>(
    () => ({
      id: 'emoji',
      label: 'Emoji',
      icon: <IconMoodSmile size={16} />,
      definition: emojiToolDefinition,
      stylePanel: {
        parts: ['dashes', 'sizes', 'emoji-picker'],
        customParts: [
          {
            id: 'emoji-picker',
            render: () => <EmojiPickerPart selectedEmojiRef={selectedEmojiRef} onSelect={handleEmojiSelect} />,
          },
        ],
      },
    }),
    [handleEmojiSelect]
  );
  // Below are two custom elements that can be added to the Tsdraw ui using the 'customElements' prop
  // The second one shows that you can actually edit properties of the Tsdraw instance.
  // You can use applyDrawStyle and setTool (check packages/tsdraw-react/src/components/TsdrawCanvas.tsx)

  const confettiButton: TsdrawCustomElement = {
    id: 'confetti-btn',
    placement: { anchor: 'top-left', edgeOffset: 18 },
    render: () => <button className="custom-btn" onClick={triggerConfetti}>more confetti!</button>,
  };

  const randomStyleButton: TsdrawCustomElement = {
    id: 'higher-stroke-btn',
    placement: { anchor: 'bottom-right', edgeOffset: 18 },
    render: ({ applyDrawStyle }) => (
      <button
        className="custom-btn"
        onClick={() =>
          applyDrawStyle({
            color: pickRandomStyle(drawColors),
            dash: pickRandomStyle(drawDashes),
            size: pickRandomStyle(drawSizes),
          })}
      >
        randomize all draw styles!
      </button>
    ),
  };

  const autoShapePanelElement = useMemo<TsdrawCustomElement>(
    () => ({
      id: 'autoshape-panel',
      placement: { anchor: 'bottom-left', edgeOffset: 18 },
      render: () => (
        <div className="tsdraw-component" style={{ padding: 8 }}>
          <label style={{ color: 'var(--tsdraw-color-text)', fontWeight: 'bold' }}>
            <input type="checkbox" checked={autoShapeEnabled} onChange={(e) => setAutoShapeEnabled(e.target.checked)} />
            Auto-shape
          </label>
          {autoShapeEnabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {ALL_SHAPE_KINDS.map((kind) => (
                <label key={kind} style={{ color: 'var(--tsdraw-color-text)' }}>
                  <input
                    type="checkbox"
                    checked={autoShapeWhitelist.includes(kind)}
                    onChange={() => toggleWhitelistKind(kind)}
                  />
                  {kind}
                </label>
              ))}
            </div>
          )}
        </div>
      ),
    }),
    [autoShapeEnabled, autoShapeWhitelist, toggleWhitelistKind]
  );

  const handleMount = useCallback((api: any) => {
    triggerConfetti();

    editorRef.current = api.editor;
    editorRef.current.selectedEmoji = selectedEmojiRef.current;

    const renderer = editorRef.current.renderer as any;
    if (renderer.__emojiBrushPatched) return;

    const originalPaintStroke = renderer.paintStroke.bind(renderer);
    renderer.__emojiBrushPatched = true;

    // Custom rendering to display emoji paint strokes
    renderer.paintStroke = (ctx: CanvasRenderingContext2D, shape: any) => {
      if (shape.props && shape.props.emoji) {
        const { emoji, emojiSize } = shape.props;
        ctx.save();
        ctx.font = `${emojiSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, shape.x, shape.y);
        ctx.restore();
        return;
      }

      originalPaintStroke(ctx, shape);
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tsdraw
        width="100%"
        height="100%"
        theme="light"
        persistenceKey="ts-demo"
        customTools={[wavyTool, emojiTool]}
        initialToolId="pen"
        autoShape={autoShapeConfig}
        uiOptions={{
          toolbar: {
            placement: { anchor: 'top-center', edgeOffset: 18, style: { border: '1px solid var(--tsdraw-color-selected)' } },
            parts: [['undo', 'redo'], ['select', 'hand', 'pen', 'square', 'eraser', 'wavy', 'emoji']],
            draggable: true,
            saveDraggedPosition: true,
            disabledDragPositions: ['top-left', 'bottom-right'],
          },
          stylePanel: {
            placement: { anchor: 'top-right', edgeOffset: 18 },
            hide: false,
          },
          customElements: [confettiButton, randomStyleButton, autoShapePanelElement],
        }}
        background={{
          type: 'dots',
          color: '#AAAAAA',
          colorDark: '#808080',
          spacing: 25,
          size: 1,
          opacity: 0.5,
        }}
        onMount={handleMount}
      />
    </div>
  );
}