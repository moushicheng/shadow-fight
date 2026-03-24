import { BattleConfig, DEFAULT_BATTLE_CONFIG } from '../../types/BattleTypes';
import { RuntimeCombatant } from '../../types/CharacterTypes';
import { isAlive, recoverMp, applyHpDamage } from '../character/EffectiveStats';
import { StatusManager, PoisonDamageResult, StatusDecayResult } from './StatusManager';

// ─── 结果类型 ──────────────────────────────────────────────

/** 加时伤害结果 */
export interface OvertimeResult {
    /** 本周期加时伤害值 */
    damage: number;
    /** 玩家实际受到的 HP 伤害 */
    playerActual: number;
    /** 对手实际受到的 HP 伤害 */
    opponentActual: number;
}

/**
 * 单次周期结算的完整结果。
 * 每个阶段的结果独立记录，BattleEngine 据此写日志。
 */
export interface CycleResolveResult {
    /** 本次结算的周期序号 */
    cycle: number;

    /** 阶段 1：毒药伤害 */
    playerPoison: PoisonDamageResult;
    opponentPoison: PoisonDamageResult;
    /** 毒药结算后是否有角色死亡（为 true 时后续阶段不执行） */
    deathAfterPoison: boolean;

    /** 阶段 2：状态衰减（霜蚀 -N/周期 仅蓄力阶段，毒药 -1/周期） */
    playerDecays: StatusDecayResult[];
    opponentDecays: StatusDecayResult[];

    /** 阶段 3：MP 回复 */
    playerMpRecovered: number;
    opponentMpRecovered: number;

    /** 阶段 4：加时伤害（cycle >= overtimeStartCycle 时触发） */
    overtime: OvertimeResult | null;
    /** 加时伤害后是否有角色死亡 */
    deathAfterOvertime: boolean;

    /** 阶段 5：是否触发强制结束（cycle >= forceEndCycle） */
    forceEnd: boolean;
}

// ─── 周期结算器 ────────────────────────────────────────────

/**
 * 周期结算器。
 *
 * 每 100 tick 触发一次，按固定顺序执行：
 *   0. 解冻（由 BattleEngine 在调用 resolve 前执行）
 *   1. 毒药伤害（双方各受 = 毒药层数的伤害，无视护甲）
 *   2. 状态衰减（霜蚀 -N/周期（仅蓄力阶段），毒药 -1/周期；灼烧不自然衰减）
 *   3. MP 回复（双方各 +1，不超上限）
 *   4. 加时伤害（若已进入加时阶段，双方受 1 + (cycle - 100) × 2 递增伤害）
 *   5. 超时判定（cycle ≥ 200 → 强制平局）
 *
 * 纯逻辑类，直接修改传入的 RuntimeCombatant，并返回详细结果供日志/UI 使用。
 * 若某阶段导致角色死亡，后续阶段不再执行（通过 deathAfterXxx 标记）。
 *
 * @see battle-base.md §三 周期与状态结算
 */
export class CycleResolver {
    private readonly config: BattleConfig;
    private readonly statusManager: StatusManager;

    constructor(
        statusManager: StatusManager,
        config: BattleConfig = DEFAULT_BATTLE_CONFIG,
    ) {
        this.statusManager = statusManager;
        this.config = config;
    }

    /**
     * 执行一次完整的周期结算。
     *
     * @param player   玩家运行时属性（会被直接修改）
     * @param opponent 对手运行时属性（会被直接修改）
     * @param cycle    当前周期序号（调用方已自增后传入）
     * @returns 各阶段的详细结算结果
     */
    resolve(
        player: RuntimeCombatant,
        opponent: RuntimeCombatant,
        cycle: number,
    ): CycleResolveResult {
        const result: CycleResolveResult = {
            cycle,
            playerPoison: { stacks: 0, actualDamage: 0 },
            opponentPoison: { stacks: 0, actualDamage: 0 },
            deathAfterPoison: false,
            playerDecays: [],
            opponentDecays: [],
            playerMpRecovered: 0,
            opponentMpRecovered: 0,
            overtime: null,
            deathAfterOvertime: false,
            forceEnd: false,
        };

        // ── 阶段 1：毒药伤害 ──
        result.playerPoison = this.statusManager.resolvePoisonDamage(player);
        result.opponentPoison = this.statusManager.resolvePoisonDamage(opponent);

        if (!isAlive(player) || !isAlive(opponent)) {
            result.deathAfterPoison = true;
            return result;
        }

        // ── 阶段 2：状态衰减 ──
        result.playerDecays = this.statusManager.resolveDecays(player);
        result.opponentDecays = this.statusManager.resolveDecays(opponent);

        // ── 阶段 3：MP 回复 ──
        result.playerMpRecovered = recoverMp(player, this.config.mpRecoveryPerCycle);
        result.opponentMpRecovered = recoverMp(opponent, this.config.mpRecoveryPerCycle);

        // ── 阶段 4：加时伤害 ──
        if (cycle >= this.config.overtimeStartCycle) {
            const damage = 1 + (cycle - this.config.overtimeStartCycle) * 2;
            const playerActual = applyHpDamage(player, damage);
            const opponentActual = applyHpDamage(opponent, damage);

            result.overtime = { damage, playerActual, opponentActual };

            if (!isAlive(player) || !isAlive(opponent)) {
                result.deathAfterOvertime = true;
                return result;
            }
        }

        // ── 阶段 5：超时判定 ──
        if (cycle >= this.config.forceEndCycle) {
            result.forceEnd = true;
        }

        return result;
    }

    /**
     * 判断给定周期是否处于加时阶段。
     */
    isOvertime(cycle: number): boolean {
        return cycle >= this.config.overtimeStartCycle;
    }

    /**
     * 计算指定周期的加时伤害值。
     * @see battle-base.md §8.2 — 伤害公式: 1 + (cycle - overtimeStartCycle) × 2
     */
    getOvertimeDamage(cycle: number): number {
        if (cycle < this.config.overtimeStartCycle) return 0;
        return 1 + (cycle - this.config.overtimeStartCycle) * 2;
    }
}
