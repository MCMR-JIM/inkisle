import type { Point } from '../../src/core/model';

/** Hand-like loops: rounded turns, slight bowed sides and uneven sampling. */
export function roundedRectangleTrace(width: number, height: number, radius: number, rotation = 0, noise = 0, center = { x: 450, y: 400 }): Point[] {
  const corners = [
    { x: width / 2 - radius, y: -height / 2 + radius, angle: -Math.PI / 2 },
    { x: width / 2 - radius, y: height / 2 - radius, angle: 0 },
    { x: -width / 2 + radius, y: height / 2 - radius, angle: Math.PI / 2 },
    { x: -width / 2 + radius, y: -height / 2 + radius, angle: Math.PI },
  ];
  const points: Point[] = [];
  const steps = 18;
  for (let index = 0; index < corners.length; index++) {
    const corner = corners[index], next = corners[(index + 1) % corners.length];
    for (let i = 0; i <= steps; i++) {
      const angle = corner.angle + i / steps * Math.PI / 2;
      points.push({ x: corner.x + radius * Math.cos(angle), y: corner.y + radius * Math.sin(angle) });
    }
    const from = points.at(-1)!;
    const to = { x: next.x + radius * Math.cos(next.angle), y: next.y + radius * Math.sin(next.angle) };
    for (let i = 1; i <= steps; i++) {
      // Uneven speed, including extra samples near each end of a straight run.
      const t = (1 - Math.cos(i / steps * Math.PI)) / 2;
      points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  }
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return points.map((point, i) => ({
    x: center.x + point.x * cos - point.y * sin + Math.sin(i * 1.7) * noise,
    y: center.y + point.x * sin + point.y * cos + Math.cos(i * 2.1) * noise,
  }));
}

export function sampledEllipse(rx: number, ry: number, rotation = 0, exponent = 2, noise = 0, center = { x: 450, y: 400 }): Point[] {
  return Array.from({ length: 181 }, (_, i) => {
    const angle = i / 180 * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
    const x = rx * Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
    const y = ry * Math.sign(sin) * Math.abs(sin) ** (2 / exponent);
    return {
      x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation) + Math.sin(i * 1.3) * noise,
      y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) + Math.cos(i * 1.9) * noise,
    };
  });
}

/** Imperfect four sides: parallel slant, perspective, bowed edges and hand jitter. */
export function skewedRectangleTrace(options: {
  width?: number; height?: number; radius?: number; rotation?: number;
  shear?: number; taper?: number; bow?: number; noise?: number;
  center?: Point;
} = {}): Point[] {
  const { width = 270, height = 170, radius = 38, rotation = .6, shear = .25, taper = .08, bow = 4, noise = 1.2, center = { x: 450, y: 400 } } = options;
  const local = roundedRectangleTrace(width, height, radius, 0, 0, { x: 0, y: 0 });
  return local.map((p, i) => {
    const x = p.x * (1 + taper * p.y / (height / 2)) + p.y * shear + bow * Math.cos(Math.PI * p.y / height);
    const y = p.y + bow * Math.sin(Math.PI * p.x / width);
    return {
      x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation) + noise * Math.sin(i * 1.7),
      y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) + noise * Math.cos(i * 2.1),
    };
  });
}
