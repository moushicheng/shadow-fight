/**
 * 基于 Mulberry32 算法的种子随机数生成器。
 * 特性：确定性（相同种子 = 相同序列）、分布均匀、性能好。
 */
export class SeededRandom {
    private state: number;

    constructor(seed: number) {
        this.state = seed | 0;
    }

    /** 返回 [0, 1) 的浮点数 */
    next(): number {
        this.state = (this.state + 0x6D2B79F5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** 返回 [min, max] 的整数 */
    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /** 返回 [min, max) 的浮点数 */
    nextFloat(min: number, max: number): number {
        return this.next() * (max - min) + min;
    }

    /** 按概率返回 true（probability 范围 0-1） */
    chance(probability: number): boolean {
        return this.next() < probability;
    }

    /** 从数组中随机选一个 */
    pick<T>(array: T[]): T {
        return array[this.nextInt(0, array.length - 1)];
    }

    /** 从数组中按权重随机选一个 */
    pickWeighted<T>(items: T[], weights: number[]): T {
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let roll = this.nextFloat(0, totalWeight);
        for (let i = 0; i < items.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return items[i];
        }
        return items[items.length - 1];
    }

    /** Fisher-Yates 洗牌（原地修改并返回） */
    shuffle<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /** 从数组中不重复抽取 n 个 */
    sample<T>(array: T[], n: number): T[] {
        const copy = [...array];
        this.shuffle(copy);
        return copy.slice(0, Math.min(n, copy.length));
    }

    /** 生成一个新种子（用于派生子随机序列） */
    deriveSeed(): number {
        return (this.next() * 4294967296) | 0;
    }
}
