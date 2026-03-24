import { StatusType, BuffType } from '../../types/Enums';
import { RuntimeCombatant } from '../../types/CharacterTypes';
import { BattleConfig, DEFAULT_BATTLE_CONFIG } from '../../types/BattleTypes';
import { DamageCalculator } from './DamageCalculator';
import {
    getEffectiveSpeed,
    isFrozen as checkFrozenState,
    wouldFreeze,
} from '../character/EffectiveStats';

// ─── 事件结果类型 ────────────────────────────────────────

/** 状态施加结果 */
export interface StatusApplyResult {
    statusType: StatusType;
    stacksApplied: number;
    totalStacks: number;
    /** 施加后是否触发了冻结（消耗全部霜蚀） */
    frozenTransition?: 'frozen' | 'none';
    /** 冻结触发时消耗的霜蚀层数 */
    frostConsumed?: number;
}

/** 冻结期间霜蚀转伤害的结果 */
export interface FrostShatterResult {
    frostStacks: number;
    rawDamage: number;
    armorAbsorbed: number;
    actualHpDamage: number;
}

/** 解冻结果 */
export interface UnfreezeResult {
    unfrozen: boolean;
}

/** 状态衰减结果 */
export interface StatusDecayResult {
    statusType: StatusType;
    decayed: number;
    remaining: number;
    /** 衰减后是否导致解冻 */
    unfreezeTransition?: boolean;
}

/** 毒药伤害结果 */
export interface PoisonDamageResult {
    stacks: number;
    actualDamage: number;
}

/** 灼烧引爆结果 */
export interface DetonateResult {
    burnStacksConsumed: number;
    rawDamage: number;
    armorAbsorbed: number;
    actualHpDamage: number;
}

/** 周期结算完整结果（单个角色） */
export interface CycleStatusResult {
    poison?: PoisonDamageResult;
    decays: StatusDecayResult[];
    unfrozen: boolean;
}

// ─── 状态管理器 ────────────────────────────────────────────

/**
 * 状态效果管理器。
 *
 * 集中管理三种关键词状态（霜蚀/灼烧/毒药）的施加、查询、衰减和周期结算。
 * 纯逻辑类，返回详细结果供 BattleEngine 写日志和 UI 展示。
 *
 * @see battle-base.md §七 状态效果详解
 */
export class StatusManager {
    private readonly config: BattleConfig;

    constructor(config: BattleConfig = DEFAULT_BATTLE_CONFIG) {
        this.config = config;
    }

    // ─── 施加状态 ────────────────────────────────────────

    /**
     * 施加状态层数到目标身上。
     *
     * 霜蚀特殊规则：
     * - 施加后若 effective_speed ≤ 0 → 触发冻结，消耗全部霜蚀，设置 frozenUntilCycle
     * - 冻结期间不应通过此方法施加霜蚀（调用方应先用 applyFrostDuringFreeze 转伤害）
     *
     * @param currentCycle 当前周期数（冻结需要知道冻到哪个周期）
     */
    applyStatus(
        target: RuntimeCombatant,
        type: StatusType,
        stacks: number,
        currentCycle: number = 0,
    ): StatusApplyResult {
        if (stacks <= 0) {
            return {
                statusType: type,
                stacksApplied: 0,
                totalStacks: this.getStacks(target, type),
            };
        }

        switch (type) {
            case StatusType.FROST:
                target.frostStacks += stacks;
                break;
            case StatusType.BURN:
                target.burnStacks += stacks;
                break;
            case StatusType.POISON:
                target.poisonStacks += stacks;
                break;
        }

        let frozenTransition: 'frozen' | 'none' = 'none';
        let frostConsumed = 0;

        if (type === StatusType.FROST && !checkFrozenState(target) && wouldFreeze(target, this.config)) {
            frostConsumed = target.frostStacks;
            target.frostStacks = 0;
            target.frozenUntilCycle = currentCycle + 1;
            frozenTransition = 'frozen';
        }

        return {
            statusType: type,
            stacksApplied: stacks,
            totalStacks: this.getStacks(target, type),
            frozenTransition,
            frostConsumed,
        };
    }

