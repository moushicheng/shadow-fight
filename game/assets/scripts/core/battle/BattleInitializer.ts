import {
    BattleState, BattleFighter, BattleConfig, BattleLogEntry,
    BattleLogType,
} from '../../types/BattleTypes';
import { CardInstance } from '../../types/CardTypes';
import { RuntimeCombatant, ActiveBuff } from '../../types/CharacterTypes';
import { RelicDef, RelicCustomEffect } from '../../types/RelicTypes';
import { TempBuff, TempBuffEffect } from '../../types/RunTypes';
import { CardType, RelicTrigger, BuffType, EffectTarget } from '../../types/Enums';
import { CardEffect } from '../../types/CardTypes';
import { gainArmor, healHp } from '../character/EffectiveStats';

// ─── 外部依赖接口 ────────────────────────────────────────

/** 卡牌定义查询 */
export interface CardDefLookup {
    getCardDef(defId: string): { cardType: string; forcePlay?: boolean } | undefined;
}

/** 遗物定义查询 */
export interface RelicDefLookup {
    getRelicDef(relicId: string): RelicDef | undefined;
}

// ─── 初始化输入 ──────────────────────────────────────────

/**
 * 战斗初始化输入参数。
 * 由 RunManager 或测试代码构造后传入。
 */
export interface BattleSetup {
    player: BattleFighter;
    opponent: BattleFighter;
    /** 玩家的临时增益（来自事件/赌约，战斗后自动消耗） */
    playerTempBuffs?: TempBuff[];
    /** 对手的临时增益（野怪/残影可能也有特殊增益） */
    opponentTempBuffs?: TempBuff[];
}

// ─── 初始化结果 ──────────────────────────────────────────

/** 初始化完成后的完整战斗状态 */
export interface InitializedBattle {
    state: BattleState;
    /** 初始化阶段产生的日志（遗物触发、Buff 应用等） */
    initLog: BattleLogEntry[];
}

// ─── 主类 ────────────────────────────────────────────────

/**
 * 战斗初始化器。
 *
 * 按 battle-base.md §四 的流程准备战斗状态：
 * 1. 深拷贝双方数据
 * 2. 清零战斗内状态（护甲/状态效果/Buff/行动槽/卡组指针）
 * 3. 从卡组移除诅咒卡
 * 4. 应用临时 Buff（事件/赌约）
 * 5. 触发遗物 BATTLE_START 效果（先玩家后对手）
 * 6. 构建 BattleState
 *
 * 不依赖引擎 API，纯逻辑可测试。
 *
 * @see battle-base.md §四 战斗初始化
 */
export class BattleInitializer {
    private readonly cardLookup: CardDefLookup;
    private readonly relicLookup: RelicDefLookup;

    constructor(cardLookup: CardDefLookup, relicLookup: RelicDefLookup) {
        this.cardLookup = cardLookup;
        this.relicLookup = relicLookup;
    }

    /**
     * 执行完整的战斗初始化流程。
     *
     * @see battle-base.md §4.1 战斗开始流程
     */
    initialize(setup: BattleSetup): InitializedBattle {
        const log: BattleLogEntry[] = [];

        // 1. 深拷贝双方数据
        const player = cloneFighter(setup.player);
        const opponent = cloneFighter(setup.opponent);

        // 2. 清零战斗内状态
        this.resetCombatState(player.combatant);
        this.resetCombatState(opponent.combatant);

        // 3. 移除诅咒卡
        const playerCursesRemoved = this.removeCurseCards(player.deck);
        const opponentCursesRemoved = this.removeCurseCards(opponent.deck);
        if (playerCursesRemoved > 0) {
            log.push(makeLogEntry('system', BattleLogType.RELIC_TRIGGER,
                `${player.name} 卡组中${playerCursesRemoved}张诅咒卡已移除`));
        }
        if (opponentCursesRemoved > 0) {
            log.push(makeLogEntry('system', BattleLogType.RELIC_TRIGGER,
                `${opponent.name} 卡组中${opponentCursesRemoved}张诅咒卡已移除`));
        }

        // 4. 应用临时 Buff
        if (setup.playerTempBuffs) {
            for (const tb of setup.playerTempBuffs) {
                this.applyTempBuff(player, tb, 'player', log);
            }
        }
        if (setup.opponentTempBuffs) {
            for (const tb of setup.opponentTempBuffs) {
                this.applyTempBuff(opponent, tb, 'opponent', log);
            }
        }

        // 5. 触发 BATTLE_START 遗物（先玩家后对手）
        this.triggerBattleStartRelics(player, 'player', log);
        this.triggerBattleStartRelics(opponent, 'opponent', log);

        // 6. 构建 BattleState
        const state: BattleState = {
            player,
            opponent,
            tickCount: 0,
            cycleCount: 0,
            isFinished: false,
            winner: null,
            log: [...log],
        };

        return { state, initLog: log };
    }

