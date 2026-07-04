// game/seas/town/nav.js — PURE navigation math for the walkable Port Royal map.
// No DOM, no globals: just graph + rail helpers so the movement logic is unit-testable
// (see nav.test.js). The page (index.html) imports these; tests import the same source.

/** Build an undirected adjacency map from a list of [a,b] edges. */
export function buildAdj(edges){
  const adj = {};
  for (const [a, b] of edges){
    (adj[a] ||= []).push(b);
    (adj[b] ||= []).push(a);
  }
  return adj;
}

/** Breadth-first shortest path (by edge count) from start to goal.
 *  Returns the node-id path INCLUDING start and goal, or [] if unreachable.
 *  If start === goal returns [start]. */
export function bfsPath(adj, start, goal){
  if (start === goal) return [start];
  const prev = { [start]: null };
  const queue = [start];
  while (queue.length){
    const cur = queue.shift();
    for (const nxt of (adj[cur] || [])){
      if (nxt in prev) continue;
      prev[nxt] = cur;
      if (nxt === goal){
        const path = [];
        let n = goal;
        while (n != null){ path.unshift(n); n = prev[n]; }
        return path;
      }
      queue.push(nxt);
    }
  }
  return [];
}

/** Given the current node, a direction vector (dx,dy in screen space, y-down),
 *  and node positions {id:{x,y}} (any consistent units), pick the neighbour whose
 *  outgoing direction best matches the input. Returns neighbour id or null if no
 *  neighbour is within the cone (dot-product threshold). */
export function bestNeighborByDir(positions, adj, current, dx, dy){
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return null;
  const ux = dx / mag, uy = dy / mag;
  const here = positions[current];
  let best = null, bestDot = 0.30; // cone threshold — ignore near-perpendicular/opposite
  for (const nb of (adj[current] || [])){
    const p = positions[nb];
    const vx = p.x - here.x, vy = p.y - here.y;
    const vm = Math.hypot(vx, vy);
    if (vm < 1e-6) continue;
    const dot = (vx / vm) * ux + (vy / vm) * uy;
    if (dot > bestDot){ bestDot = dot; best = nb; }
  }
  return best;
}

/** Linear interpolate. */
export function lerp(a, b, t){ return a + (b - a) * t; }
