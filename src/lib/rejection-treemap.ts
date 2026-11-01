/** Deterministic squarified layout. Geometry carries exact area; hit targets never inflate it. */
export type TreemapValue = { key: string; count: number };
export type TreemapRect = TreemapValue & { x: number; y: number; width: number; height: number; share: number };
export function layoutReasonTreemap(values: readonly TreemapValue[], width: number, height: number): TreemapRect[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const rows = values.filter(row => Number.isFinite(row.count) && row.count > 0).slice().sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const total = rows.reduce((n, row) => n + row.count, 0);
  if (!total) return [];
  const items = rows.map(row => ({ ...row, area: row.count / total * width * height })), result: TreemapRect[] = [];
  let x = 0, y = 0, w = width, h = height, index = 0;
  function worst(row: typeof items, side: number) {
    const sum = row.reduce((n, item) => n + item.area, 0), min = row[row.length - 1].area, max = row[0].area;
    return Math.max(side * side * max / (sum * sum), sum * sum / (side * side * min));
  }
  while (index < items.length) {
    const strip = [items[index++]], side = Math.min(w, h);
    while (index < items.length && worst([...strip, items[index]], side) <= worst(strip, side)) strip.push(items[index++]);
    const area = strip.reduce((n, item) => n + item.area, 0);
    if (w >= h) {
      const stripWidth = area / h; let top = y;
      for (const item of strip) { const itemHeight = item.area / stripWidth; result.push({ key: item.key, count: item.count, share: item.count / total, x, y: top, width: stripWidth, height: itemHeight }); top += itemHeight; }
      x += stripWidth; w = Math.max(0, width - x);
    } else {
      const stripHeight = area / w; let left = x;
      for (const item of strip) { const itemWidth = item.area / stripHeight; result.push({ key: item.key, count: item.count, share: item.count / total, x: left, y, width: itemWidth, height: stripHeight }); left += itemWidth; }
      y += stripHeight; h = Math.max(0, height - y);
    }
  }
  return result;
}
