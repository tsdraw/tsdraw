import { DEFAULT_COLORS, resolveThemeColor } from '@tsdraw/core';
import type { ColorStyle, DashStyle, FillStyle, SizeStyle } from '@tsdraw/core';
import type { CSSProperties, ReactNode } from 'react';
import { BaseComponent } from './BaseComponent.js';

const STYLE_COLORS = Object.entries(DEFAULT_COLORS)
  .filter(([key]) => key !== 'white')
  .map(([value]) => ({ value }));

const STYLE_DASHES: DashStyle[] = ['draw', 'solid', 'dashed', 'dotted'];
const STYLE_FILLS: FillStyle[] = ['none', 'blank', 'semi', 'solid'];
const STYLE_SIZES: SizeStyle[] = ['s', 'm', 'l', 'xl'];

export type TsdrawStylePanelPartItem = | 'colors' | 'dashes' | 'fills' | 'sizes' | (string & {});

export interface TsdrawStylePanelRenderContext {
  drawColor: ColorStyle;
  drawDash: DashStyle;
  drawFill: FillStyle;
  drawSize: SizeStyle;
  onColorSelect: (color: ColorStyle) => void;
  onDashSelect: (dash: DashStyle) => void;
  onFillSelect: (fill: FillStyle) => void;
  onSizeSelect: (size: SizeStyle) => void;
}

export interface TsdrawStylePanelCustomPart {
  id: string;
  render: (context: TsdrawStylePanelRenderContext) => ReactNode;
}

interface StylePanelProps extends TsdrawStylePanelRenderContext {
  visible: boolean;
  parts: TsdrawStylePanelPartItem[];
  customParts?: TsdrawStylePanelCustomPart[];
  style?: CSSProperties;
  theme: 'light' | 'dark';
}

export function StylePanel({
  visible,
  parts,
  customParts,
  style,
  theme,
  drawColor,
  drawDash,
  drawFill,
  drawSize,
  onColorSelect,
  onDashSelect,
  onFillSelect,
  onSizeSelect,
}: StylePanelProps) {
  if (!visible || parts.length === 0) return null;

  const context: TsdrawStylePanelRenderContext = {
    drawColor,
    drawDash,
    drawFill,
    drawSize,
    onColorSelect,
    onDashSelect,
    onFillSelect,
    onSizeSelect,
  };
  const customPartMap = new Map((customParts ?? []).map((customPart) => [customPart.id, customPart]));

  return (
    <BaseComponent className="tsdraw-style-panel" style={style} aria-label="Draw style panel">
      {parts.map((part) => {
        if (part === 'colors') {
          return (
            <div key={part} className="tsdraw-style-colors">
              {STYLE_COLORS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className="tsdraw-style-color"
                  data-active={drawColor === item.value ? 'true' : undefined}
                  aria-label={`Color ${item.value}`}
                  title={item.value}
                  onClick={() => onColorSelect(item.value)}
                >
                  <span
                    className="tsdraw-style-color-dot"
                    style={{ background: resolveThemeColor(item.value, theme) }}
                  />
                </button>
              ))}
            </div>
          );
        }

        if (part === 'dashes') {
          return (
            <div key={part} className="tsdraw-style-section">
              {STYLE_DASHES.map((dash) => (
                <button
                  key={dash}
                  type="button"
                  className="tsdraw-style-row"
                  data-active={drawDash === dash ? 'true' : undefined}
                  aria-label={`Stroke ${dash}`}
                  title={dash}
                  onClick={() => onDashSelect(dash)}
                >
                  <span className="tsdraw-style-preview">
                    <span className={`tsdraw-style-preview-line tsdraw-style-preview-line--${dash}`} />
                  </span>
                </button>
              ))}
            </div>
          );
        }

        if (part === 'fills') {
          return (
            <div key={part} className="tsdraw-style-section">
              {STYLE_FILLS.map((fill) => (
                <button
                  key={fill}
                  type="button"
                  className="tsdraw-style-row"
                  data-active={drawFill === fill ? 'true' : undefined}
                  aria-label={`Fill ${fill}`}
                  title={fill}
                  onClick={() => onFillSelect(fill)}
                >
                  <span className="tsdraw-style-preview">
                    <span className={`tsdraw-style-fill tsdraw-style-fill--${fill}`} />
                  </span>
                </button>
              ))}
            </div>
          );
        }

        if (part === 'sizes') {
          return (
            <div key={part} className="tsdraw-style-section">
              {STYLE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className="tsdraw-style-row"
                  data-active={drawSize === size ? 'true' : undefined}
                  aria-label={`Thickness ${size}`}
                  title={size}
                  onClick={() => onSizeSelect(size)}
                >
                  <span className="tsdraw-style-preview">
                    <span className={`tsdraw-style-size tsdraw-style-size--${size}`} />
                  </span>
                </button>
              ))}
            </div>
          );
        }

        const customPart = customPartMap.get(part);
        if (!customPart) return null;
        return (
          <div key={part} className="tsdraw-style-section tsdraw-style-section--custom">
            {customPart.render(context)}
          </div>
        );
      })}
    </BaseComponent>
  );
}