    /**
     * 冻结期间施加霜蚀 → 转化为伤害（走护甲结算）。
     * @param multiplier 伤害倍率，默认 1（永冬效果下为 2）
     */
    applyFrostDuringFreeze(
        target: RuntimeCombatant,
        stacks: number,
        multiplier: number = 1,
    ): FrostShatterResult {
        if (stacks <= 0 || !checkFrozenState(target)) {
            return { frostStacks: 0, rawDamage: 0, armorAbsorbed: 0, actualHpDamage: 0 };
        }

        const rawDamage = Math.floor(stacks * multiplier);
        const dmgResult = DamageCalculator.applyRawDamage(rawDamage, target, false);

        return {
            frostStacks: stacks,
            rawDamage,
            armorAbsorbed: dmgResult.armorAbsorbed,
            actualHpDamage: dmgResult.actualHpDamage,
        };
    }

    // ─── 移除状态 ────────────────────────────────────────

    /** 移除指定层数（不低于 0），返回衰减结果 */
    removeStacks(target: RuntimeCombatant, type: StatusType, amount: number): StatusDecayResult {
        const current = this.getStacks(target, type);
        const actual = Math.min(current, Math.max(0, amount));
        const wasFrozen = this.isFrozen(target);

        this.setStacks(target, type, current - actual);

        let unfreezeTransition = false;
        if (type === StatusType.FROST && wasFrozen && !this.isFrozen(target)) {
            unfreezeTransition = true;
        }

        return {
            statusType: type,
            decayed: actual,
            remaining: this.getStacks(target, type),
            unfreezeTransition,
        };
    }

    /** 清零指定状态类型 */
    clearStatus(target: RuntimeCombatant, type: StatusType): number {
        const previous = this.getStacks(target, type);
        this.setStacks(target, type, 0);
        return previous;
    }

    /** 清零所有状态（战斗初始化时使用） */
    clearAllStatuses(target: RuntimeCombatant): void {
        target.frostStacks = 0;
        target.burnStacks = 0;
        target.poisonStacks = 0;
        target.frozenUntilCycle = -1;
    }

    // ─── 周期结算 ────────────────────────────────────────

    /**
     * 处理单个角色的周期状态结算。
     *
     * 按策划文档顺序：毒药伤害 → 霜蚀衰减 → 毒药衰减。
     * 灼烧不自然衰减。
     *
     * 注意：毒药伤害和衰减拆开是因为 BattleEngine 需要在两步之间检查死亡。
     * 此方法整合为一步，适用于不需要中间检查的场景；
     * BattleEngine 可使用更细粒度的 resolvePoisonDamage + resolveDecays。
     *
     * @see battle-base.md §3.2
     */
    processCycleEnd(target: RuntimeCombatant): CycleStatusResult {
        const result: CycleStatusResult = { decays: [], unfrozen: false };

        if (target.poisonStacks > 0) {
            result.poison = this.resolvePoisonDamage(target);
        }

        const decays = this.resolveDecays(target);
        result.decays = decays;
        result.unfrozen = decays.some(d => d.unfreezeTransition === true);

        return result;
    }

    /**
     * 毒药周期伤害：造成等于层数的伤害，无视护甲。
     *
     * @see battle-base.md §7.1 毒药
     */
    resolvePoisonDamage(target: RuntimeCombatant): PoisonDamageResult {
        if (target.poisonStacks <= 0) {
            return { stacks: 0, actualDamage: 0 };
        }

        const stacks = target.poisonStacks;
        const dmgResult = DamageCalculator.applyRawDamage(stacks, target, true);

        return {
            stacks,
            actualDamage: dmgResult.actualHpDamage,
        };
    }

