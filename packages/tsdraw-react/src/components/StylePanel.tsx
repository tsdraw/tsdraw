import { DEFAULT_COLORS } from 'tsdraw-core';
import type { ColorStyle, DashStyle, SizeStyle } from 'tsdraw-core';

const STYLE_COLORS = Object.entries(DEFAULT_COLORS)
  .filter(([key]) => key !== 'white')
  .map(([value, solid]) => ({ value, solid }));

const STYLE_DASHES: DashStyle[] = ['draw', 'solid', 'dashed', 'dotted'];
const STYLE_SIZES: SizeStyle[] = ['s', 'm', 'l', 'xl'];

interface StylePanelProps {
  visible: boolean;
  drawColor: ColorStyle;
  drawDash: DashStyle;
  drawSize: SizeStyle;
  onColorSelect: (color: ColorStyle) => void;
  onDashSelect: (dash: DashStyle) => void;
  onSizeSelect: (size: SizeStyle) => void;
}

export function StylePanel({
  visible,
  drawColor,
  drawDash,
  drawSize,
  onColorSelect,
  onDashSelect,
  onSizeSelect,
}: StylePanelProps) {
  if (!visible) return null;

  return (
    <div className="tsdraw-style-panel" aria-label="Draw style panel">
      <div className="tsdraw-style-colors">
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
              style={{ background: item.solid }}
            />
          </button>
        ))}
      </div>
      <div className="tsdraw-style-section">
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
      <div className="tsdraw-style-section">
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
    </div>
  );
}