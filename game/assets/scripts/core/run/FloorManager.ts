import { EventCategory, MonsterType } from '../../types/Enums';
import { SeededRandom } from '../utils/SeededRandom';

const MAX_FLOOR = 10;

/** 层级阶段划分 */
export enum FloorTier {
    /** 1-3 层：新手区 */
    NOVICE = 'NOVICE',
    /** 4-6 层：成长区 */
    GROWTH = 'GROWTH',
    /** 7-9 层：挑战区 */
    CHALLENGE = 'CHALLENGE',
    /** 10 层：Boss 层 */
    BOSS = 'BOSS',
}

/** 事件概率分布 */
export interface EventProbabilityDist {
    [EventCategory.POSITIVE]: number;
    [EventCategory.NEUTRAL]: number;
    [EventCategory.NEGATIVE]: number;
}

/** 野怪生成参数 */
export interface MonsterParams {
    /** 属性总点数 = 25 + floor × 3 */
    attributeTotal: number;
    /** 卡组大小 = 3 + floor */
    deckSize: number;
    /** 可携带遗物数量范围 [min, max] */
    relicRange: [number, number];
    /** 可出现的野怪类型 */
    allowedTypes: MonsterType[];
}

/** 精英野怪参数 */
export interface EliteParams {
    /** 精英等效层数 = floor + 2 */
    effectiveFloor: number;
    /** 属性总点数（按等效层数计算） */
    attributeTotal: number;
    /** 卡组大小（按等效层数计算） */
    deckSize: number;
}

/** 层级奖励倍率 */
export interface FloorRewardConfig {
    /** 基础金币奖励 */
    baseGold: number;
    /** 精英金币倍率（相对基础） */
    eliteGoldMultiplier: number;
    /** 高星残影金币加成 */
    highStarGhostGoldBonus: number;
    /** 战斗后遗物掉落概率 */
    relicDropChance: number;
    /** 精英路线遗物掉落概率 */
    eliteRelicDropChance: number;
    /** 高星残影额外遗物掉率加成 */
    highStarGhostRelicBonus: number;
}

/** Boss 层 HP 倍率 */
const BOSS_HP_MULTIPLIER = 1.5;

/** 每层基础金币奖励 */
const BASE_GOLD_PER_FLOOR = [0, 15, 18, 22, 26, 30, 35, 40, 45, 50, 60];

/** 赏金挑战出现概率 */
const BOUNTY_CHANCE = 0.1;

/**
 * 各阶段事件概率分布。
 * 1-3 层正面多，7-9 层负面多。
 */
const EVENT_PROBABILITY: Record<FloorTier, EventProbabilityDist> = {
    [FloorTier.NOVICE]: {
        [EventCategory.POSITIVE]: 0.50,
        [EventCategory.NEUTRAL]: 0.30,
        [EventCategory.NEGATIVE]: 0.20,
    },
    [FloorTier.GROWTH]: {
        [EventCategory.POSITIVE]: 0.35,
        [EventCategory.NEUTRAL]: 0.35,
        [EventCategory.NEGATIVE]: 0.30,
    },
    [FloorTier.CHALLENGE]: {
        [EventCategory.POSITIVE]: 0.20,
        [EventCategory.NEUTRAL]: 0.35,
        [EventCategory.NEGATIVE]: 0.45,
    },
    [FloorTier.BOSS]: {
        [EventCategory.POSITIVE]: 0.20,
        [EventCategory.NEUTRAL]: 0.35,
        [EventCategory.NEGATIVE]: 0.45,
    },
};

/**
 * FloorManager —— 层级配置与规则查询。
 *
 * 职责：
 * - 层级阶段判定（新手/成长/挑战/Boss）
 * - 事件概率分布查询
 * - 野怪生成参数计算（属性、卡组、遗物）
 * - 精英战斗参数计算
 * - 路线选择可用性判定
 * - 奖励配置计算
 *
 * 纯配置 & 计算层，不持有可变状态，不依赖引擎 API。
 */
export class FloorManager {

    /** 获取总层数 */
    static get maxFloor(): number {
        return MAX_FLOOR;
    }

    /** 判断层级所属阶段 */
    static getTier(floor: number): FloorTier {
        if (floor >= 10) return FloorTier.BOSS;
        if (floor >= 7) return FloorTier.CHALLENGE;
        if (floor >= 4) return FloorTier.GROWTH;
        return FloorTier.NOVICE;
    }

    /**
     * 获取指定层的事件概率分布。
     * Boss 层无事件，但仍返回挑战区概率（供 fallback 使用）。
     */
    static getEventProbability(floor: number): EventProbabilityDist {
        return EVENT_PROBABILITY[FloorManager.getTier(floor)];
    }

