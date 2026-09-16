(function () {
  const PROFILE = Object.freeze({ id: "summoners-rift-ddragon-16.18.1", left: 0, top: 0, width: 100, height: 100, flipY: false });
  function toMapPoint(point, profile = PROFILE) {
    if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) throw new Error("invalid map point");
    const y = profile.flipY ? 100 - point.y : point.y;
    return { ...point, sourceX: point.x, sourceY: point.y, x: profile.left + point.x * profile.width / 100, y: profile.top + y * profile.height / 100 };
  }
  function applyTimeline(timeline, profile = PROFILE) {
    return { ...timeline, coordinateProfile: profile.id, frames: timeline.frames.map(frame => ({ ...frame, visible: frame.visible.map(point => toMapPoint(point, profile)) })) };
  }
  window.Team1030MapCoordinates = { PROFILE, toMapPoint, applyTimeline };
})();
