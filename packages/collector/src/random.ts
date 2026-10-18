/** 可复现的随机数（mulberry32），测试时传入固定种子 */
export function createRandom(seed = Math.floor(Math.random() * 2 ** 32)) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** [min, max] 之间的整数 */
    int([min, max]: readonly [number, number]): number {
      return Math.floor(min + next() * (max - min + 1));
    },
    shuffle<T>(list: T[]): T[] {
      const a = [...list];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    },
  };
}

export type Random = ReturnType<typeof createRandom>;
