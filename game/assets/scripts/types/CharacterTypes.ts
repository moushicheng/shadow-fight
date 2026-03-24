import { BuffType } from './Enums';

/**
 * 四维基础属性值。
 * 每局开始时由种子随机数分配 40 总点到四维，SPD 下限 3。
 * 可被事件/遗物永久修改（修改存入 RunState.baseProperty）。
 */
export interface PlayerBaseProperty {
    /** 力量 —— 攻击加成 = Max(STR - 10, 0)，自动叠加到攻击类卡牌 */
    STR: number;
    /** 体质 —— 映射 HP = CON × 15 + 30 */
    CON: number;
    /** 速度 —— 映射 speed，决定 ATB 行动频率（下限 3） */
    SPD: number;
    /** 法力 —— 映射 maxMp = round(MANA × 1.5) */
    MANA: number;
}

/**
 * 战斗运行时属性（单个战斗参与者）。
 * 每场战斗开始时从 PlayerBaseProperty 初始化，战斗过程中实时变化。
 *
 * effective_speed = baseSpeed + sumBuff(SPEED_BONUS) - sumBuff(SPEED_DEBUFF) - floor(frostStacks / 3)
 * effective_speed ≤ 0 时进入冻结状态，行动槽停止增长。
 */
export interface RuntimeCombatant {
    /** 当前 HP —— 每场战斗结束后回满至 maxHp（保证对阵残影时的公平性） */
    currentHp: number;
    /** 最大 HP = CON × 15 + 30 */
    maxHp: number;
    /** 攻击加成 —— 基础 = Max(STR - 10, 0)，自动叠加到攻击类卡牌伤害 */
    attack: number;
    /** 基础速度 —— 含事件/遗物的永久修改 */
    baseSpeed: number;
    /** 最大 MP = round(MANA × 1.5) */
    maxMp: number;
    /** 当前 MP —— 每场战斗重置为满，每周期回复 1（不超上限） */
    currentMp: number;
    /** 当前护甲 —— 每场战斗清零（遗物可在开始时叠加），受击先扣甲再扣 HP */
    armor: number;

    /** 霜蚀层数 —— 每 3 层 = 速度 -1，每周期衰减 2 层 */
    frostStacks: number;
    /** 灼烧层数 —— 火系额外伤害 + 层数，不自然衰减，引爆后清零 */
    burnStacks: number;
    /** 毒药层数 —— 每周期造成等量伤害（无视护甲），每周期衰减 1 层 */
    poisonStacks: number;

    /** ATB 行动槽 —— 每 tick += effectiveSpeed，≥ 100 时触发行动后 -= 100 */
    actionGauge: number;
    /** 卡组指针 —— 指向下一张要打的牌，循环到头后归零 */
    deckIndex: number;

    /** 已激活的能力卡效果列表 —— POWER 类卡牌打出后挂载于此 */
    activePowers: ActivePower[];

    /** 当前生效的 Buff 列表 —— 每次出牌后 duration > 0 的 Buff 递减，归零移除 */
    buffs: ActiveBuff[];
}

/**
 * 运行时 Buff 实例。
 * 由卡牌效果施加，挂载在角色身上。
 * duration > 0 时每次出牌递减，归零自动移除；duration = -1 永久生效。
 */
export interface ActiveBuff {
    /** Buff 类型 */
    type: BuffType;
    /** 效果数值 */
    value: number;
    /** 剩余持续行动次数（-1 = 永久） */
    remaining: number;
    /** 来源卡牌 ID（用于 UI 展示和调试） */
    sourceCardId: string;
}

/**
 * 已激活的能力卡效果。
 * POWER 类卡牌打出后从卡组移除，效果挂载到角色身上直到战斗结束。
 */
export interface ActivePower {
    /** 来源卡牌 ID */
    cardId: string;
    /** 触发时机（PowerTrigger 的值） */
    trigger: string;
    /** 每次触发时执行的效果 */
    effect: unknown;
    /** 当前叠加层数 */
    currentStacks: number;
    /** 最大叠加层数 */
    maxStacks: number;
}
