// Every peer shares these logical cells. Screen pixels never cross the wire.
export const COLS = 56;
export const ROWS = 36;
export type View = { zoom: number; x: number; y: number };
export type Size = { width: number; height: number };
export const INITIAL_VIEW: View = { zoom: 1, x: COLS / 2, y: ROWS / 2 };
export function fitScale({ width, height }: Size) {
  return Math.max(0.01, Math.min(Math.max(1, width - 16) / COLS, Math.max(1, height - 16) / ROWS));
}
export function constrainView(view: View, size: Size): View {
  const zoom = Math.max(1, Math.min(4, view.zoom));
  const scale = fitScale(size) * zoom;
  const halfW = size.width / (2 * scale), halfH = size.height / (2 * scale);
  return {
    zoom,
    x: halfW >= COLS / 2 ? COLS / 2 : Math.max(halfW, Math.min(COLS - halfW, view.x)),
    y: halfH >= ROWS / 2 ? ROWS / 2 : Math.max(halfH, Math.min(ROWS - halfH, view.y)),
  };
}
export function transform(size: Size, view: View) {
  const scale = fitScale(size) * view.zoom;
  return { scale, left: size.width / 2 - view.x * scale, top: size.height / 2 - view.y * scale };
}
export function toLogical(px: number, py: number, size: Size, view: View) {
  const { scale, left, top } = transform(size, view);
  return { x: (px - left) / scale, y: (py - top) / scale };
}
export function cellAt(px: number, py: number, size: Size, view: View) {
  const p = toLogical(px, py, size, view);
  return p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS
    ? { x: Math.floor(p.x), y: Math.floor(p.y) } : null;
}
export function zoomAt(zoom: number, px: number, py: number, size: Size, view: View): View {
  const point = toLogical(px, py, size, view);
  const nextZoom = Math.max(1, Math.min(4, zoom));
  const scale = fitScale(size) * nextZoom;
  return constrainView({ zoom: nextZoom, x: point.x - (px - size.width / 2) / scale, y: point.y - (py - size.height / 2) / scale }, size);
}
export function lineCells(a: { x: number; y: number }, b: { x: number; y: number }) {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
  const points = new Set<number>();
  for (let i = 0; i <= steps; i++) points.add(Math.round(a.y + (b.y - a.y) * i / steps) * COLS + Math.round(a.x + (b.x - a.x) * i / steps));
  return [...points];
}
