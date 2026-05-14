import { useState } from 'react';
import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import { Tsdraw } from '@tsdraw/react';

// This app is a demo persistence in tsdraw, with some custom elements
// Try working through the simple math problems, switching between them, and reloading the page
// Tsdraw saves each canvas's elements in an indexeddb, with all of its elements and states
// This lets users get back to where they left off, even if they reload or leave the page

const PROBLEMS = [
  { id: 1, question: 'Solve for x: 3x + 5 = 23' },
  { id: 2, question: 'Expand and simplify: (x + 4)(x - 2)' },
  { id: 3, question: 'Find the derivative: d/dx (2x^3 - 7x + 1)' },
  { id: 4, question: 'Evaluate: integral of 4x from 0 to 5' },
  { id: 5, question: 'Find the slope through points (2, 3) and (8, 15)' },
  { id: 6, question: 'Solve the system: x + y = 9 and 2x - y = 3' },
  { id: 7, question: 'Factor completely: x^2 - 9x + 20' },
  { id: 8, question: 'Find the area of a triangle with base 12 and height 7' },
  { id: 9, question: 'Convert 135 degrees to radians (in simplest form)' },
  { id: 10, question: 'Find the probability of drawing a heart from a 52-card deck' },
];

export function App() {
  const [activeProblemIndex, setActiveProblemIndex] = useState(0);
  const activeProblem = PROBLEMS[activeProblemIndex] ?? PROBLEMS[0]!;

  const goToNextProblem = () => setActiveProblemIndex((currentIndex) => (currentIndex + 1) % PROBLEMS.length);
  const goToPreviousProblem = () => setActiveProblemIndex((currentIndex) => (currentIndex - 1 + PROBLEMS.length) % PROBLEMS.length);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tsdraw
        key={activeProblem.id}
        width="100%"
        height="100%"
        persistenceKey={String(activeProblem.id)}
        uiOptions={{
          toolbar: {
            placement: { anchor: 'top-center', edgeOffset: 18 },
          },
          customElements: [
            {
              id: `problem-${activeProblem.id}`,
              placement: { anchor: 'bottom-center', edgeOffset: 30 },
              render: () => <div className="tsdraw-component tsdraw-overlay-panel tsdraw-overlay-panel--caption">{activeProblem.question}</div>,
            },
            {
              id: `previous-${activeProblem.id}`,
              placement: { anchor: 'bottom-left', edgeOffset: 18 },
              render: () => <button type="button" className="tsdraw-icon-pill" onClick={goToPreviousProblem} aria-label="Previous problem"><IconArrowLeft size={18} stroke={1.75} /></button>,
            },
            {
              id: `next-${activeProblem.id}`,
              placement: { anchor: 'bottom-right', edgeOffset: 18 },
              render: () => <button type="button" className="tsdraw-icon-pill" onClick={goToNextProblem} aria-label="Next problem"><IconArrowRight size={18} stroke={1.75} /></button>,
            },
          ],
        }}
      />
    </div>
  );
}