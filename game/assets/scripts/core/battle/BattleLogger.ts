import {
    BattleLogEntry, BattleLogType,
} from '../../types/BattleTypes';
import { StatusType } from '../../types/Enums';
import { EffectResult, EffectResultType } from '../card/CardEffectResolver';
import { PoisonDamageResult, StatusDecayResult } from './StatusManager';
import { BattleEndChecker, BattleEndResult } from './BattleEndChecker';

// ─── 状态快照（回放用） ──────────────────────────────────

/** 单个战斗参与者的关键数值快照 */
export interface FighterSnapshot {
    hp: number;
    maxHp: number;
    mp: number;
    armor: number;
    frostStacks: number;
    burnStacks: number;
    poisonStacks: number;
    actionGauge: number;
    deckIndex: number;
}

/** 某个 tick 结束时双方状态的完整快照 */
export interface TickSnapshot {
    tick: number;
    cycle: number;
    player: FighterSnapshot;
    opponent: FighterSnapshot;
    /** 本 tick 产生的日志条目索引范围 [startIdx, endIdx) */
    logRange: [number, number];
}

// ─── 查询过滤 ────────────────────────────────────────────

/** 日志查询条件 */
export interface LogQuery {
    /** 按行为主体过滤 */
    actor?: 'player' | 'opponent' | 'system';
    /** 按日志类型过滤（可多选） */
    types?: BattleLogType[];
    /** tick 范围 [min, max] */
    tickRange?: [number, number];
    /** cycle 范围 [min, max] */
    cycleRange?: [number, number];
}

// ─── 主类 ────────────────────────────────────────────────

/**
 * 战斗日志系统。
 *
 * 集中管理战斗过程中的所有日志记录、快照存储和查询功能。
 * BattleEngine 通过此类记录每个 tick 的行动，UI 层和回放系统通过此类读取数据。
 *
 * 职责：
 * 1. **记录日志** — 提供类型安全的日志写入方法（出牌/跳过/伤害/状态等）
 * 2. **Tick 快照** — 可选地记录每 tick 的双方状态快照，用于回放和调试
 * 3. **日志查询** — 按类型/主体/时间范围过滤日志条目
 * 4. **格式化输出** — 将日志导出为人类可读的文本格式
 *
 * @see battle-base.md §十 战斗日志
 */
export class BattleLogger {
    private readonly entries: BattleLogEntry[];
    private readonly snapshots: TickSnapshot[] = [];
    private readonly snapshotEnabled: boolean;
    private currentTick = 0;
    private currentCycle = 0;

    /**
     * @param entries 日志写入目标数组（通常是 BattleState.log）
     * @param enableSnapshots 是否启用 tick 快照（回放模式开启，性能模式关闭）
     */
    constructor(entries: BattleLogEntry[], enableSnapshots: boolean = false) {
        this.entries = entries;
        this.snapshotEnabled = enableSnapshots;
    }

    // ─── 时间推进 ────────────────────────────────────────

    /** 更新当前 tick/cycle，由 BattleEngine 每 tick 调用 */
    setTime(tick: number, cycle: number): void {
        this.currentTick = tick;
        this.currentCycle = cycle;
    }

    // ─── 基础日志写入 ────────────────────────────────────

    /** 写入一条日志 */
    add(
        actor: 'player' | 'opponent' | 'system',
        type: BattleLogType,
        message: string,
        details?: Record<string, unknown>,
    ): void {
        this.entries.push({
            tick: this.currentTick,
            cycle: this.currentCycle,
            actor,
            type,
            message,
            details,
        });
    }

    // ─── 结构化日志方法 ──────────────────────────────────

    /** 记录出牌 */
    logPlayCard(side: 'player' | 'opponent', fighterName: string, cardName: string, cardId: string, manaCost: number): void {
        this.add(side, BattleLogType.PLAY_CARD,
            `${fighterName} 打出「${cardName}」(${manaCost}MP)`,
            { cardId, manaCost });
    }

    /** 记录 MP 不足跳过 */
    logSkipCard(side: 'player' | 'opponent', fighterName: string, cardName: string, cardId: string, required: number, current: number): void {
        this.add(side, BattleLogType.SKIP_CARD,
            `${fighterName} MP不足(${current}/${required})，跳过「${cardName}」`,
            { cardId, required, current });
    }

    /** 记录冻结 */
    logFreeze(side: 'player' | 'opponent', targetName: string, frostStacks: number): void {
        this.add(side, BattleLogType.FREEZE,
            `${targetName} 被冻结`,
            { frostStacks });
    }

    /** 记录 POWER 效果触发 */
    logPowerTrigger(side: 'player' | 'opponent', fighterName: string, cardName: string, cardId: string, trigger: string, stacks: number): void {
        this.add(side, BattleLogType.POWER_TRIGGER,
            `${fighterName}「${cardName}」效果触发`,
            { cardId, trigger, stacks });
    }

