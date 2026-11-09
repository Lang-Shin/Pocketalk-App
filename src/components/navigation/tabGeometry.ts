export const TAB_COUNT = 5;
export const BAR_TOP = 24;
export const BAR_HEIGHT = 68;
export const INDICATOR_SIZE = 44;

export function tabCenter(width: number, index: number, count = TAB_COUNT): number {
  'worklet';
  return (width / count) * (index + 0.5);
}

export function curvedBarPath(width: number, center: number, count = TAB_COUNT): string {
  'worklet';
  const radius = Math.min(28, width / count / 2 - 3);
  const corner = Math.min(16, Math.max(0, center - radius), Math.max(0, width - center - radius));
  const left = center - radius;
  const right = center + radius;
  const bottom = BAR_TOP + BAR_HEIGHT;
  return `M ${corner} ${BAR_TOP} H ${left} C ${left + radius * 0.35} ${BAR_TOP} ${center - radius * 0.65} ${BAR_TOP + 22} ${center} ${BAR_TOP + 22} C ${center + radius * 0.65} ${BAR_TOP + 22} ${right - radius * 0.35} ${BAR_TOP} ${right} ${BAR_TOP} H ${width - corner} Q ${width} ${BAR_TOP} ${width} ${BAR_TOP + corner} V ${bottom - corner} Q ${width} ${bottom} ${width - corner} ${bottom} H ${corner} Q 0 ${bottom} 0 ${bottom - corner} V ${BAR_TOP + corner} Q 0 ${BAR_TOP} ${corner} ${BAR_TOP} Z`;
}
