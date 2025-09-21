export function getRandomElement<T>(arr: T[]): T | undefined {
    return arr[Math.floor(Math.random() * arr.length)];
}