    /**
     * 记录卡牌效果执行结果。
     * 将 CardEffectResolver 返回的 EffectResult[] 逐条转化为日志。
     */
    logEffectResults(side: 'player' | 'opponent', results: EffectResult[], actorName: string, enemyName: string): void {
        for (const r of results) {
            switch (r.type) {
                case EffectResultType.DAMAGE:
                    if (r.value != null && r.value > 0) {
                        this.add(side, BattleLogType.DAMAGE,
                            `${enemyName} 受到${r.value}点伤害${r.detail === 'ignore_armor' ? '(无视护甲)' : ''}`,
                            { damage: r.value, ignoreArmor: r.detail === 'ignore_armor' });
                    }
                    break;
                case EffectResultType.ARMOR_GAIN:
                    if (r.value != null && r.value > 0) {
                        this.add(side, BattleLogType.ARMOR_GAIN,
                            `${actorName} 获得${r.value}点护甲`, { armor: r.value });
                    }
                    break;
                case EffectResultType.HEAL_HP:
                    if (r.value != null && r.value > 0) {
                        this.add(side, BattleLogType.HEAL,
                            `${actorName} 回复${r.value}HP`, { hp: r.value });
                    }
                    break;
                case EffectResultType.HEAL_MP:
                    if (r.value != null && r.value > 0) {
                        this.add(side, BattleLogType.HEAL,
                            `${actorName} 回复${r.value}MP`, { mp: r.value });
                    }
                    break;
                case EffectResultType.STATUS_APPLY:
                    this.add(side, BattleLogType.STATUS_APPLY,
                        `${enemyName} 被施加${r.value}层${r.detail}`,
                        { status: r.detail, stacks: r.value });
                    break;
                case EffectResultType.DRAIN:
                    this.add(side, BattleLogType.DRAIN,
                        `${actorName} 汲取${r.value}点${r.detail}`,
                        { attribute: r.detail, amount: r.value });
                    break;
                case EffectResultType.CURSE_INSERT:
                    this.add(side, BattleLogType.CURSE_INSERT,
                        `向${enemyName}卡组插入${r.value}张诅咒卡`,
                        { count: r.value, curseId: r.detail });
                    break;
                default:
                    break;
            }
        }
    }

    /** 记录毒药伤害 */
    logPoisonDamage(side: 'player' | 'opponent', fighterName: string, poison: PoisonDamageResult): void {
        if (poison.actualDamage <= 0) return;
        this.add('system', BattleLogType.DAMAGE,
            `${fighterName} 受到${poison.actualDamage}点毒药伤害(${poison.stacks}层)`,
            { damage: poison.actualDamage, source: 'poison' });
    }

    /** 记录状态衰减 */
    logDecays(side: 'player' | 'opponent', fighterName: string, decays: StatusDecayResult[]): void {
        for (const decay of decays) {
            if (decay.decayed <= 0) continue;

            this.add('system', BattleLogType.STATUS_DECAY,
                `${fighterName} ${STATUS_LABELS[decay.statusType] ?? decay.statusType}-${decay.decayed}(剩余${decay.remaining})`,
                { status: decay.statusType, decay: decay.decayed, remaining: decay.remaining });

            if (decay.unfreezeTransition) {
                this.add('system', BattleLogType.UNFREEZE,
                    `${fighterName} 解除冻结`, {});
            }
        }
    }

    /** 记录加时伤害 */
    logOvertime(damage: number, playerActual: number, opponentActual: number): void {
        this.add('system', BattleLogType.OVERTIME_DAMAGE,
            `加时伤害：双方各受${damage}点伤害`,
            { damage, playerActual, opponentActual });
    }

    /** 记录周期结算完成 */
    logCycleEnd(cycle: number): void {
        this.add('system', BattleLogType.CYCLE_END,
            `第${cycle}周期结算完成`,
            { cycle });
    }

    /** 记录战斗结束 */
    logBattleEnd(
        result: BattleEndResult,
        playerName: string,
        opponentName: string,
    ): void {
        const msg = BattleEndChecker.getReasonMessage(result, playerName, opponentName);
        this.add('system', BattleLogType.BATTLE_END, msg,
            { winner: result.winner, reason: result.reason });
    }

    // ─── Tick 快照 ───────────────────────────────────────

    /**
     * 记录当前 tick 结束时的状态快照。
     * 仅在 enableSnapshots = true 时生效。
     */
    captureSnapshot(player: SnapshotSource, opponent: SnapshotSource): void {
        if (!this.snapshotEnabled) return;

        this.snapshots.push({
            tick: this.currentTick,
            cycle: this.currentCycle,
            player: takeSnapshot(player),
            opponent: takeSnapshot(opponent),
            logRange: [
                this.snapshots.length > 0
                    ? this.snapshots[this.snapshots.length - 1].logRange[1]
                    : 0,
                this.entries.length,
            ],
        });
    }

    /** 获取所有快照（回放用） */
    getSnapshots(): readonly TickSnapshot[] {
        return this.snapshots;
    }

    /** 获取指定 tick 的快照 */
    getSnapshotAt(tick: number): TickSnapshot | undefined {
        return this.snapshots.find(s => s.tick === tick);
    }

    // ─── 日志查询 ────────────────────────────────────────

    /** 获取所有日志条目 */
    getEntries(): readonly BattleLogEntry[] {
        return this.entries;
    }

