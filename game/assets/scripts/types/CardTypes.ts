import {
    Faction, CardRarity, CardType, CardTag, PowerTrigger,
    Attribute, StatusType, EffectTarget, ConditionType,
    ConditionOperator, CurseInsertPosition, DrainAttribute,
    BuffType,
} from './Enums';

// ─── 卡牌效果条件 ──────────────────────────────────────

/**
 * 卡牌效果的触发条件。
 * 部分效果需满足条件才触发（或触发增强版本），条件可附加在任意效果节点上。
 *
 * 示例 —— 武僧卡："若 MP ≥ 8，造成 35 伤害；否则造成 10 伤害"
 * ```
 * { type: CURRENT_MP, operator: '>=', value: 8, fallback: { damage: { base: 10 } } }
 * ```
 */
export interface EffectCondition {
    /** 检查哪个维度（HP 占比、当前 MP、护甲值、敌方状态等） */
    type: ConditionType;
    /** 比较运算符 */
    operator: ConditionOperator;
    /** 阈值 */
    value: number;
    /** 条件不满足时的替代效果（可选，无则不执行） */
    fallback?: CardEffect;
}

// ─── 卡牌效果子类型 ────────────────────────────────────

/**
 * 伤害效果。
 * 支持固定值、属性缩放、公式三种伤害来源，可叠加。
 */
export interface DamageEffect {
    /** 固定伤害值 */
    base?: number;
    /** 属性缩放 —— 如 { attribute: 'SPD', multiplier: 1.0 } 表示 1×SPD 伤害 */
    scaling?: { attribute: Attribute; multiplier: number };
    /** 复杂公式（当 base+scaling 不够用时） —— 如 "lostHp * 0.3" */
    formula?: string;
    /** 是否无视护甲（毒药伤害/自伤用），默认 false */
    ignoreArmor?: boolean;
}

/** 护甲效果 */
export interface ArmorEffect {
    /** 获得固定护甲值 */
    gain?: number;
    /** 属性缩放护甲 —— 如 { attribute: 'CON', multiplier: 0.5 } */
    scaling?: { attribute: Attribute; multiplier: number };
}

/** 回复效果 */
export interface HealEffect {
    /** 回复固定 HP */
    hp?: number;
    /** 回复最大 HP 的百分比（0-1） */
    hpPercent?: number;
    /** 回复固定 MP */
    mp?: number;
}

/**
 * 状态效果（施加层数）。
 * 霜蚀/灼烧/毒药，施加到目标身上。
 */
export interface StatusEffect {
    /** 状态类型 */
    type: StatusType;
    /** 施加层数 */
    stacks: number;
}

/**
 * 汲取效果（血族专属）。
 * 从对方扣除 N 点属性并加到自身，实际差值变化 = 2N。
 * 汲取 SPD 后立即影响双方 ATB 行动槽填充速率。
 */
export interface DrainEffect {
    /** 汲取哪个属性（ATK / SPD / ARMOR） */
    attribute: DrainAttribute;
    /** 汲取数值（对方 -N，己方 +N） */
    amount: number;
}

/**
 * 诅咒效果（咒术师专属）。
 * 将诅咒卡塞入对手卡组，轮到时强制使用。
 */
export interface CurseEffect {
    /** 塞入的诅咒卡 ID */
    cardId: string;
    /** 塞入数量 */
    count: number;
    /** 插入位置（RANDOM/NEXT/TOP） */
    insertPosition: CurseInsertPosition;
}

/**
 * Buff 效果。
 * 施加一个 Buff 到目标身上，持续 duration 次行动后自动移除。
 * duration = -1 表示永久生效（直到战斗结束）。
 *
 * 示例 —— "下一张牌 0 费"：
 * { type: COST_REDUCTION, value: 99, duration: 1 }
 *
 * 示例 —— "永久伤害 +3"：
 * { type: DAMAGE_BONUS, value: 3, duration: -1 }
 */
export interface BuffEffect {
    /** Buff 类型 */
    type: BuffType;
    /** 效果数值（减费量 / 加伤值 / 倍率等，含义由 type 决定） */
    value: number;
    /** 持续行动次数（每次出牌 -1，降到 0 时移除；-1 = 永久） */
    duration: number;
}

/**
 * 特殊效果（无法用上述结构描述的机制）。
 * 如引爆灼烧(DETONATE)、投骰(DICE_ROLL)、属性转化(CONVERT_ATTRIBUTE)。
 */
export interface SpecialEffect {
    /** 特殊效果标识 */
    type: string;
    /** 具体参数，按需定义 */
    params: Record<string, unknown>;
}

// ─── 组合卡牌效果 ──────────────────────────────────────

/**
 * 卡牌效果节点。
 * 一张卡牌可包含多个效果节点，按顺序依次结算。
 * 每个节点可组合伤害/护甲/回复/状态等多种子效果。
 */
