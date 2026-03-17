import type { Viewport } from './viewport.js';
import type { Shape, DrawShape } from '../types.js';
import { STROKE_WIDTHS, DEFAULT_COLORS } from '../types.js';
import { decodePoints } from '../utils/pathCodec.js';
import { getStroke } from 'perfect-freehand';

function resolveColor(color: string): string {
  return DEFAULT_COLORS[color] ?? color;
}

// Renderer interface: renders shapes given 2d canvas context and viewport
export interface ICanvasRenderer {
  render(ctx: CanvasRenderingContext2D, viewport: Viewport, shapes: Shape[]): void;
}

// Default canvas renderer: draws shapes using (optionally) pressure-based width for ipads and whatnot
export class CanvasRenderer implements ICanvasRenderer {
  render(ctx: CanvasRenderingContext2D, viewport: Viewport, shapes: Shape[]): void {
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);
    for (const shape of shapes) {
      if (shape.type === 'draw') {
        this.paintStroke(ctx, shape);
      }
    }
    ctx.restore();
  }

  private paintStroke(ctx: CanvasRenderingContext2D, shape: DrawShape): void {
    const width = (STROKE_WIDTHS[shape.props.size] ?? 3.5) * shape.props.scale;
    const samples = flattenSegments(shape);
    if (samples.length === 0) return;
    const color = resolveColor(shape.props.color);

    if (shape.props.dash !== 'draw') {
      this.paintDashedStroke(ctx, samples, width, color, shape.props.dash);
      return;
    }

    const config = strokeConfig(shape, width);
    const outline = getStroke(
      samples.map((p) => [p.x, p.y, p.pressure] as [number, number, number]),
      config
    );
    if (outline.length === 0) return;

    ctx.fillStyle = color;
    ctx.beginPath();
    const first = outline[0];
    if (!first) return;
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < outline.length; i++) {
      const p = outline[i];
      if (p) ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.fill();
  }

  private paintDashedStroke(
    ctx: CanvasRenderingContext2D,
    samples: Array<{ x: number; y: number }>,
    width: number,
    color: string,
    dash: DrawShape['props']['dash']
  ): void {
    if (samples.length === 1) {
      const p = samples[0]!;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(getLineDash(dash, width));
    ctx.beginPath();
    ctx.moveTo(samples[0]!.x, samples[0]!.y);
    for (let i = 1; i < samples.length; i++) {
      const p = samples[i]!;
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

const PRESSURE_FLOOR = 0.025;
const STYLUS_CURVE = (t: number) => t * 0.65 + Math.sin((t * Math.PI) / 2) * 0.35;
const sineOut = (t: number) => Math.sin((t * Math.PI) / 2);
const cubicInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function remap(
  value: number,
  inRange: [number, number],
  outRange: [number, number],
  clamp = false
) {
  const [lo, hi] = inRange;
  const [outLo, outHi] = outRange;
  const t = (value - lo) / (hi - lo);
  const clamped = clamp ? Math.max(0, Math.min(1, t)) : t;
  return outLo + (outHi - outLo) * clamped;
}

function strokeConfig(shape: DrawShape, width: number) {
  const done = shape.props.isComplete;
  if (shape.props.isPen) {
    return {
      size: 1 + width * 1.2,
      thinning: 0.62,
      streamline: 0.62,
      smoothing: 0.62,
      simulatePressure: false,
      easing: STYLUS_CURVE,
      last: done,
    };
  }
  return {
    size: width,
    thinning: 0.5,
    streamline: remap(width, [9, 16], [0.64, 0.74], true),
    smoothing: 0.62,
    simulatePressure: true,
    easing: sineOut,
    last: done,
  };
}

function flattenSegments(shape: DrawShape) {
  const out: { x: number; y: number; pressure: number }[] = [];
  for (const seg of shape.props.segments) {
    const decoded = decodePoints(seg.path).map((p) => ({
      x: p.x + shape.x,
      y: p.y + shape.y,
      pressure: Math.max(PRESSURE_FLOOR, p.z ?? 0.5),
    }));

    if (seg.type === 'free' || decoded.length < 2) {
      out.push(...decoded);
      continue;
    }

    const A = decoded[0]!;
    const D = decoded[1]!;
    const len = Math.hypot(D.x - A.x, D.y - A.y);
    if (len === 0) {
      out.push(A);
      continue;
    }

    const ux = (D.x - A.x) / len;
    const uy = (D.y - A.y) / len;
    const nudge = Math.min(1, Math.floor(len / 4));
    const B = { x: A.x + ux * nudge, y: A.y + uy * nudge, pressure: A.pressure };
    const C = { x: D.x - ux * nudge, y: D.y - uy * nudge, pressure: D.pressure };
    const count = Math.max(4, Math.floor(len / 16));
    out.push(A);
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const e = cubicInOut(t);
      out.push({
        x: B.x + (C.x - B.x) * e,
        y: B.y + (C.y - B.y) * e,
        pressure: B.pressure + (C.pressure - B.pressure) * e,
      });
    }
    out.push(D);
  }

  if (out.length > 0 && !shape.props.isPen) {
    for (const p of out) p.pressure = 0.5;
  }
  return out;
}

function getLineDash(dash: DrawShape['props']['dash'], width: number): number[] {
  switch (dash) {
    case 'dashed': return [width * 2, width * 2];
    case 'dotted': return [Math.max(1, width * 0.25), width * 2];
    case 'solid':
    case 'draw':
    default:
      return [];
  }
}
