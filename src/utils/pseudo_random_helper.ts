import { createHash } from 'crypto';

export type RandomAlgorithm = 'xoshiro256pp' | 'pcg64';
export type BiasType = 'slight_up' | 'moderate_up' | 'none' | 'slight_down' | 'moderate_down';

export interface RandomOptions {
    algorithm?: RandomAlgorithm;
    bias?: BiasType | number; // BiasType 或自定义偏移值 (0-0.2)
    seed?: string;
}

/**
 * 生成单个随机数 [0, 1)
 */
export function random(seed: string, options: RandomOptions = {}): number {
    const generator = createGenerator(seed, options);
    return generator();
}

/**
 * 生成指定范围的随机整数 [min, max]
 */
export function randomInt(
    min: number,
    max: number,
    seed: string = '',
    options: RandomOptions = {}
): number {
    const value = seed.length > 0 ? random(seed, options) : Math.random();
    return Math.floor(value * (max - min + 1)) + min;
}

/**
 * 生成指定范围的随机浮点数 [min, max)
 */
export function randomFloat(
    min: number,
    max: number,
    seed: string = '',
    options: RandomOptions = {}
): number {
    const value = seed.length > 0 ? random(seed, options) : Math.random();
    return value * (max - min) + min;
}

/**
 * 生成随机布尔值
 */
export function randomBool(
    seed: string,
    probability: number = 0.5,
    options: RandomOptions = {}
): boolean {
    return (seed.length > 0 ? random(seed, options) : Math.random()) < probability;
}

/**
 * 从数组中随机选择元素
 */
export function randomChoice<T>(
    array: T[] | readonly T[],
    seed: string = '',
    options: RandomOptions = {}
): T {
    const index = Math.floor(
        seed.length > 0 ? random(seed, options) * array.length : Math.random() * array.length
    );
    return array[index];
}

/**
 * 生成正态分布随机数
 * @param seed 种子
 * @param mean 均值
 * @param stdDev 标准差
 * @param options 随机数选项
 * @returns 服从正态分布的随机数
 */
export function normalRandom(
    seed: string,
    mean: number,
    stdDev: number,
    options: RandomOptions = {}
): number {
    // 使用 Box-Muller 变换生成正态分布随机数
    // 生成两个均匀分布的随机数
    const u1 = random(seed, options);
    const u2 = random(seed + 'second', options);

    // Box-Muller 变换
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    // 应用均值和标准差
    return z0 * stdDev + mean;
}

/**
 * 创建随机数生成器
 */
export function createGenerator(seed: string, options: RandomOptions): () => number {
    const { algorithm = 'xoshiro256pp', bias = 'none' } = options;

    let baseGenerator: () => number;

    switch (algorithm) {
        case 'pcg64':
            baseGenerator = createPcg64Generator(seed);
            break;
        case 'xoshiro256pp':
            baseGenerator = createXoshiro256ppGenerator(seed);
            break;
        default:
            throw new Error(`Unknown algorithm: ${algorithm}`);
    }

    return applyBias(baseGenerator, bias);
}

// ===== 辅助函数 =====
function createXoshiro256ppGenerator(seed: string): () => number {
    const hash = createHash('sha256').update(seed).digest();
    let s0 = BigInt(hash.readBigUInt64BE(0));
    let s1 = BigInt(hash.readBigUInt64BE(8));
    let s2 = BigInt(hash.readBigUInt64BE(16));
    let s3 = BigInt(hash.readBigUInt64BE(24));

    if (s0 === 0n && s1 === 0n && s2 === 0n && s3 === 0n) {
        s0 = 1n;
    }

    const rotl = (x: bigint, k: number): bigint => {
        return (x << BigInt(k)) | (x >> BigInt(64 - k));
    };

    return () => {
        const result = rotl(s0 + s3, 23) + s0;
        const t = s1 << 17n;

        s2 ^= s0;
        s3 ^= s1;
        s1 ^= s2;
        s0 ^= s3;

        s2 ^= t;

        s3 = rotl(s3, 45);

        return Number(result & ((1n << 64n) - 1n)) / Number(1n << 64n); // 归一化到 [0, 1)
    };
}

// 目前有问题，先用 xoshiro256pp 代替
function createPcg64Generator(seed: string): () => number {
    const hash = createHash('sha256').update(seed).digest();
    let state: bigint = (BigInt(hash.readBigUInt64BE(0)) << 64n) | BigInt(hash.readBigUInt64BE(8));
    let inc: bigint = (BigInt(hash.readBigUInt64BE(16)) << 1n) | 1n; // 确保奇数

    if (state === 0n) {
        state = 1n;
    }

    const PCG_DEFAULT_MULTIPLIER_128 = 2549297995355413924n * 4865540591571396615n;
    const PCG_DEFAULT_INCREMENT_128 = inc;

    const rotr = (value: bigint, rot: bigint): bigint => {
        const mask = (1n << 64n) - 1n;
        return ((value >> rot) | (value << (-rot & 63n))) & mask;
    };

    return () => {
        const oldState = state;
        state =
            (oldState * PCG_DEFAULT_MULTIPLIER_128 + PCG_DEFAULT_INCREMENT_128) &
            ((1n << 128n) - 1n);
        const word = ((oldState >> 64n) ^ oldState) & ((1n << 64n) - 1n);
        const rot = oldState >> 122n;
        const result = rotr(word, rot);

        // 修复归一化：使用高 53 位，避免精度丢失
        return Number(result >> 11n) / (1 << 21);
    };
}

export function applyBias(generator: () => number, bias: BiasType | number): () => number {
    let power: number;

    if (typeof bias === 'number') {
        // 映射 bias 到 [0, 2]，1 表示无偏置
        power = 1 + Math.max(-1, Math.min(1, bias));
    } else {
        switch (bias) {
            case 'slight_up':
                power = 0.7;
                break; // 轻微向上
            case 'moderate_up':
                power = 0.5;
                break; // 中等向上
            case 'slight_down':
                power = 1.3;
                break; // 轻微向下
            case 'moderate_down':
                power = 1.5;
                break; // 中等向下
            case 'none':
            default:
                power = 1;
                break; // 无偏置
        }
    }

    if (power === 1) return generator; // 无偏置时返回原生成器

    return () => {
        const x = generator(); // 使用提供的 generator
        // 使用幂函数调整偏置
        return power < 1 ? Math.pow(x, power) : 1 - Math.pow(1 - x, 1 / power);
    };
}