    /**
     * 按层数概率随机抽取一个事件类别。
     * 使用种子随机保证确定性。
     */
    static rollEventCategory(floor: number, rng: SeededRandom): EventCategory {
        const dist = FloorManager.getEventProbability(floor);
        const roll = rng.next();

        if (roll < dist[EventCategory.POSITIVE]) {
            return EventCategory.POSITIVE;
        }
        if (roll < dist[EventCategory.POSITIVE] + dist[EventCategory.NEUTRAL]) {
            return EventCategory.NEUTRAL;
        }
        return EventCategory.NEGATIVE;
    }

    /**
     * 获取指定层的野怪生成参数。
     * 属性总点 = 25 + floor × 3；卡组大小 = 3 + floor。
     * 遗物规则：1-3 层无，4-6 层 1 个普通，7-9 层 1-2 个。
     */
    static getMonsterParams(floor: number): MonsterParams {
        const attributeTotal = 25 + floor * 3;
        const deckSize = 3 + floor;

        let relicRange: [number, number];
        if (floor <= 3) {
            relicRange = [0, 0];
        } else if (floor <= 6) {
            relicRange = [1, 1];
        } else {
            relicRange = [1, 2];
        }

        const allowedTypes: MonsterType[] = [MonsterType.NORMAL];
        if (floor >= 3) allowedTypes.push(MonsterType.FACTION);
        if (floor >= 6) allowedTypes.push(MonsterType.ELITE);

        return { attributeTotal, deckSize, relicRange, allowedTypes };
    }

    /**
     * 获取精英战斗参数。
     * 精英难度 = 当前层 + 2 的野怪强度。
     */
    static getEliteParams(floor: number): EliteParams {
        const effectiveFloor = Math.min(floor + 2, MAX_FLOOR);
        return {
            effectiveFloor,
            attributeTotal: 25 + effectiveFloor * 3,
            deckSize: 3 + effectiveFloor,
        };
    }

    /**
     * 获取赏金挑战怪物参数。
     * 强度 = 精英参数 × 1.5（属性总点 × 1.5，卡组按精英等效层数）。
     */
    static getBountyParams(floor: number): EliteParams & { bountyAttributeTotal: number } {
        const elite = FloorManager.getEliteParams(floor);
        return {
            ...elite,
            bountyAttributeTotal: Math.round(elite.attributeTotal * 1.5),
        };
    }

    /**
     * 1-2 层路线锁定为普通战斗，3 层起解锁三选一。
     */
    static isRouteChoiceLocked(floor: number): boolean {
        return floor <= 2;
    }

    /** 是否为 Boss 层 */
    static isBossFloor(floor: number): boolean {
        return floor >= MAX_FLOOR;
    }

    /** Boss 层 HP 倍率 */
    static get bossHpMultiplier(): number {
        return BOSS_HP_MULTIPLIER;
    }

    /**
     * 路线三选一中是否出现赏金挑战（10% 概率）。
     */
    static rollBountyChallenge(rng: SeededRandom): boolean {
        return rng.chance(BOUNTY_CHANCE);
    }

    /**
     * 获取指定层的奖励配置。
     */
    static getRewardConfig(floor: number): FloorRewardConfig {
        const baseGold = BASE_GOLD_PER_FLOOR[floor] ?? 30;
        return {
            baseGold,
            eliteGoldMultiplier: 1.5,
            highStarGhostGoldBonus: 0.3,
            relicDropChance: 0.20,
            eliteRelicDropChance: 0.25,
            highStarGhostRelicBonus: 0.10,
        };
    }

    /**
     * 计算某层普通战斗的金币奖励。
     */
    static calcBattleGold(floor: number, isElite: boolean): number {
        const config = FloorManager.getRewardConfig(floor);
        const gold = config.baseGold;
        return isElite ? Math.round(gold * config.eliteGoldMultiplier) : gold;
    }

    /**
     * 获取指定层可出现的最高卡牌品质加成信息。
     * 7 层以上紫/金掉率各 +5%。
     */
    static hasHighRarityBonus(floor: number): boolean {
        return floor >= 7;
    }

    /**
     * 获取难度描述（调试/日志用）。
     */
    static describeFloor(floor: number): string {
        const tier = FloorManager.getTier(floor);
        const params = FloorManager.getMonsterParams(floor);
        return `第${floor}层[${tier}] 怪物属性${params.attributeTotal}点 卡组${params.deckSize}张 遗物${params.relicRange[0]}-${params.relicRange[1]}个`;
    }
}
