// utils/utils.ts - 优化后的工具函数
export function getRandomElement<T>(arr: readonly T[], random: () => number = Math.random): T {
  if (arr.length === 0) {
    throw new Error('Cannot get random element from empty array');
  }
  return arr[Math.floor(random() * arr.length)];
}

// 为了向后兼容，提供一个安全版本
export function getRandomElementSafe<T>(arr: readonly T[], random: () => number = Math.random): T | undefined {
  return arr.length === 0 ? undefined : arr[Math.floor(random() * arr.length)];
}