export interface CardEffect {
    /** 效果目标（ENEMY 或 SELF） */
    target: EffectTarget;
    /** 触发条件（可选） */
    condition?: EffectCondition;
    /** 伤害 */
    damage?: DamageEffect;
    /** 护甲 */
    armor?: ArmorEffect;
    /** 回复 */
    heal?: HealEffect;
    /** 状态效果（霜蚀/灼烧/毒药） */
    status?: StatusEffect;
    /** 汲取（血族） */
    drain?: DrainEffect;
    /** 诅咒（咒术师） */
    curse?: CurseEffect;
    /** Buff（减费/加伤/易伤等） */
    buff?: BuffEffect;
    /** 特殊效果 */
    special?: SpecialEffect;
}

// ─── 能力卡专属 ────────────────────────────────────────

/**
 * 能力卡（POWER）专属数据。
 * 能力卡打出后从卡组移除（不进弃牌堆），效果永久挂载到角色身上。
 * 同一场战斗同名能力卡最多打出一次（除非 stackable）。
 */
export interface PowerData {
    /** 触发时机 */
    trigger: PowerTrigger;
    /** 每次触发时执行的效果 */
    effect: CardEffect;
    /** 再次打出同名能力卡时是否叠加效果 */
    stackable: boolean;
    /** 可叠加时的最大层数 */
    maxStacks: number;
}

// ─── 卡牌升级 ──────────────────────────────────────────

/**
 * 卡牌升级数据。
 * 每张卡有一个升级版本（商店 80 金），升级时二选一：
 * - 费用减免：法力消耗 -1（最低 0）
 * - 效果增强：效果数值 +30%
 */
export interface CardUpgrade {
    /** 升级后显示名称 —— 格式建议："{原名}+" */
    name: string;
    /** 费用减免值（通常为 1） */
    costReduction: number;
    /** 增强效果的面向玩家描述 */
    enhancedDescription: string;
    /** 增强后覆盖原始 effects 中的数值字段 */
    enhancedEffects: Partial<CardEffect>[];
}

// ─── 完整卡牌定义 ──────────────────────────────────────

/**
 * 完整卡牌定义（静态配置数据）。
 * 所有卡牌共享此结构，通过 cardType 区分 ATTACK/SKILL/POWER/CURSE。
 */
export interface CardDef {
    /** 全局唯一 ID，格式：{faction}_{snake_case_name}，如 fire_flame_strike */
    id: string;
    /** 显示名称，如「火焰冲击」 */
    name: string;
    /** 所属流派 */
    faction: Faction;
    /** 面向玩家的效果文本 */
    description: string;
    /** 卡牌故事/氛围文本（可选） */
    flavorText?: string;

    /** 品质（NORMAL/RARE/EPIC/LEGENDARY） */
    rarity: CardRarity;
    /** 功能类型（ATTACK/SKILL/POWER/CURSE） */
    cardType: CardType;
    /** 标签列表，用于遗物/事件的条件引用 */
    tags: CardTag[];

    /** 法力消耗（0-5），MP 不足时跳过此卡 */
    manaCost: number;
    /** 效果列表，按顺序依次结算 */
    effects: CardEffect[];

    /** 最低出现层数（默认 1） */
    floorMin: number;
    /** 最高出现层数（默认 10） */
    floorMax: number;
    /** 同品质同流派内的相对掉落概率权重（默认 1.0） */
    dropWeight: number;
    /** 是否在战斗奖励池中出现 */
    droppable: boolean;
    /** 是否在商店中出现 */
    buyable: boolean;
    /** 是否在事件奖励中出现 */
    eventObtainable: boolean;
    /** 是否仅作为初始卡组卡牌（如「普通攻击」） */
    starterOnly: boolean;

    /** 升级数据 */
    upgrade: CardUpgrade;

    /** 能力卡专属数据（仅 cardType === POWER 时有效） */
    power?: PowerData;

    /** 诅咒卡：轮到时是否强制使用 */
    forcePlay?: boolean;
    /** 诅咒卡：打出后是否从卡组中永久移除 */
    removeAfterPlay?: boolean;
}

// ─── 运行时卡牌实例 ────────────────────────────────────

/**
 * 运行时卡牌实例。
 * CardDef 是静态模板，CardInstance 是玩家卡组中的具体实例（带升级状态）。
 * 通过 defId 关联到 CardDef 查询完整属性。
 */
export interface CardInstance {
    /** 关联的 CardDef.id */
    defId: string;
    /** 是否已升级 */
    upgraded: boolean;
    /** 升级路线：'cost' = 费用 -1, 'enhance' = 效果 +30%（未升级时为 undefined） */
    upgradePath?: 'cost' | 'enhance';
}