    /**
     * 周期状态衰减：毒药 -1/周期（先伤害后衰减）。
     * 霜蚀不再自然衰减。灼烧不自然衰减。
     *
     * @see battle-base.md §3.2, §7.1
     */
    resolveDecays(target: RuntimeCombatant): StatusDecayResult[] {
        const results: StatusDecayResult[] = [];

        if (target.poisonStacks > 0) {
            const r = this.removeStacks(target, StatusType.POISON, this.config.poisonDecayPerCycle);
            results.push(r);
        }

        return results;
    }

    /**
     * 周期开始时检查并执行解冻。
     * 若 frozenUntilCycle <= currentCycle，解除冻结并重置行动槽。
     */
    resolveUnfreeze(target: RuntimeCombatant, currentCycle: number): UnfreezeResult {
        if (target.frozenUntilCycle >= 0 && currentCycle >= target.frozenUntilCycle) {
            target.frozenUntilCycle = -1;
            target.frostStacks = 0;
            target.actionGauge = 0;
            return { unfrozen: true };
        }
        return { unfrozen: false };
    }

    // ─── 灼烧引爆 ────────────────────────────────────────

    /**
     * 引爆灼烧：消耗全部灼烧层数，造成 层数 × 倍率 的伤害（走正常护甲结算）。
     *
     * @see battle-base.md §6.4
     */
    detonate(target: RuntimeCombatant, multiplier: number = 1.5): DetonateResult {
        const stacks = target.burnStacks;
        target.burnStacks = 0;

        if (stacks <= 0) {
            return { burnStacksConsumed: 0, rawDamage: 0, armorAbsorbed: 0, actualHpDamage: 0 };
        }

        const rawDamage = Math.floor(stacks * multiplier);
        const dmgResult = DamageCalculator.applyRawDamage(rawDamage, target, false);

        return {
            burnStacksConsumed: stacks,
            rawDamage,
            armorAbsorbed: dmgResult.armorAbsorbed,
            actualHpDamage: dmgResult.actualHpDamage,
        };
    }

    // ─── 查询接口 ────────────────────────────────────────

    /** 获取指定状态类型的当前层数 */
    getStacks(target: RuntimeCombatant, type: StatusType): number {
        switch (type) {
            case StatusType.FROST: return target.frostStacks;
            case StatusType.BURN: return target.burnStacks;
            case StatusType.POISON: return target.poisonStacks;
            default: return 0;
        }
    }

    /** 霜蚀造成的速度减少值 */
    getFrostSpeedReduction(target: RuntimeCombatant): number {
        return Math.floor(target.frostStacks / this.config.frostPerSpeedReduction);
    }

    /** 是否处于冻结状态（检查显式冻结标记） */
    isFrozen(target: RuntimeCombatant): boolean {
        return checkFrozenState(target);
    }

    /** 是否有任何状态效果 */
    hasAnyStatus(target: RuntimeCombatant): boolean {
        return target.frostStacks > 0 || target.burnStacks > 0 || target.poisonStacks > 0;
    }

    /** 获取状态摘要（用于 UI 展示） */
    getStatusSummary(target: RuntimeCombatant): StatusSummary {
        return {
            frost: target.frostStacks,
            burn: target.burnStacks,
            poison: target.poisonStacks,
            frostSpeedReduction: this.getFrostSpeedReduction(target),
            isFrozen: checkFrozenState(target),
            frozenUntilCycle: target.frozenUntilCycle,
        };
    }

    // ─── 内部工具 ────────────────────────────────────────

    private setStacks(target: RuntimeCombatant, type: StatusType, value: number): void {
        const clamped = Math.max(0, value);
        switch (type) {
            case StatusType.FROST:
                target.frostStacks = clamped;
                break;
            case StatusType.BURN:
                target.burnStacks = clamped;
                break;
            case StatusType.POISON:
                target.poisonStacks = clamped;
                break;
        }
    }
}

// ─── 辅助类型 ──────────────────────────────────────────────

/** 状态效果摘要（用于 UI 展示） */
export interface StatusSummary {
    frost: number;
    burn: number;
    poison: number;
    frostSpeedReduction: number;
    isFrozen: boolean;
    frozenUntilCycle: number;
}
