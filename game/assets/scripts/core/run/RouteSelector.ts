import { RouteType, GameNodeType } from '../../types/Enums';
import { MonsterTemplate } from '../../types/MonsterTypes';
import { RunState } from '../../types/RunTypes';
import { SeededRandom } from '../utils/SeededRandom';
import { FloorManager } from './FloorManager';

/**
 * 单个路线选项——展示给玩家的信息。
 * 每个选项包含路线类型和预生成的怪物信息（名称用于 UI 展示）。
 */
export interface RouteOption {
    /** 路线类型 */
    routeType: RouteType;
    /** 怪物模板 ID（用于后续生成战斗实例） */
    monsterId: string;
    /** 怪物显示名称（展示给玩家） */
    monsterName: string;
    /** 怪物流派标签（可选，用于 UI 展示） */
    monsterFaction?: string;
}

/** 路线选择结果 */
export interface RouteSelection {
    /** 当前层数 */
    floor: number;
    /** 是否锁定（1-2 层锁定为普通战斗） */
    locked: boolean;
    /** 可选路线列表（锁定时仅 1 个普通选项，解锁后 3 个 + 可能的赏金） */
    options: RouteOption[];
    /** 是否包含赏金挑战选项 */
    hasBounty: boolean;
}

/** 玩家选择路线后的处理结果 */
export interface RouteChoiceResult {
    /** 选中的路线选项 */
    chosen: RouteOption;
    /** 对应的游戏节点类型（用于 RunManager.setCurrentNode） */
    nodeType: GameNodeType;
    /** 是否为精英战斗 */
    isElite: boolean;
    /** 是否为赏金挑战 */
    isBounty: boolean;
}

/**
 * RouteSelector —— 路线选择系统。
 *
 * 职责：
 * - 根据层数和野怪池生成路线选项（精英/普通A/普通B + 可能的赏金）
 * - 1-2 层锁定为普通战斗，3 层起解锁三选一
 * - 每个选项展示怪物名称，给玩家决策依据
 * - 处理玩家选择，返回对应的节点类型
 *
 * 不持有可变状态，不依赖引擎 API。
 */
export class RouteSelector {

    /**
     * 为指定层生成路线选项。
     *
     * @param floor 当前层数
     * @param rng 种子随机
     * @param monsterPool 当前可用的野怪模板池
     * @returns 路线选择信息（含所有可选项）
     */
    static generateRouteOptions(
        floor: number,
        rng: SeededRandom,
        monsterPool: MonsterTemplate[],
    ): RouteSelection {
        const locked = FloorManager.isRouteChoiceLocked(floor);

        if (locked) {
            const normalMonster = RouteSelector.pickMonster(floor, monsterPool, rng, []);
            return {
                floor,
                locked: true,
                options: normalMonster
                    ? [RouteSelector.toOption(RouteType.NORMAL, normalMonster)]
                    : [],
                hasBounty: false,
            };
        }

        const usedIds: string[] = [];
        const options: RouteOption[] = [];

        const eliteMonster = RouteSelector.pickEliteMonster(floor, monsterPool, rng, usedIds);
        if (eliteMonster) {
            options.push(RouteSelector.toOption(RouteType.ELITE, eliteMonster));
            usedIds.push(eliteMonster.id);
        }

        const normalA = RouteSelector.pickMonster(floor, monsterPool, rng, usedIds);
        if (normalA) {
            options.push(RouteSelector.toOption(RouteType.NORMAL, normalA));
            usedIds.push(normalA.id);
        }

        const normalB = RouteSelector.pickMonster(floor, monsterPool, rng, usedIds);
        if (normalB) {
            options.push(RouteSelector.toOption(RouteType.NORMAL, normalB));
            usedIds.push(normalB.id);
        }

        let hasBounty = false;
        if (FloorManager.rollBountyChallenge(rng)) {
            const bountyMonster = RouteSelector.pickEliteMonster(floor, monsterPool, rng, usedIds);
            if (bountyMonster) {
                options.push(RouteSelector.toOption(RouteType.BOUNTY, bountyMonster));
                hasBounty = true;
            }
        }

        return { floor, locked: false, options, hasBounty };
    }

    /**
     * 处理玩家的路线选择。
     *
     * @param selection 路线选择信息
     * @param chosenIndex 玩家选择的选项索引
     * @returns 选择结果，包含节点类型等信息
     */
    static resolveChoice(selection: RouteSelection, chosenIndex: number): RouteChoiceResult | null {
        const chosen = selection.options[chosenIndex];
        if (!chosen) return null;

        const nodeType = RouteSelector.routeTypeToNodeType(chosen.routeType);

        return {
            chosen,
            nodeType,
            isElite: chosen.routeType === RouteType.ELITE,
            isBounty: chosen.routeType === RouteType.BOUNTY,
        };
    }

    /**
     * 将 RouteType 映射到 GameNodeType。
     */
    static routeTypeToNodeType(routeType: RouteType): GameNodeType {
        switch (routeType) {
            case RouteType.ELITE: return GameNodeType.ELITE_BATTLE;
            case RouteType.BOUNTY: return GameNodeType.BOUNTY_BATTLE;
            case RouteType.NORMAL:
            default:
                return GameNodeType.MONSTER_BATTLE;
        }
    }

    /**
     * 从野怪池中挑选一个适合当前层的普通/流派野怪。
     * 排除已使用的怪物 ID，确保选项不重复。
     */
    private static pickMonster(
        floor: number,
        pool: MonsterTemplate[],
        rng: SeededRandom,
        excludeIds: string[],
    ): MonsterTemplate | null {
        const excludeSet = new Set(excludeIds);
        const candidates = pool.filter(m =>
            floor >= m.floorMin &&
            floor <= m.floorMax &&
            !excludeSet.has(m.id) &&
            m.type !== 'ELITE' as any,
        );
        if (candidates.length === 0) return null;
        return rng.pick(candidates);
    }

    /**
     * 从野怪池中挑选一个精英/高强度怪物。
     * 优先选精英类型，若无则从流派/普通中选一个（逻辑上作为精英使用，实际强度由 FloorManager 决定）。
     */
    private static pickEliteMonster(
        floor: number,
        pool: MonsterTemplate[],
        rng: SeededRandom,
        excludeIds: string[],
    ): MonsterTemplate | null {
        const excludeSet = new Set(excludeIds);
        const eliteCandidates = pool.filter(m =>
            floor >= m.floorMin &&
            floor <= m.floorMax &&
            !excludeSet.has(m.id) &&
            m.type === 'ELITE' as any,
        );
        if (eliteCandidates.length > 0) return rng.pick(eliteCandidates);

        const fallback = pool.filter(m =>
            floor >= m.floorMin &&
            floor <= m.floorMax &&
            !excludeSet.has(m.id),
        );
        if (fallback.length === 0) return null;
        return rng.pick(fallback);
    }

    private static toOption(routeType: RouteType, monster: MonsterTemplate): RouteOption {
        return {
            routeType,
            monsterId: monster.id,
            monsterName: monster.name,
            monsterFaction: monster.faction,
        };
    }
}
