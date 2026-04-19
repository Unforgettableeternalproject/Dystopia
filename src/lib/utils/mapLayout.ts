// mapLayout.ts — BFS-based radial layout for map nodes.
// Positions the start node at center; connected nodes radiate outward in rings.

export interface LayoutNode {
  id: string;
  connections: string[];
}

/**
 * Compute (x, y) pixel positions for a set of nodes via BFS from startId.
 * Ring 0 (start) = center. Each successive BFS layer is placed on a larger circle.
 * Disconnected nodes fall into the outermost ring.
 *
 * @param nodes    Full list of nodes to position.
 * @param startId  Node to place at the center (ring 0).
 * @param width    SVG canvas width in pixels.
 * @param height   SVG canvas height in pixels.
 */
export function bfsLayout(
  nodes:   LayoutNode[],
  startId: string,
  width:   number,
  height:  number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const nodeMap  = new Map(nodes.map(n => [n.id, n]));
  const visited  = new Set<string>();
  const rings:     string[][] = [];

  // BFS
  let frontier = nodeMap.has(startId) ? [startId] : [nodes[0].id];
  visited.add(frontier[0]);

  while (frontier.length > 0) {
    rings.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      for (const connId of nodeMap.get(id)?.connections ?? []) {
        if (!visited.has(connId) && nodeMap.has(connId)) {
          visited.add(connId);
          next.push(connId);
        }
      }
    }
    frontier = next;
  }

  // Any disconnected nodes land in a final overflow ring
  const disconnected = nodes.filter(n => !visited.has(n.id));
  if (disconnected.length > 0) rings.push(disconnected.map(n => n.id));

  const cx = width  / 2;
  const cy = height / 2;
  const ringCount = rings.length;
  // Pad edges slightly so nodes don't clip the SVG border
  const maxRadius = Math.min(width, height) / 2 - 14;
  const ringStep  = ringCount > 1 ? maxRadius / (ringCount - 1) : 0;

  for (let r = 0; r < rings.length; r++) {
    const ids    = rings[r];
    const radius = r * ringStep;

    if (r === 0 || ids.length === 1) {
      // Single node: place on the ring axis (top, for rings > 0)
      if (r === 0) {
        positions.set(ids[0], { x: cx, y: cy });
      } else {
        positions.set(ids[0], { x: cx, y: cy - radius });
      }
      continue;
    }

    // Offset alternate rings by half a sector to reduce edge crossings
    const angleOffset = (r % 2 === 0 ? 0 : Math.PI / ids.length) - Math.PI / 2;
    for (let i = 0; i < ids.length; i++) {
      const angle = (2 * Math.PI * i) / ids.length + angleOffset;
      positions.set(ids[i], {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    }
  }

  return positions;
}
