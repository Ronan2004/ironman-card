(function (root) {
  'use strict';
  const radians = degrees => degrees * Math.PI / 180;
  const degrees = angle => angle * 180 / Math.PI;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // DeviceOrientation uses intrinsic Z(alpha), X(beta), Y(gamma) rotations.
  // Comparing local coordinate frames avoids the upright-phone gravity dead zone.
  function orientationMatrix({ alpha = 0, beta = 0, gamma = 0 }) {
    const a = radians(alpha || 0), b = radians(beta), g = radians(gamma);
    const ca = Math.cos(a), sa = Math.sin(a);
    const cb = Math.cos(b), sb = Math.sin(b);
    const cg = Math.cos(g), sg = Math.sin(g);
    return [
      ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg,
      sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg,
      -cb * sg, sb, cb * cg
    ];
  }

  function relativeTilt(neutral, current, screenAngle = 0) {
    const normal = [current[2], current[5], current[8]];
    const local = [0, 1, 2].map(column =>
      neutral[column] * normal[0] + neutral[column + 3] * normal[1] + neutral[column + 6] * normal[2]
    );
    const pitch = degrees(Math.atan2(local[1], local[2]));
    const yaw = degrees(Math.atan2(local[0], local[2]));
    const angle = radians(screenAngle);
    return {
      x: pitch * Math.cos(angle) + yaw * Math.sin(angle),
      y: yaw * Math.cos(angle) - pitch * Math.sin(angle)
    };
  }

  const damp = (current, target, damping, elapsedMs) =>
    current + (target - current) * (1 - Math.pow(1 - damping, elapsedMs / (1000 / 60)));
  const smoothstep = progress => {
    const t = clamp(progress, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

  const api = Object.freeze({ clamp, damp, smoothstep, orientationMatrix, relativeTilt });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardMotion = api;
})(globalThis);
