import { CardRarity } from '../../types/Enums';
import { CardDef } from '../../types/CardTypes';
import { FactionPool, CardSource } from '../faction/FactionPool';
import { FloorManager } from '../run/FloorManager';
import { SeededRandom } from '../utils/SeededRandom';

// ─── 品质掉落概率 ─────────────────────────────────────

/**
 * 基础品质掉落概率（来自 Enums.CardRarity 注释）。
 * 普通 55% / 稀有 30% / 史诗 12% / 传说 3%。
 */
const BASE_RARITY_WEIGHTS: { rarity: CardRarity; weight: number }[] = [
    { rarity: CardRarity.NORMAL, weight: 0.55 },
    { rarity: CardRarity.RARE, weight: 0.30 },
    { rarity: CardRarity.EPIC, weight: 0.12 },
    { rarity: CardRarity.LEGENDARY, weight: 0.03 },
];

/** 7 层以上紫/金掉率各 +5%，白掉率 -10% */
const HIGH_FLOOR_BONUS = 0.05;

const REWARD_CARD_COUNT = 3;

const RARITY_ORDER: Record<CardRarity, number> = {
    [CardRarity.NORMAL]: 0,
    [CardRarity.RARE]: 1,
    [CardRarity.EPIC]: 2,
    [CardRarity.LEGENDARY]: 3,
};

const RARITIES_BY_ORDER: CardRarity[] = [
    CardRarity.NORMAL, CardRarity.RARE, CardRarity.EPIC, CardRarity.LEGENDARY,
];

// ─── 主类 ──────────────────────────────────────────────

/**
 * RewardGenerator —— 卡牌奖励生成器。
 *
 * 职责：
 * - 战斗胜利后生成 3 张候选卡牌供玩家三选一
 * - 品质按概率掷骰（55%/30%/12%/3%），7 层以上紫/金各 +5%
 * - 精英路线必出稀有及以上品质
 * - 候选卡牌来自流派池 + 通用，不出现池外卡
 * - 3 张候选不重复
 *
 * 纯静态方法，不持有可变状态，不依赖引擎 API。
 */
export class RewardGenerator {

    /**
     * 生成战斗后卡牌奖励候选列表（3 选 1）。
     *
     * 流程：
     * 1. 构建品质权重（考虑高层加成 + 精英最低品质）
     * 2. 为每个槽位独立掷品质
     * 3. 从对应品质的可用卡中按 dropWeight 选取（不重复）
     * 4. 若掷出品质无可用卡，向下降级
     *
     * @param factionPool 当前局流派池
     * @param allCards 全部卡牌静态定义
     * @param floor 当前层数
     * @param isElite 是否精英路线（必出稀有及以上）
     * @param rng 种子随机数生成器
     */
    static generateCardReward(
        factionPool: FactionPool,
        allCards: CardDef[],
        floor: number,
        isElite: boolean,
        rng: SeededRandom,
    ): CardDef[] {
        const weights = RewardGenerator.buildRarityWeights(floor, isElite);
        const allAvailable = factionPool.filterAvailableCards(
            allCards, CardSource.BATTLE_REWARD, floor,
        );

        if (allAvailable.length === 0) return [];

        const result: CardDef[] = [];
        const usedIds = new Set<string>();

        for (let i = 0; i < REWARD_CARD_COUNT; i++) {
            const rarity = RewardGenerator.rollRarity(weights, rng);
            const picked = RewardGenerator._pickCardByRarity(
                allAvailable, rarity, usedIds, rng,
            );
            if (!picked) break;
            result.push(picked);
            usedIds.add(picked.id);
        }

        return result;
    }

    /**
     * 构建品质权重分布。
     * - 基础：NORMAL 55% / RARE 30% / EPIC 12% / LEGENDARY 3%
     * - 7 层以上：EPIC +5%、LEGENDARY +5%、NORMAL -10%
     * - 精英路线：移除 NORMAL，按比例重分配
     */
    static buildRarityWeights(
        floor: number,
        isElite: boolean,
    ): { rarity: CardRarity; weight: number }[] {
        let weights = BASE_RARITY_WEIGHTS.map(w => ({ ...w }));

        if (FloorManager.hasHighRarityBonus(floor)) {
            const epicEntry = weights.find(w => w.rarity === CardRarity.EPIC)!;
            const legendEntry = weights.find(w => w.rarity === CardRarity.LEGENDARY)!;
            const normalEntry = weights.find(w => w.rarity === CardRarity.NORMAL)!;

            epicEntry.weight += HIGH_FLOOR_BONUS;
            legendEntry.weight += HIGH_FLOOR_BONUS;
            normalEntry.weight -= HIGH_FLOOR_BONUS * 2;
        }

        if (isElite) {
            weights = weights.filter(w => RARITY_ORDER[w.rarity] >= RARITY_ORDER[CardRarity.RARE]);
            const total = weights.reduce((s, w) => s + w.weight, 0);
            if (total > 0) {
                for (const w of weights) {
                    w.weight = w.weight / total;
                }
            }
        }

        return weights;
    }

    /**
     * 按权重分布掷出一个品质。
     */
    static rollRarity(
        weights: { rarity: CardRarity; weight: number }[],
        rng: SeededRandom,
    ): CardRarity {
        const roll = rng.next();
        let cumulative = 0;
        for (const { rarity, weight } of weights) {
            cumulative += weight;
            if (roll < cumulative) return rarity;
        }
        return weights[weights.length - 1].rarity;
    }

    // ─── 私有方法 ──────────────────────────────────────

    /**
     * 从可用卡中选取指定品质的卡牌，若该品质无可用卡则逐级降级。
     * 按 dropWeight 加权随机选取。
     */
    private static _pickCardByRarity(
        available: CardDef[],
        targetRarity: CardRarity,
        usedIds: Set<string>,
        rng: SeededRandom,
    ): CardDef | null {
        const unused = available.filter(c => !usedIds.has(c.id));
        if (unused.length === 0) return null;

        const exact = unused.filter(c => c.rarity === targetRarity);
        if (exact.length > 0) return RewardGenerator._pickWeighted(exact, rng);

        const order = RARITY_ORDER[targetRarity];
        for (let o = order - 1; o >= 0; o--) {
            const fallback = unused.filter(c => c.rarity === RARITIES_BY_ORDER[o]);
            if (fallback.length > 0) return RewardGenerator._pickWeighted(fallback, rng);
        }
        for (let o = order + 1; o < RARITIES_BY_ORDER.length; o++) {
            const fallback = unused.filter(c => c.rarity === RARITIES_BY_ORDER[o]);
            if (fallback.length > 0) return RewardGenerator._pickWeighted(fallback, rng);
        }

        return rng.pick(unused);
    }

    /** 按 dropWeight 加权随机选一张 */
    private static _pickWeighted(cards: CardDef[], rng: SeededRandom): CardDef {
        if (cards.length === 1) return cards[0];
        const weights = cards.map(c => c.dropWeight);
        return rng.pickWeighted(cards, weights);
    }
}
