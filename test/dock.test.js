const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BALL_PEEK,
  BALL_SIZE,
  ballBounds,
  createDockSession,
  nearestEdge,
  panelBounds,
} = require("../electron/dock");

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };

test("a window near a screen edge docks, including the top, and one in the middle does not", () => {
  assert.equal(nearestEdge({ x: 90, y: 240, width: 360, height: 508 }, display), "left");
  assert.equal(nearestEdge({ x: 1460, y: 240, width: 360, height: 508 }, display), "right");
  assert.equal(nearestEdge({ x: 400, y: 80, width: 360, height: 508 }, display), "top");
  assert.equal(nearestEdge({ x: 400, y: 470, width: 360, height: 508 }, display), "bottom");
  assert.equal(nearestEdge({ x: 400, y: 240, width: 360, height: 508 }, display), null);
});

test("the resting ball tucks past the edge and the slide-out sits fully on screen", () => {
  const tucked = ballBounds("left", 400, display);
  assert.equal(tucked.x, 0);
  assert.equal(tucked.width, BALL_PEEK);
  assert.equal(tucked.height, BALL_SIZE);
  assert.ok(tucked.width < tucked.height);

  const slid = ballBounds("left", 400, display, false);
  assert.equal(slid.x, 0);
  assert.equal(slid.width, BALL_SIZE);
  assert.equal(slid.height, BALL_SIZE);

  const right = ballBounds("right", 400, display);
  assert.equal(right.x, 1920 - BALL_PEEK);
  assert.equal(right.width, BALL_PEEK);
  const rightOut = ballBounds("right", 400, display, false);
  assert.equal(rightOut.x + rightOut.width, 1920);
  assert.equal(rightOut.width, BALL_SIZE);

  const top = ballBounds("top", 400, display);
  assert.equal(top.y, 0);
  assert.equal(top.height, BALL_PEEK);
  const topOut = ballBounds("top", 400, display, false);
  assert.equal(topOut.y, 0);
  assert.equal(topOut.height, BALL_SIZE);

  const bottom = ballBounds("bottom", 400, display);
  assert.equal(bottom.y, 1080 - BALL_PEEK);
  assert.equal(bottom.height, BALL_PEEK);

  const panel = panelBounds("right", 400, display);
  assert.equal(panel.x + panel.width, 1920);
  assert.ok(panel.width > right.width);
});

test("dragging the ball keeps it tucked on the edge", () => {
  const session = createDockSession();
  session.restore({ edge: "left", anchor: 200, x: 0, y: 164 }, display);
  session.drag({ x: 800, y: 20 }, display);
  const parked = session.place(display);
  assert.equal(parked.x, 0);
  assert.equal(parked.width, BALL_PEEK);
  assert.ok(parked.y < 164);
  assert.equal(session.view().tucked, true);
  session.drag({ x: 10, y: 5000 }, display);
  const clamped = session.place(display);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.width, BALL_PEEK);
  assert.equal(clamped.y + clamped.height, 1080);
});

test("hover slides the ball out, opening shows the panel, and leaving tucks it away", () => {
  const session = createDockSession();
  session.restore({ edge: "left", anchor: 200, x: 0, y: 164 }, display);
  assert.equal(session.view().tucked, true);
  assert.equal(session.hover().tucked, true);
  session.leave();
  const slid = session.hover();
  assert.equal(slid.tucked, false);
  assert.equal(slid.ball, true);
  assert.equal(session.place(display).width, BALL_SIZE);
  assert.equal(session.open().ball, false);
  const tucked = session.leave();
  assert.equal(tucked.ball, true);
  assert.equal(tucked.tucked, true);
  assert.equal(session.place(display).width, BALL_PEEK);
});

test("a pointer near the top docks a window that is only close to that edge", () => {
  const session = createDockSession();
  const view = session.snap(
    { x: 400, y: 180, width: 360, height: 508 },
    display,
    { x: 520, y: 36 },
  );
  assert.equal(view.edge, "top");
  assert.equal(view.tucked, true);
  assert.equal(view.suppressHover, true);
  assert.equal(session.place(display).y, 0);
  assert.equal(session.place(display).height, BALL_PEEK);
});

test("snapping an already tucked ball does not arm hover suppression again", () => {
  const session = createDockSession();
  session.restore({ edge: "left", anchor: 200, x: 0, y: 164 }, display);
  session.leave();
  const again = session.snap(
    { x: 0, y: 164, width: BALL_PEEK, height: BALL_SIZE },
    display,
    { x: 8, y: 200 },
  );
  assert.equal(again.edge, "left");
  assert.equal(again.tucked, true);
  assert.equal(again.suppressHover, false);
});

test("choosing a place collapses a free panel onto an edge", () => {
  const session = createDockSession();
  const view = session.collapseNow({ x: 500, y: 120, width: 360, height: 508 }, display);
  assert.equal(view.ball, true);
  assert.equal(view.tucked, true);
  assert.ok(view.edge);
  const parked = session.place(display);
  assert.ok(parked.width === BALL_PEEK || parked.height === BALL_PEEK);
});
