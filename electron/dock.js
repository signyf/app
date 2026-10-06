const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 508;
const BALL_SIZE = 72;
const EDGE_PX = 28;

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function workAreaOf(display) {
  if (!display || !display.workArea) return null;
  const area = display.workArea;
  if (![area.x, area.y, area.width, area.height].every((item) => Number.isFinite(item))) return null;
  if (area.width <= 0 || area.height <= 0) return null;
  return area;
}

function displayForBounds(bounds, displays) {
  const list = (Array.isArray(displays) ? displays : []).filter((display) => workAreaOf(display));
  if (!list.length || !bounds) return null;
  const cx = bounds.x + (Number.isFinite(bounds.width) ? bounds.width / 2 : 0);
  const cy = bounds.y + (Number.isFinite(bounds.height) ? bounds.height / 2 : 0);
  const hit = list.find((display) => {
    const area = workAreaOf(display);
    return cx >= area.x && cy >= area.y && cx < area.x + area.width && cy < area.y + area.height;
  });
  if (hit) return hit;
  let best = list[0];
  let bestDistance = Infinity;
  for (const display of list) {
    const area = workAreaOf(display);
    const dx = cx - (area.x + area.width / 2);
    const dy = cy - (area.y + area.height / 2);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return best;
}

function edgeDistances(bounds, display) {
  const area = workAreaOf(display);
  if (!area || !bounds) return [];
  const width = Number.isFinite(bounds.width) ? bounds.width : PANEL_WIDTH;
  const height = Number.isFinite(bounds.height) ? bounds.height : PANEL_HEIGHT;
  return [
    ["left", bounds.x - area.x],
    ["right", area.x + area.width - (bounds.x + width)],
    ["top", bounds.y - area.y],
    ["bottom", area.y + area.height - (bounds.y + height)],
  ].sort((left, right) => left[1] - right[1]);
}

function nearestEdge(bounds, display, threshold = EDGE_PX) {
  const distances = edgeDistances(bounds, display);
  if (!distances.length) return null;
  if (threshold != null && distances[0][1] > threshold) return null;
  return distances[0][0];
}

function anchorOnEdge(edge, bounds) {
  if (!bounds) return 0;
  if (edge === "left" || edge === "right") {
    const height = Number.isFinite(bounds.height) ? bounds.height : 0;
    return bounds.y + height / 2;
  }
  const width = Number.isFinite(bounds.width) ? bounds.width : 0;
  return bounds.x + width / 2;
}

function ballBounds(edge, anchor, display) {
  const area = workAreaOf(display);
  if (!area || !edge) return null;
  const size = Math.min(BALL_SIZE, area.width, area.height);
  if (edge === "left" || edge === "right") {
    const y = clamp(anchor - size / 2, area.y, area.y + area.height - size);
    const x = edge === "left" ? area.x : area.x + area.width - size;
    return { x: Math.round(x), y: Math.round(y), width: size, height: size };
  }
  const x = clamp(anchor - size / 2, area.x, area.x + area.width - size);
  const y = edge === "top" ? area.y : area.y + area.height - size;
  return { x: Math.round(x), y: Math.round(y), width: size, height: size };
}

function panelBounds(edge, anchor, display) {
  const area = workAreaOf(display);
  if (!area || !edge) return null;
  const width = Math.min(PANEL_WIDTH, area.width);
  const height = Math.min(PANEL_HEIGHT, area.height);
  if (edge === "left" || edge === "right") {
    const y = clamp(anchor - height / 2, area.y, area.y + area.height - height);
    const x = edge === "left" ? area.x : area.x + area.width - width;
    return { x: Math.round(x), y: Math.round(y), width, height };
  }
  const x = clamp(anchor - width / 2, area.x, area.x + area.width - width);
  const y = edge === "top" ? area.y : area.y + area.height - height;
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function createDockSession() {
  let edge = null;
  let anchor = null;
  let expanded = true;
  let suppressHover = false;

  function view() {
    return {
      edge,
      anchor,
      expanded,
      ball: Boolean(edge) && !expanded,
      suppressHover,
    };
  }

  function park(nextEdge, nextAnchor) {
    edge = nextEdge;
    anchor = nextAnchor;
    expanded = false;
    suppressHover = true;
  }

  return {
    view,
    place(display) {
      if (!edge) return null;
      return expanded ? panelBounds(edge, anchor, display) : ballBounds(edge, anchor, display);
    },
    restore(saved, display) {
      if (saved && (saved.edge === "left" || saved.edge === "right" || saved.edge === "top" || saved.edge === "bottom")) {
        const fallback = saved.edge === "left" || saved.edge === "right" ? saved.y : saved.x;
        park(saved.edge, Number.isFinite(saved.anchor) ? saved.anchor : fallback);
        return view();
      }
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const guessed = { x: saved.x, y: saved.y, width: PANEL_WIDTH, height: PANEL_HEIGHT };
        const found = nearestEdge(guessed, display);
        if (found) park(found, anchorOnEdge(found, guessed));
      }
      return view();
    },
    hover() {
      if (!edge || suppressHover) return view();
      expanded = true;
      return view();
    },
    leave() {
      suppressHover = false;
      if (edge) expanded = false;
      return view();
    },
    open() {
      if (!edge) return view();
      suppressHover = false;
      expanded = true;
      return view();
    },
    collapseNow(bounds, display) {
      if (!edge) {
        const found = nearestEdge(bounds, display, null) || "right";
        const area = workAreaOf(display);
        const nextAnchor = bounds ? anchorOnEdge(found, bounds) : (area ? area.y + area.height / 2 : 0);
        park(found, nextAnchor);
      } else {
        park(edge, anchor);
      }
      return view();
    },
    snap(bounds, display) {
      const found = nearestEdge(bounds, display);
      if (found) {
        park(found, anchorOnEdge(found, bounds));
        return view();
      }
      if (edge) {
        edge = null;
        expanded = true;
        suppressHover = false;
      }
      return view();
    },
    drag(point, display) {
      if (!edge || !point) return view();
      anchor = edge === "left" || edge === "right" ? point.y : point.x;
      expanded = false;
      const area = workAreaOf(display);
      if (area) {
        const parked = ballBounds(edge, anchor, display);
        anchor = edge === "left" || edge === "right" ? parked.y + parked.height / 2 : parked.x + parked.width / 2;
      }
      return view();
    },
  };
}

module.exports = {
  PANEL_WIDTH,
  PANEL_HEIGHT,
  BALL_SIZE,
  EDGE_PX,
  displayForBounds,
  nearestEdge,
  anchorOnEdge,
  ballBounds,
  panelBounds,
  createDockSession,
};
