export function getRandomElement<T>(arr: T[], random: () => number = Math.random): T | undefined {
    return arr[Math.floor(random() * arr.length)];
}
