import { Faction, CardRarity } from '../../types/Enums';
import { CardDef } from '../../types/CardTypes';
import { SeededRandom } from '../utils/SeededRandom';

/** 不参与随机抽取的流派（COMMON 是通用池，始终可用） */
const SELECTABLE_FACTIONS: Faction[] = [
    Faction.ICE, Faction.FIRE, Faction.POISON, Faction.HEX, Faction.BLOOD,
    Faction.ASSASSIN, Faction.BERSERKER, Faction.GUARDIAN, Faction.MONK, Faction.GAMBLER,
];

/** 流派池配置 */
export interface FactionPoolConfig {
    /** 每局抽取的流派数量（默认 2） */
    poolSize: number;
}

const DEFAULT_CONFIG: FactionPoolConfig = {
    poolSize: 2,
};

/** 卡牌获取渠道 */
export enum CardSource {
    /** 战斗掉落奖励（3 选 1） */
    BATTLE_REWARD = 'BATTLE_REWARD',
    /** 商店购买 */
    SHOP = 'SHOP',
    /** 事件奖励 */
    EVENT = 'EVENT',
}

/**
 * 流派池系统。
 *
 * 每局开始时从 10 个流派中随机抽取若干个组成流派池（数量由配置决定）。
 * 玩家在整局游戏中只能获取 **流派池内 + 通用（COMMON）** 的卡牌。
 *
 * 本类提供：
 * - 流派抽取（配合种子随机，数量可配置）
 * - 卡牌合法性校验（某张卡是否可被当前流派池获取）
 * - 按条件过滤可用卡牌（渠道、层数、品质）
 * - 按权重随机抽取卡牌
 *
 * 不依赖引擎 API，可独立测试。
 */
export class FactionPool {
    private readonly _factions: Faction[];
    private readonly _allowedSet: Set<Faction>;

    constructor(factions: Faction[]) {
        this._factions = [...factions];
        this._allowedSet = new Set([...factions, Faction.COMMON]);
    }

    /** 当前流派池 */
    get factions(): Faction[] {
        return this._factions;
    }

    /** 流派池 + COMMON 组成的完整可用流派集合 */
    get allowedFactions(): Faction[] {
        return [...this._allowedSet];
    }

    /** 流派池大小 */
    get size(): number {
        return this._factions.length;
    }

    /**
     * 从可选流派中随机抽取指定数量的不同流派。
     *
     * @param rng 种子随机数生成器
     * @param config 流派池配置（可选，默认 poolSize = 2）
     */
    static rollFactions(rng: SeededRandom, config: FactionPoolConfig = DEFAULT_CONFIG): Faction[] {
        const count = Math.min(config.poolSize, SELECTABLE_FACTIONS.length);
        return rng.sample(SELECTABLE_FACTIONS, count);
    }

    /** 判断某张卡牌是否属于当前流派池（含 COMMON） */
    isCardAllowed(card: CardDef): boolean {
        return this._allowedSet.has(card.faction);
    }

    /** 判断某个流派是否在当前池中（含 COMMON） */
    isFactionAllowed(faction: Faction): boolean {
        return this._allowedSet.has(faction);
    }

    /**
     * 从全部卡牌定义中，按条件过滤出当前可获取的卡牌列表。
     *
     * @param allCards 全部卡牌静态定义
     * @param source 获取渠道（战斗掉落 / 商店 / 事件）
     * @param floor 当前层数（用于 floorMin/floorMax 过滤）
     * @param minRarity 最低品质要求（可选，精英路线必出稀有及以上时传入）
     */
    filterAvailableCards(
        allCards: CardDef[],
        source: CardSource,
        floor: number,
        minRarity?: CardRarity,
    ): CardDef[] {
        const rarityOrder = getRarityOrder(minRarity);

        return allCards.filter(card => {
            if (!this.isCardAllowed(card)) return false;
            if (card.starterOnly) return false;
            if (floor < card.floorMin || floor > card.floorMax) return false;

            if (rarityOrder !== undefined && getRarityOrder(card.rarity)! < rarityOrder) {
                return false;
            }

            switch (source) {
                case CardSource.BATTLE_REWARD: return card.droppable;
                case CardSource.SHOP: return card.buyable;
                case CardSource.EVENT: return card.eventObtainable;
            }
        });
    }

    /**
     * 从候选卡牌中按 dropWeight 权重随机抽取指定数量（不重复）。
     *
     * @param candidates 候选卡牌列表（已经过 filterAvailableCards 过滤）
     * @param count 抽取数量
     * @param rng 种子随机数生成器
     * @returns 抽到的卡牌定义列表（数量 ≤ count，候选不足时返回全部）
     */
    pickWeightedCards(candidates: CardDef[], count: number, rng: SeededRandom): CardDef[] {
        if (candidates.length <= count) return [...candidates];

        const result: CardDef[] = [];
        const remaining = [...candidates];
        const weights = remaining.map(c => c.dropWeight);

        for (let i = 0; i < count && remaining.length > 0; i++) {
            const picked = pickAndRemoveWeighted(remaining, weights, rng);
            result.push(picked);
        }

        return result;
    }

    /**
     * 判断流派池是否包含某个特定流派（不含 COMMON）。
     * 用于赌徒专属赌约判定等场景。
     */
    hasExactFaction(faction: Faction): boolean {
        return this._factions.includes(faction);
    }
}

// ─── 模块内工具函数 ──────────────────────────────────────

const RARITY_ORDER: Record<CardRarity, number> = {
    [CardRarity.NORMAL]: 0,
    [CardRarity.RARE]: 1,
    [CardRarity.EPIC]: 2,
    [CardRarity.LEGENDARY]: 3,
};

function getRarityOrder(rarity?: CardRarity): number | undefined {
    if (rarity === undefined) return undefined;
    return RARITY_ORDER[rarity];
}

/**
 * 从数组中按权重随机抽取一个元素并移除（同步修改 weights 数组）。
 */
function pickAndRemoveWeighted(
    items: CardDef[],
    weights: number[],
    rng: SeededRandom,
): CardDef {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let roll = rng.nextFloat(0, totalWeight);

    for (let i = 0; i < items.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
            const [picked] = items.splice(i, 1);
            weights.splice(i, 1);
            return picked;
        }
    }

    const [fallback] = items.splice(items.length - 1, 1);
    weights.splice(weights.length - 1, 1);
    return fallback;
}
