import { createRoot } from 'react-dom/client';
import { Tsdraw, type TsdrawCustomTool, type TsdrawCustomElement } from '@tsdraw/react';
import { DEFAULT_COLORS, type ColorStyle, type DashStyle, type SizeStyle } from '@tsdraw/core';
import Confetti from 'react-confetti-boom';
import { IconStar, IconStarFilled } from '@tabler/icons-react';
import { wavyToolDefinition } from './wavyTool.js';
import './App.css';

// This is a custom tool which we can easily add to the toolbar using the 'tools' prop
// Go to wavyTool.ts to see how its built using custom logic
const wavyTool: TsdrawCustomTool = {
  id: 'wavy',
  label: 'Wavy',
  icon: <IconStar size={18} />,
  iconSelected: <IconStarFilled size={18} />,
  definition: wavyToolDefinition,
  showStylePanel: true,
};

// These constants and functions are needed for the custom elements
const drawColors: ColorStyle[] = Object.keys(DEFAULT_COLORS).filter((colorKey) => colorKey !== 'white');
const drawDashes: DashStyle[] = ['draw', 'solid', 'dashed', 'dotted'];
const drawSizes: SizeStyle[] = ['s', 'm', 'l', 'xl'];

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

export function App() {
  // Below are two custom elements that can be added to the Tsdraw ui using the 'customElements' prop
  // The second one shows that you can actually edit properties of the Tsdraw instance.
  // You can use applyDrawStyle and setTool (check packages/tsdraw-react/src/components/TsdrawCanvas.tsx)

  const confettiButton: TsdrawCustomElement = {
    id: 'confetti-btn',
    placement: { anchor: 'top-left', offsetX: 18, offsetY: 18 },
    render: () => <button className="custom-btn" onClick={triggerConfetti}>more confetti!</button>,
  };

  const randomStyleButton: TsdrawCustomElement = {
    id: 'higher-stroke-btn',
    placement: { anchor: 'bottom-right', offsetX: 18, offsetY: 18 },
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

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tsdraw
        width="100%"
        height="100%"
        theme="light"
        persistenceKey="ts-demo"
        tools={['select', 'pen', wavyTool, 'eraser', 'hand']}
        initialToolId="pen"
        uiOptions={{
          toolbar: { // top-left, bottom-center, center-right, left-center, ... (it can be any valid anchor)
            placement: { anchor: 'top-center', offsetX: 18, offsetY: 18 },
          },
          stylePanel: {
            placement: { anchor: 'top-right', offsetX: 16, offsetY: 16 },
          },
          customElements: [confettiButton, randomStyleButton],
        }}
        onMount={triggerConfetti}
      />
    </div>
  );
}