import { describe, it, expect } from 'vitest';
import { dist, sqDist, withinRadius, lerpPath, tail, quantizeAngle, rotateAround } from './vec.js';

describe('vec', () => {
  it('dist', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('sqDist', () => {
    expect(sqDist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });
  it('withinRadius', () => {
    expect(withinRadius({ x: 0, y: 0 }, { x: 2, y: 0 }, 3)).toBe(true);
    expect(withinRadius({ x: 0, y: 0 }, { x: 10, y: 0 }, 3)).toBe(false);
  });
  it('lerpPath', () => {
    const pts = lerpPath({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
    expect(pts.length).toBe(3);
    expect(pts[0]?.x).toBe(0);
    expect(pts[2]?.x).toBe(10);
  });
  it('tail', () => {
    expect(tail([1, 2, 3])).toBe(3);
    expect(tail([])).toBeUndefined();
  });
  it('quantizeAngle', () => {
    expect(quantizeAngle(0, 24)).toBe(0);
    const step = (Math.PI * 2) / 24;
    expect(quantizeAngle(step * 0.4, 24)).toBe(0);
    expect(quantizeAngle(step * 0.6, 24)).toBe(step);
  });
  it('rotateAround', () => {
    const r = rotateAround({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(Math.abs(r.x) < 1e-10).toBe(true);
    expect(Math.abs(r.y - 1) < 1e-10).toBe(true);
  });
});
