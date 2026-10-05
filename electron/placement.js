function isPositionVisible(position, displays) {
  if (!position || !Array.isArray(displays)) return false;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  return displays.some((display) => {
    const area = display && display.workArea;
    if (!area) return false;
    return position.x > area.x - 20
      && position.y > area.y - 20
      && position.x < area.x + area.width - 80
      && position.y < area.y + area.height - 40;
  });
}

function initialPosition(saved, displays) {
  if (!isPositionVisible(saved, displays)) return {};
  return { x: saved.x, y: saved.y };
}

module.exports = {
  initialPosition,
  isPositionVisible,
};