    // ─── 状态清零 ────────────────────────────────────────

    /**
     * 重置战斗运行时状态。
     *
     * 清零项目：
     * - 护甲 = 0
     * - 霜蚀/灼烧/毒药 = 0
     * - 行动槽 = 0
     * - 卡组指针 = 0
     * - 已激活能力卡清空
     * - Buff 清空（汲取效果也随之清零）
     *
     * HP/MP 保持当前值（CombatantFactory 创建时已是满值）。
     */
    private resetCombatState(c: RuntimeCombatant): void {
        c.armor = 0;
        c.frostStacks = 0;
        c.burnStacks = 0;
        c.poisonStacks = 0;
        c.actionGauge = 0;
        c.deckIndex = 0;
        c.activePowers = [];
        c.buffs = [];
        // MP 重置为满（每场战斗满蓝开局）
        c.currentMp = c.maxMp;
    }

    // ─── 诅咒卡移除 ──────────────────────────────────────

    /**
     * 从卡组中移除所有诅咒卡。
     * 战斗开始时诅咒卡不应存在于卡组中——它们只在战斗中被对手塞入。
     * 返回移除的数量。
     */
    private removeCurseCards(deck: CardInstance[]): number {
        let removed = 0;
        for (let i = deck.length - 1; i >= 0; i--) {
            const def = this.cardLookup.getCardDef(deck[i].defId);
            if (def && def.cardType === CardType.CURSE) {
                deck.splice(i, 1);
                removed++;
            }
        }
        return removed;
    }

    // ─── 临时 Buff 应用 ──────────────────────────────────

    /**
     * 应用临时增益到战斗参与者。
     * 临时增益来源：事件奖励、赌约正面效果。
     * 生效后由 RunManager 从 RunState.tempBuffs 中清除。
     *
     * @see RunTypes.TempBuffEffect
     */
    private applyTempBuff(
        fighter: BattleFighter,
        tempBuff: TempBuff,
        side: 'player' | 'opponent',
        log: BattleLogEntry[],
    ): void {
        const c = fighter.combatant;

        for (const effect of tempBuff.effects) {
            switch (effect.type) {
                case 'atk_add':
                    c.attack += effect.value;
                    break;

                case 'spd_add':
                    c.baseSpeed += effect.value;
                    break;

                case 'damage_mult':
                    c.buffs.push({
                        type: BuffType.DAMAGE_MULTIPLY,
                        value: effect.value,
                        remaining: -1,
                        sourceCardId: `tempbuff_${tempBuff.id}`,
                    });
                    break;

                case 'damage_taken_mult':
                    c.buffs.push({
                        type: BuffType.VULNERABILITY,
                        value: effect.value,
                        remaining: -1,
                        sourceCardId: `tempbuff_${tempBuff.id}`,
                    });
                    break;

                case 'hp_change':
                    if (effect.value > 0) {
                        healHp(c, effect.value);
                    } else if (effect.value < 0) {
                        c.currentHp = Math.max(1, c.currentHp + effect.value);
                    }
                    break;

                case 'overtime_limit':
                    // overtime_limit 需要由 BattleEngine 读取并修改 BattleConfig，
                    // 此处记录到 Buff 中供 BattleEngine 查询
                    c.buffs.push({
                        type: BuffType.DAMAGE_REDUCTION, // 复用类型，特殊标记
                        value: effect.value,
                        remaining: -1,
                        sourceCardId: `overtime_limit_${tempBuff.id}`,
                    });
                    break;
            }
        }

        log.push(makeLogEntry(side, BattleLogType.RELIC_TRIGGER,
            `${fighter.name} 获得增益「${tempBuff.description}」`,
            { buffId: tempBuff.id }));
    }

    // ─── 遗物触发 ────────────────────────────────────────

    /**
     * 触发指定角色的所有 BATTLE_START 遗物效果。
     * 按遗物获取顺序（relics 数组顺序）依次触发。
     *
     * @see battle-base.md §4.2 遗物触发顺序
     */
    private triggerBattleStartRelics(
        fighter: BattleFighter,
        side: 'player' | 'opponent',
        log: BattleLogEntry[],
    ): void {
        for (const relicId of fighter.relics) {
            const relicDef = this.relicLookup.getRelicDef(relicId);
            if (!relicDef) continue;
            if (relicDef.trigger !== RelicTrigger.BATTLE_START) continue;

            this.applyRelicEffect(fighter, relicDef, side, log);
        }
    }

