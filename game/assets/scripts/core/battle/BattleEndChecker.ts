import { BattleConfig, DEFAULT_BATTLE_CONFIG } from '../../types/BattleTypes';
import { RuntimeCombatant } from '../../types/CharacterTypes';
import { isAlive } from '../character/EffectiveStats';

// ─── 结果类型 ──────────────────────────────────────────────

/** 战斗结束原因 */
export enum BattleEndReason {
    /** 一方 HP ≤ 0 死亡 */
    HP_DEATH = 'HP_DEATH',
    /** 双方同时 HP ≤ 0（攻方判胜） */
    DOUBLE_DEATH = 'DOUBLE_DEATH',
    /** 周期达到强制结束阈值（平局） */
    FORCE_DRAW = 'FORCE_DRAW',
    /** tick 超出安全上限（兜底平局） */
    TICK_LIMIT = 'TICK_LIMIT',
}

/** 战斗结束判定结果 */
export interface BattleEndResult {
    /** 战斗是否结束 */
    ended: boolean;
    /** 获胜方（null = 未结束） */
    winner: 'player' | 'opponent' | 'draw' | null;
    /** 结束原因（null = 未结束） */
    reason: BattleEndReason | null;
}

/** 未结束的判定结果常量，避免重复创建对象 */
const NOT_ENDED: BattleEndResult = { ended: false, winner: null, reason: null };

// ─── 战斗结束判定器 ──────────────────────────────────────────

/**
 * 战斗结束判定器。
 *
 * 集中管理所有战斗结束条件的判定逻辑：
 *   - HP 死亡判定（含双方同时死亡的攻方优先规则）
 *   - 周期超时判定（cycle ≥ forceEndCycle → 强制平局）
 *   - tick 安全上限（兜底机制，防止无限循环）
 *
 * 纯逻辑类，不修改任何状态，只读取并返回判定结果。
 *
 * @see battle-base.md §八 战斗结束条件
 */
export class BattleEndChecker {
    private readonly config: BattleConfig;

    constructor(config: BattleConfig = DEFAULT_BATTLE_CONFIG) {
        this.config = config;
    }

    /**
     * 检查 HP 死亡条件。
     *
     * 规则：
     * - 任一方 HP ≤ 0 → 该方死亡，另一方胜利
     * - 双方同时 HP ≤ 0 → 攻方（玩家）判定胜利
     *
     * @see battle-base.md §8.1
     */
    checkDeath(player: RuntimeCombatant, opponent: RuntimeCombatant): BattleEndResult {
        const pAlive = isAlive(player);
        const oAlive = isAlive(opponent);

        if (pAlive && oAlive) {
            return NOT_ENDED;
        }

        if (!pAlive && !oAlive) {
            return {
                ended: true,
                winner: 'player',
                reason: BattleEndReason.DOUBLE_DEATH,
            };
        }

        if (!oAlive) {
            return {
                ended: true,
                winner: 'player',
                reason: BattleEndReason.HP_DEATH,
            };
        }

        return {
            ended: true,
            winner: 'opponent',
            reason: BattleEndReason.HP_DEATH,
        };
    }

    /**
     * 检查周期超时条件。
     *
     * cycle ≥ forceEndCycle（默认 200）→ 强制平局，双方不获得奖励。
     *
     * 注意：加时伤害由 CycleResolver 处理，此处只做最终的强制结束判定。
     *
     * @see battle-base.md §8.2
     */
    checkForceEnd(cycleCount: number): BattleEndResult {
        if (cycleCount >= this.config.forceEndCycle) {
            return {
                ended: true,
                winner: 'draw',
                reason: BattleEndReason.FORCE_DRAW,
            };
        }
        return NOT_ENDED;
    }

    /**
     * 检查 tick 安全上限（兜底机制）。
     *
     * 防止因意外逻辑导致战斗永远不结束。
     * 正常战斗不会触及此限制（forceEndCycle = 200 × ticksPerCycle = 100 → 20000 ticks）。
     */
    checkTickLimit(tickCount: number, maxTicks: number): BattleEndResult {
        if (tickCount >= maxTicks) {
            return {
                ended: true,
                winner: 'draw',
                reason: BattleEndReason.TICK_LIMIT,
            };
        }
        return NOT_ENDED;
    }

    /**
     * 综合判定：依次检查 HP 死亡 → 周期超时。
     * 适用于周期结算后的统一检查场景。
     */
    check(
        player: RuntimeCombatant,
        opponent: RuntimeCombatant,
        cycleCount: number,
    ): BattleEndResult {
        const deathResult = this.checkDeath(player, opponent);
        if (deathResult.ended) return deathResult;

        return this.checkForceEnd(cycleCount);
    }

    /**
     * 判断当前是否处于加时阶段。
     * @see battle-base.md §8.2
     */
    isOvertime(cycleCount: number): boolean {
        return cycleCount >= this.config.overtimeStartCycle
            && cycleCount < this.config.forceEndCycle;
    }

    /**
     * 获取战斗结束原因的中文描述（用于日志/UI）。
     */
    static getReasonMessage(
        result: BattleEndResult,
        playerName: string,
        opponentName: string,
    ): string {
        if (!result.ended) return '';

        switch (result.reason) {
            case BattleEndReason.HP_DEATH:
                return result.winner === 'player'
                    ? `${opponentName} 被击败，${playerName} 获胜`
                    : `${playerName} 被击败，${opponentName} 获胜`;
            case BattleEndReason.DOUBLE_DEATH:
                return `双方同时倒下，${playerName}（攻方）判定获胜`;
            case BattleEndReason.FORCE_DRAW:
                return '战斗超时，强制平局';
            case BattleEndReason.TICK_LIMIT:
                return '战斗超出时间上限，平局';
            default:
                return '战斗结束';
        }
    }
}
