export function isPenTool(tool: string): boolean {
  return tool === 'pen';
}

export function getPenCursor() {
  return 'crosshair';
}

export function shouldShowPenStylePanel(tool: string): boolean {
  return isPenTool(tool);
}