/** Use signed depth along the view axis, not radial distance (panning changes both). */
export function sceneCameraClipping(centerDepth: number, radius: number) {
  if (!Number.isFinite(centerDepth) || !Number.isFinite(radius) || radius <= 0) {
    throw new Error(`Invalid scene clipping bounds: centerDepth=${centerDepth}, radius=${radius}`);
  }
  const paddedRadius = radius * 1.15;
  const near = Math.max(0.001, radius * 0.001, centerDepth - paddedRadius);
  const far = Math.max(near * 2, centerDepth + paddedRadius);
  return { near, far };
}