    /**
     * 执行单个遗物的效果。
     * 遗物效果可以是 CardEffect（复用卡牌效果结构）或 RelicCustomEffect。
     */
    private applyRelicEffect(
        fighter: BattleFighter,
        relicDef: RelicDef,
        side: 'player' | 'opponent',
        log: BattleLogEntry[],
    ): void {
        const c = fighter.combatant;
        const effect = relicDef.effect;

        if (isCardEffect(effect)) {
            this.applyCardEffectAsRelic(c, effect);
        } else {
            this.applyCustomRelicEffect(c, effect);
        }

        log.push(makeLogEntry(side, BattleLogType.RELIC_TRIGGER,
            `${fighter.name} 遗物「${relicDef.name}」触发：${relicDef.description}`,
            { relicId: relicDef.id }));
    }

    /**
     * 将 CardEffect 格式的遗物效果应用到角色。
     * 仅处理战斗开始时有意义的效果子集（护甲/回复/Buff）。
     * 伤害和状态效果在战斗开始时通常不适用。
     */
    private applyCardEffectAsRelic(c: RuntimeCombatant, effect: CardEffect): void {
        if (effect.armor) {
            const amount = effect.armor.gain ?? 0;
            gainArmor(c, amount);
        }

        if (effect.heal) {
            if (effect.heal.hp != null && effect.heal.hp > 0) {
                healHp(c, effect.heal.hp);
            }
            if (effect.heal.hpPercent != null && effect.heal.hpPercent > 0) {
                const amount = Math.floor(c.maxHp * effect.heal.hpPercent);
                healHp(c, amount);
            }
            if (effect.heal.mp != null && effect.heal.mp > 0) {
                c.currentMp = Math.min(c.maxMp, c.currentMp + effect.heal.mp);
            }
        }

        if (effect.buff) {
            c.buffs.push({
                type: effect.buff.type,
                value: effect.buff.value,
                remaining: effect.buff.duration,
                sourceCardId: 'relic',
            });
        }
    }

    /**
     * 执行自定义遗物效果。
     * 根据 type 字段分发到具体逻辑。
     */
    private applyCustomRelicEffect(c: RuntimeCombatant, effect: RelicCustomEffect): void {
        switch (effect.type) {
            case 'ARMOR_GAIN': {
                const amount = (effect.params['amount'] as number) ?? 0;
                gainArmor(c, amount);
                break;
            }

            case 'HP_BONUS': {
                const amount = (effect.params['amount'] as number) ?? 0;
                c.maxHp += amount;
                c.currentHp += amount;
                break;
            }

            case 'ATK_BONUS': {
                const amount = (effect.params['amount'] as number) ?? 0;
                c.attack += amount;
                break;
            }

            case 'SPD_BONUS': {
                const amount = (effect.params['amount'] as number) ?? 0;
                c.baseSpeed += amount;
                break;
            }

            case 'MP_BONUS': {
                const amount = (effect.params['amount'] as number) ?? 0;
                c.maxMp += amount;
                c.currentMp = Math.min(c.maxMp, c.currentMp + amount);
                break;
            }

            case 'FACTION_SYNERGY': {
                // 元素共鸣等复杂遗物效果预留——需要卡组信息配合，
                // 由后续 RelicManager 在初始化阶段处理
                break;
            }

            default:
                break;
        }
    }
}

// ─── 模块工具函数 ────────────────────────────────────────

function cloneFighter(f: BattleFighter): BattleFighter {
    return {
        name: f.name,
        combatant: {
            ...f.combatant,
            activePowers: f.combatant.activePowers.map(p => ({ ...p })),
            buffs: f.combatant.buffs.map(b => ({ ...b })),
        },
        deck: f.deck.map(c => ({ ...c })),
        relics: [...f.relics],
    };
}

function makeLogEntry(
    actor: 'player' | 'opponent' | 'system',
    type: BattleLogType,
    message: string,
    details?: Record<string, unknown>,
): BattleLogEntry {
    return { tick: 0, cycle: 0, actor, type, message, details };
}

/** 类型守卫：区分 CardEffect 和 RelicCustomEffect */
function isCardEffect(effect: CardEffect | RelicCustomEffect): effect is CardEffect {
    return 'target' in effect;
}
