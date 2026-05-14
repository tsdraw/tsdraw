import * as RadixPopover from '@radix-ui/react-popover';
import { DEFAULT_COLORS, resolveThemeColor } from '@tsdraw/core';
import type { ColorStyle, DashStyle, FillStyle, SizeStyle } from '@tsdraw/core';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { BaseComponent } from './BaseComponent.js';

const STYLE_COLORS = Object.entries(DEFAULT_COLORS)
  .filter(([key]) => key !== 'white')
  .map(([value]) => ({ value }));

const STYLE_DASHES: DashStyle[] = ['draw', 'solid', 'dashed', 'dotted'];
const STYLE_FILLS: FillStyle[] = ['none', 'blank', 'semi', 'solid'];
const STYLE_SIZES: SizeStyle[] = ['s', 'm', 'l', 'xl'];

export type TsdrawStylePanelPartItem = | 'colors' | 'dashes' | 'fills' | 'sizes' | (string & {});
export type TsdrawStylePanelMenuPlacement = 'top' | 'bottom' | 'left' | 'right';

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
  menuPlacement?: TsdrawStylePanelMenuPlacement;
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
  menuPlacement = 'top',
}: StylePanelProps) {
  const [openPart, setOpenPart] = useState<TsdrawStylePanelPartItem | null>(null);
  if (!visible || parts.length === 0) return null;

  const close = () => setOpenPart(null);
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
  const previewColor = resolveThemeColor(drawColor, theme);

  const renderMenu = (part: TsdrawStylePanelPartItem) => {
    if (part === 'colors') {
      return (
        <div className="tsdraw-style-colors tsdraw-style-colors--menu">
          {STYLE_COLORS.map((item) => (
            <button
            key={item.value}
            type="button"
            className="tsdraw-style-color"
            data-active={drawColor === item.value ? 'true' : undefined}
            aria-label={`Color ${item.value}`}
            title={item.value}
            onClick={() => { onColorSelect(item.value); close(); }}
          >
              <span className="tsdraw-style-color-dot" style={{ background: resolveThemeColor(item.value, theme) }} />
            </button>
          ))}
        </div>
      );
    }

    const rows = part === 'dashes' ? STYLE_DASHES : part === 'fills' ? STYLE_FILLS : part === 'sizes' ? STYLE_SIZES : null;
    if (rows) {
      return (
        <div className="tsdraw-style-section tsdraw-style-section--menu-row">
          {rows.map((item) => {
            const active = part === 'dashes' ? drawDash === item : part === 'fills' ? drawFill === item : drawSize === item;
            const select = () => {
              if (part === 'dashes') onDashSelect(item as DashStyle);
              else if (part === 'fills') onFillSelect(item as FillStyle);
              else onSizeSelect(item as SizeStyle);
              close();
            };
            return (
              <button
                key={item}
                type="button"
                className="tsdraw-style-row"
                data-active={active ? 'true' : undefined}
                aria-label={`${part} ${item}`}
                title={item}
                onClick={select}
              >
                <span className="tsdraw-style-preview">
                  {part === 'dashes' ? <span className={`tsdraw-style-preview-line tsdraw-style-preview-line--${item}`} /> : null}
                  {part === 'fills' ? <span className={`tsdraw-style-fill tsdraw-style-fill--${item}`} /> : null}
                  {part === 'sizes' ? <span className={`tsdraw-style-size tsdraw-style-size--${item}`} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      );
    }

    const customPart = customPartMap.get(part);
    return customPart ? <div className="tsdraw-style-section tsdraw-style-section--custom">{customPart.render(context)}</div> : null;
  };

  const renderTrigger = (part: TsdrawStylePanelPartItem, isOpen: boolean) => {
    if (part === 'colors') return <button type="button" className="tsdraw-style-toggle" aria-expanded={isOpen} aria-haspopup="menu"><span className="tsdraw-style-toggle-dot" style={{ background: previewColor }} /><span>Color</span></button>;
    if (part === 'dashes') return <button type="button" className="tsdraw-style-toggle" aria-expanded={isOpen} aria-haspopup="menu"><span>Stroke</span><span className={`tsdraw-style-toggle-line tsdraw-style-toggle-line--${drawDash}`} /></button>;
    if (part === 'fills') return <button type="button" className="tsdraw-style-toggle" aria-expanded={isOpen} aria-haspopup="menu"><span>Fill</span><span className={`tsdraw-style-fill tsdraw-style-fill--${drawFill}`} /></button>;
    if (part === 'sizes') return <button type="button" className="tsdraw-style-toggle" aria-expanded={isOpen} aria-haspopup="menu"><span>Size</span><span className={`tsdraw-style-size tsdraw-style-size--${drawSize}`} /></button>;
    return <button type="button" className="tsdraw-style-toggle" aria-expanded={isOpen} aria-haspopup="dialog"><span>{part}</span></button>;
  };

  return (
    <BaseComponent className="tsdraw-style-panel" style={style} aria-label="Draw style panel">
      <div className="tsdraw-style-panel-strip">
        {parts.map((part) => {
          const isOpen = openPart === part;
          return (
            <RadixPopover.Root key={part} open={isOpen} onOpenChange={(open) => setOpenPart(open ? part : null)}>
              <div className="tsdraw-style-bubble">
                <RadixPopover.Trigger asChild>{renderTrigger(part, isOpen)}</RadixPopover.Trigger>
              </div>
              <RadixPopover.Portal>
                <RadixPopover.Content className={`tsdraw tsdraw-${theme}mode tsdraw-style-popout`} side={menuPlacement} sideOffset={4} collisionPadding={8} align="center" role="menu">
                  {renderMenu(part)}
                </RadixPopover.Content>
              </RadixPopover.Portal>
            </RadixPopover.Root>
          );
        })}
      </div>
    </BaseComponent>
  );
}