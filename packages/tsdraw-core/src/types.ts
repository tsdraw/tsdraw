// Unique id assigned for each shape
export type ShapeId = string;

// Point with optional pressure (z) for styluses
export interface Vec3 {
  x: number;
  y: number;
  z?: number;
}

// Segment of draw strokes can be free (curved) or straight
export type SegmentType = 'free' | 'straight';

export interface DrawSegment {
  type: SegmentType;
  path: string; // base64-encoded points for storage
}

// Available sizes for strokes
export type SizeStyle = 's' | 'm' | 'l' | 'xl';

// Available dash styles for drawing
export type DashStyle = 'draw' | 'solid' | 'dashed' | 'dotted';

// Color styles (css-compatible or by palette key)
export type ColorStyle = string;

// A single draw shape (stroke)
export interface DrawShape {
  id: ShapeId;
  type: 'draw';
  x: number;
  y: number;
  props: {
    color: ColorStyle;
    dash: DashStyle;
    size: SizeStyle;
    scale: number;
    isPen: boolean;
    isComplete: boolean;
    segments: DrawSegment[];
    isClosed?: boolean;
  };
}

export type Shape = DrawShape;

// Page holds shapes and camera state
export interface PageState {
  id: string;
  shapes: Record<ShapeId, Shape>;
  erasingShapeIds: ShapeId[];
}

// Stroke sizes in px
export const STROKE_WIDTHS: Record<SizeStyle, number> = {
  s: 2,
  m: 3.5,
  l: 5,
  xl: 10,
};

// Default drag distance squared for segment-mode transitions
export const DRAG_DISTANCE_SQUARED = 36;

// Default colors
export const DEFAULT_COLORS: Record<string, string> = {
  black: '#1d1d1d',
  grey: '#9fa8b2',
  'light-violet': '#e085f4',
  violet: '#ae3ec9',
  blue: '#4465e9',
  'light-blue': '#4ba1f1',
  yellow: '#f1ac4b',
  orange: '#e16919',
  green: '#099268',
  'light-green': '#4cb05e',
  'light-red': '#f87777',
  red: '#e03131',
  white: '#ffffff',
};

// Max points per single stroke before starting a new shape
export const MAX_POINTS_PER_SHAPE = 200;