    /** 按条件查询日志 */
    query(q: LogQuery): BattleLogEntry[] {
        return this.entries.filter(entry => {
            if (q.actor && entry.actor !== q.actor) return false;
            if (q.types && !q.types.includes(entry.type)) return false;
            if (q.tickRange) {
                if (entry.tick < q.tickRange[0] || entry.tick > q.tickRange[1]) return false;
            }
            if (q.cycleRange) {
                if (entry.cycle < q.cycleRange[0] || entry.cycle > q.cycleRange[1]) return false;
            }
            return true;
        });
    }

    /** 获取指定 tick 的所有日志 */
    getEntriesForTick(tick: number): BattleLogEntry[] {
        return this.entries.filter(e => e.tick === tick);
    }

    /** 获取指定周期的所有日志 */
    getEntriesForCycle(cycle: number): BattleLogEntry[] {
        return this.entries.filter(e => e.cycle === cycle);
    }

    /** 统计各类型日志的数量 */
    countByType(): Map<BattleLogType, number> {
        const counts = new Map<BattleLogType, number>();
        for (const entry of this.entries) {
            counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
        }
        return counts;
    }

    // ─── 格式化输出 ──────────────────────────────────────

    /**
     * 将全部日志导出为人类可读文本。
     * 格式：`[Tick {n}] {message}`，周期结算标记为 `[Cycle {n}]`。
     */
    formatAll(): string {
        return this.entries.map(e => BattleLogger.formatEntry(e)).join('\n');
    }

    /** 格式化指定范围的日志 */
    formatRange(startIdx: number, endIdx: number): string {
        return this.entries
            .slice(startIdx, endIdx)
            .map(e => BattleLogger.formatEntry(e))
            .join('\n');
    }

    /** 格式化单条日志 */
    static formatEntry(entry: BattleLogEntry): string {
        const prefix = entry.type === BattleLogType.CYCLE_END
            || entry.type === BattleLogType.OVERTIME_DAMAGE
            ? `[Cycle ${entry.cycle}]`
            : `[Tick ${entry.tick}]`;
        return `${prefix} ${entry.message}`;
    }

    /** 获取战斗摘要（用于结算界面） */
    getSummary(): BattleSummary {
        let playerDamageDealt = 0;
        let opponentDamageDealt = 0;
        let playerCardsPlayed = 0;
        let opponentCardsPlayed = 0;
        let playerCardsSkipped = 0;
        let opponentCardsSkipped = 0;

        for (const e of this.entries) {
            if (e.type === BattleLogType.DAMAGE && e.details) {
                const dmg = (e.details['damage'] as number) ?? 0;
                if (e.actor === 'player') {
                    playerDamageDealt += dmg;
                } else if (e.actor === 'opponent') {
                    opponentDamageDealt += dmg;
                } else if (e.details['source'] === 'poison') {
                    // 毒药伤害归系统，根据描述判断受害者
                } else {
                    // 系统伤害（加时）双方各算
                }
            }
            if (e.type === BattleLogType.PLAY_CARD) {
                if (e.actor === 'player') playerCardsPlayed++;
                else if (e.actor === 'opponent') opponentCardsPlayed++;
            }
            if (e.type === BattleLogType.SKIP_CARD) {
                if (e.actor === 'player') playerCardsSkipped++;
                else if (e.actor === 'opponent') opponentCardsSkipped++;
            }
        }

        return {
            totalTicks: this.currentTick,
            totalCycles: this.currentCycle,
            totalLogEntries: this.entries.length,
            playerDamageDealt,
            opponentDamageDealt,
            playerCardsPlayed,
            opponentCardsPlayed,
            playerCardsSkipped,
            opponentCardsSkipped,
        };
    }
}

// ─── 摘要类型 ────────────────────────────────────────────

/** 战斗统计摘要 */
export interface BattleSummary {
    totalTicks: number;
    totalCycles: number;
    totalLogEntries: number;
    playerDamageDealt: number;
    opponentDamageDealt: number;
    playerCardsPlayed: number;
    opponentCardsPlayed: number;
    playerCardsSkipped: number;
    opponentCardsSkipped: number;
}

// ─── 快照工具 ────────────────────────────────────────────

/** 快照数据源接口（避免直接依赖 RuntimeCombatant） */
export interface SnapshotSource {
    currentHp: number;
    maxHp: number;
    currentMp: number;
    armor: number;
    frostStacks: number;
    burnStacks: number;
    poisonStacks: number;
    actionGauge: number;
    deckIndex: number;
}

function takeSnapshot(src: SnapshotSource): FighterSnapshot {
    return {
        hp: src.currentHp,
        maxHp: src.maxHp,
        mp: src.currentMp,
        armor: src.armor,
        frostStacks: src.frostStacks,
        burnStacks: src.burnStacks,
        poisonStacks: src.poisonStacks,
        actionGauge: src.actionGauge,
        deckIndex: src.deckIndex,
    };
}

const STATUS_LABELS: Record<string, string> = {
    [StatusType.FROST]: '霜蚀',
    [StatusType.BURN]: '灼烧',
    [StatusType.POISON]: '毒药',
};
