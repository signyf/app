const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ballBounds,
  createDockSession,
  nearestEdge,
  panelBounds,
} = require("../electron/dock");

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };

test("a window left on a screen edge docks, and one in the middle does not", () => {
  assert.equal(nearestEdge({ x: 4, y: 200, width: 360, height: 508 }, display), "left");
  assert.equal(nearestEdge({ x: 1540, y: 200, width: 360, height: 508 }, display), "right");
  assert.equal(nearestEdge({ x: 400, y: 2, width: 360, height: 508 }, display), "top");
  assert.equal(nearestEdge({ x: 400, y: 560, width: 360, height: 508 }, display), "bottom");
  assert.equal(nearestEdge({ x: 400, y: 200, width: 360, height: 508 }, display), null);
});

test("the ball stays on the chosen edge and the panel opens inward", () => {
  const left = ballBounds("left", 400, display);
  assert.equal(left.x, 0);
  assert.equal(left.width, left.height);
  const right = ballBounds("right", 400, display);
  assert.equal(right.x + right.width, 1920);
  const top = ballBounds("top", 400, display);
  assert.equal(top.y, 0);
  const bottom = ballBounds("bottom", 400, display);
  assert.equal(bottom.y + bottom.height, 1080);

  const panel = panelBounds("right", 400, display);
  assert.equal(panel.x + panel.width, 1920);
  assert.ok(panel.width > right.width);
});

test("dragging the ball keeps it on the edge", () => {
  const session = createDockSession();
  session.restore({ edge: "left", anchor: 200, x: 0, y: 164 }, display);
  session.drag({ x: 800, y: 20 }, display);
  const parked = session.place(display);
  assert.equal(parked.x, 0);
  assert.ok(parked.y < 164);
  session.drag({ x: 10, y: 5000 }, display);
  const clamped = session.place(display);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y + clamped.height, 1080);
});

test("hover opens the docked panel and leaving collapses it back to the ball", () => {
  const session = createDockSession();
  session.restore({ x: 0, y: 100 }, display);
  assert.equal(session.view().ball, true);
  assert.equal(session.hover().ball, true);
  session.leave();
  assert.equal(session.hover().ball, false);
  assert.equal(session.leave().ball, true);
});

test("choosing a place collapses a free panel onto an edge", () => {
  const session = createDockSession();
  const view = session.collapseNow({ x: 500, y: 120, width: 360, height: 508 }, display);
  assert.equal(view.ball, true);
  assert.ok(view.edge);
  const parked = session.place(display);
  assert.equal(parked.width, parked.height);
});
