/**
 * 流派标签。
 * 每局开始随机抽 2 个流派组成「流派池」，玩家只能获取池内 + COMMON 的卡牌。
 * 10 个流派分为关键词流派（拥有专属状态）和纯卡牌流派，共 C(10,2)=45 种组合。
 */
export enum Faction {
    /** 冰系 —— 关键词「霜蚀」，减速控场，行动碾压 */
    ICE = 'ICE',
    /** 火系 —— 关键词「灼烧」，叠层引爆，一波秒杀 */
    FIRE = 'FIRE',
    /** 毒系 —— 关键词「毒药」，穿甲 DoT，慢性致死 */
    POISON = 'POISON',
    /** 咒术师 —— 关键词「诅咒」，污染对手卡组，干扰节奏 */
    HEX = 'HEX',
    /** 血族 —— 关键词「汲取」，偷属性滚雪球 */
    BLOOD = 'BLOOD',
    /** 刺客 —— 纯卡牌流派，堆速度多动，终结收割 */
    ASSASSIN = 'ASSASSIN',
    /** 狂战士 —— 纯卡牌流派，越残越强，搏命输出 */
    BERSERKER = 'BERSERKER',
    /** 守卫 —— 纯卡牌流派，堆甲防守，以守为攻 */
    GUARDIAN = 'GUARDIAN',
    /** 武僧 —— 纯卡牌流派，法力精算，条件爆发 */
    MONK = 'MONK',
    /** 赌徒 —— 纯卡牌流派，高方差赌命，拥有战斗外专属「赌约」机制 */
    GAMBLER = 'GAMBLER',
    /** 通用 —— 不受流派池限制，任何角色都可获取 */
    COMMON = 'COMMON',
}

/**
 * 卡牌品质。
 * 影响战斗掉落概率（55%/30%/12%/3%）、商店价格、视觉颜色。
 * 7 层以上紫/金掉率各 +5%。
 */
export enum CardRarity {
    /** 普通（白） —— 掉率 55%，商店价 30-50 金 */
    NORMAL = 'NORMAL',
    /** 稀有（蓝） —— 掉率 30%，商店价 80-120 金 */
    RARE = 'RARE',
    /** 史诗（紫） —— 掉率 12%，商店价 150-200 金 */
    EPIC = 'EPIC',
    /** 传说（金） —— 掉率 3%，商店价 300-400 金 */
    LEGENDARY = 'LEGENDARY',
}

/**
 * 卡牌功能类型。
 * 一张卡只归属一个主类型，混合功能按主要设计意图分类。
 */
export enum CardType {
    /** 攻击 —— 以造成伤害为主要目的 */
    ATTACK = 'ATTACK',
    /** 技能 —— 一次性功能卡（增益/控制/回复/护甲），打出即结算 */
    SKILL = 'SKILL',
    /** 能力 —— 打出后效果在本场战斗内永久生效，不进入弃牌堆 */
    POWER = 'POWER',
    /** 诅咒 —— 被塞入对手卡组的负面牌，轮到时强制使用 */
    CURSE = 'CURSE',
}

/**
 * 卡牌标签。
 * 用于遗物/事件/条件的交叉引用，一张卡可拥有多个标签。
 */
export enum CardTag {
    /** 引爆 —— 消耗灼烧层数转化为伤害 */
    DETONATE = 'DETONATE',
    /** 吸血 —— 造成伤害的同时回复等量/部分 HP */
    LIFESTEAL = 'LIFESTEAL',
    /** 汲取 —— 偷取对手属性 */
    DRAIN = 'DRAIN',
    /** 冻结 —— 与霜蚀机制相关 */
    FREEZE = 'FREEZE',
    /** 自伤 —— 以消耗己方 HP 为代价 */
    SELF_DAMAGE = 'SELF_DAMAGE',
    /** 随机 —— 效果包含随机性 */
    RANDOM = 'RANDOM',
    /** 终结 —— 设计意图为收割/终结的高伤害牌 */
    FINISHER = 'FINISHER',
    /** 蓄力 —— 不直接造伤害，为后续爆发做准备（叠灼烧/堆甲） */
    CHARGE = 'CHARGE',
    /** 工具 —— 资源管理类功能牌（魔力瓶、聚气） */
    UTILITY = 'UTILITY',
}

/**
 * 能力卡（POWER）触发时机。
 * 能力卡打出后效果永久挂载在角色身上，按此时机触发。
 */
export enum PowerTrigger {
    /** 每次行动开始时触发 —— 如"每回合开始获得 3 护甲" */
    TURN_START = 'TURN_START',
    /** 每次行动结束时触发 —— 如"每回合结束回复 2 HP" */
    TURN_END = 'TURN_END',
    /** 打出其他卡牌时触发 —— 如"每打出一张攻击牌，额外造成 2 伤害" */
    ON_PLAY_CARD = 'ON_PLAY_CARD',
    /** 受到伤害时触发 —— 如"受到攻击时反弹 3 伤害" */
    ON_TAKE_DAMAGE = 'ON_TAKE_DAMAGE',
    /** 造成伤害时触发 —— 如"造成伤害时回复 1 HP" */
    ON_DEAL_DAMAGE = 'ON_DEAL_DAMAGE',
    /** 打出时立即生效的被动修改 —— 如"ATK 永久 +5" */
    IMMEDIATE = 'IMMEDIATE',
}

/**
 * 四维基础属性。
 * 每局开始随机分配 40 点到四维，SPD 下限为 3。
 */
export enum Attribute {
    /** 力量 —— 映射为 attack，影响物理伤害倍率 */
    STR = 'STR',
    /** 体质 —— 映射为 HP = CON × 15 + 30 */
    CON = 'CON',
    /** 速度 —— 映射为 speed，影响 ATB 行动频率、先手判定 */
    SPD = 'SPD',
    /** 法力 —— 映射为 mana = round(MANA × 1.5)，每回合可用法力 */
    MANA = 'MANA',
}

/**
 * 状态效果类型（关键词流派专属）。
 * 附着在目标身上，按各自规则衰减和结算。
 */
export enum StatusType {
    /** 霜蚀（冰系） —— 每 3 层 = 目标速度 -1，可冻结；每周期 -2 层 */
    FROST = 'FROST',
    /** 灼烧（火系） —— 不直接伤害，火系卡牌额外伤害 + 层数；不自然衰减，引爆后清零 */
    BURN = 'BURN',
    /** 毒药（毒系） —— 每周期造成 = 层数的伤害（无视护甲）；每周期 -1 层 */
    POISON = 'POISON',
}

/** 卡牌效果的作用目标 */
export enum EffectTarget {
    /** 对敌方生效 */
    ENEMY = 'ENEMY',
    /** 对自身生效 */
    SELF = 'SELF',
}

/**
 * 效果条件类型。
 * 用于卡牌效果的条件判断，如"若 HP < 30% 则伤害翻倍"。
 */
export enum ConditionType {
    /** 当前 HP 占最大 HP 的比例（0-1） —— 狂战士"若 HP < 30%，伤害翻倍" */
    HP_PERCENT = 'HP_PERCENT',
    /** 当前法力值 —— 武僧"若 MP ≥ 8，造成 35 伤害" */
    CURRENT_MP = 'CURRENT_MP',
    /** 当前护甲值 —— 守卫"若护甲 > 0，受到伤害 -5" */
    CURRENT_ARMOR = 'CURRENT_ARMOR',
    /** 敌方某状态层数 —— 火系"若灼烧 ≥ 10，引爆伤害 +50%" */
    ENEMY_STATUS = 'ENEMY_STATUS',
    /** 当前回合数 —— "第 1 回合额外获得 5 护甲" */
    TURN_COUNT = 'TURN_COUNT',
    /** 本回合已出牌数 —— 刺客"本回合第 3 张及之后的牌伤害 +5" */
    CARDS_PLAYED_THIS_TURN = 'CARDS_PLAYED_THIS_TURN',
    /** 本回合已消耗 MP —— 武僧"造成本回合已消耗 MP × 2 伤害" */
    MP_SPENT_THIS_TURN = 'MP_SPENT_THIS_TURN',
}

/** 条件运算符 */
export enum ConditionOperator {
    /** 大于等于 */
    GTE = '>=',
    /** 小于等于 */
    LTE = '<=',
    /** 大于 */
    GT = '>',
    /** 小于 */
    LT = '<',
    /** 等于 */
    EQ = '==',
}

/**
 * 诅咒卡插入对方卡组的位置。
 * 插入位置影响诅咒卡何时被触发。
 */
export enum CurseInsertPosition {
    /** 随机位置（当前指针之后、卡组末尾之前） */
    RANDOM = 'RANDOM',
    /** 插在对方下一张牌的位置 */
    NEXT = 'NEXT',
    /** 插在队首 */
    TOP = 'TOP',
}

/**
 * Buff 类型。
 * 卡牌可施加 Buff 到自身或敌方，duration 控制持续行动次数（-1 = 永久）。
 */
export enum BuffType {
    /** 减费 —— 降低出牌 MP 消耗 */
    COST_REDUCTION = 'COST_REDUCTION',
    /** 伤害加成 —— 出牌时额外伤害 */
    DAMAGE_BONUS = 'DAMAGE_BONUS',
    /** 伤害倍率 —— 出牌时伤害乘以 value */
    DAMAGE_MULTIPLY = 'DAMAGE_MULTIPLY',
    /** 护甲加成 —— 获得护甲时额外值 */
    ARMOR_BONUS = 'ARMOR_BONUS',
    /** 速度加成 —— 临时修改有效速度 */
    SPEED_BONUS = 'SPEED_BONUS',
    /** 攻击削弱 —— 降低攻击力（汲取 ATK 时挂给对方） */
    ATK_DEBUFF = 'ATK_DEBUFF',
    /** 速度削弱 —— 降低有效速度（汲取 SPD 时挂给对方） */
    SPEED_DEBUFF = 'SPEED_DEBUFF',
    /** 易伤 —— 受到伤害时倍率增加 */
    VULNERABILITY = 'VULNERABILITY',
    /** 格挡 —— 受到伤害时减少固定值 */
    DAMAGE_REDUCTION = 'DAMAGE_REDUCTION',
}

/**
 * 可被汲取（血族）的战斗属性。
 * 汲取 N = 对方 -N，己方 +N，实际差值 2N。
 */
export enum DrainAttribute {
    /** 攻击力 */
    ATK = 'ATK',
    /** 速度 —— 汲取后立即影响双方 ATB 行动槽填充速率 */
    SPD = 'SPD',
    /** 护甲 */
    ARMOR = 'ARMOR',
}

/**
 * 遗物品质。
 * 获得概率：普通 60% / 稀有 30% / 传说 10%。
 */
export enum RelicRarity {
    /** 普通 —— 小幅被动增益 */
    NORMAL = 'NORMAL',
    /** 稀有 —— 中等增益或条件触发效果 */
    RARE = 'RARE',
    /** 传说 —— 改变构筑方向的强力效果 */
    LEGENDARY = 'LEGENDARY',
}

/**
 * 遗物触发时机。
 * 遗物是局内持续生效的被动道具，按此时机触发效果。
 */
export enum RelicTrigger {
    /** 战斗开始时 —— 如"铁皮水壶：获得 5 护甲" */
    BATTLE_START = 'BATTLE_START',
    /** 每次行动时 */
    ON_ACTION = 'ON_ACTION',
    /** 每周期结算时（100 tick 一次） */
    ON_CYCLE_END = 'ON_CYCLE_END',
    /** 受到伤害时 */
    ON_TAKE_DAMAGE = 'ON_TAKE_DAMAGE',
    /** 造成伤害时 */
    ON_DEAL_DAMAGE = 'ON_DEAL_DAMAGE',
    /** 战斗结束时 */
    BATTLE_END = 'BATTLE_END',
    /** 进入商店时 —— 如"红宝石戒指：每次进入商店恢复 10 HP" */
    ON_ENTER_SHOP = 'ON_ENTER_SHOP',
    /** 被动持续生效（非战斗中） */
    PASSIVE = 'PASSIVE',
}

/**
 * 事件分类。
 * 概率随层数变化：1-3 层正面多，7-9 层负面多。
 */
export enum EventCategory {
    /** 正面事件 —— 1-3 层 50%，4-6 层 35%，7-9 层 20% */
    POSITIVE = 'POSITIVE',
    /** 中性事件 —— 1-3 层 30%，4-6 层 35%，7-9 层 35% */
    NEUTRAL = 'NEUTRAL',
    /** 负面事件 —— 1-3 层 20%，4-6 层 30%，7-9 层 45% */
    NEGATIVE = 'NEGATIVE',
}

/**
 * 野怪类型。
 * 每层从对应难度区间随机抽取，战斗风格不同。
 */
export enum MonsterType {
    /** 普通野怪 —— 属性平均，通用卡牌，1-10 层出现 */
    NORMAL = 'NORMAL',
    /** 流派野怪 —— 具备某一流派简易卡组，3-10 层出现 */
    FACTION = 'FACTION',
    /** 精英野怪 —— 属性更高，携带遗物，卡组更完善，6-10 层出现 */
    ELITE = 'ELITE',
}

/**
 * 游戏节点类型。
 * 标识当前局中玩家所处的流程位置，用于存档/恢复和 UI 切换。
 *
 * 每层结构：[事件] → [路线三选一] → [事件] → [事件] → [残影三选一] → [商店]
 *           ╰──── 第 1 循环(PvE) ──╯    ╰──── 第 2 循环(PvP) ──╯
 */
export enum GameNodeType {
    /** 事件节点 —— 每个循环首节点，随机抽 1 个事件 */
    EVENT = 'event',
    /** 路线三选一 —— 第 1 循环战斗节点前，精英/普通/未知事件 */
    ROUTE_CHOICE = 'route_choice',
    /** 普通野怪战斗 */
    MONSTER_BATTLE = 'monster_battle',
    /** 精英野怪战斗 —— 难度 = 当前层 +2，奖励更好 */
    ELITE_BATTLE = 'elite_battle',
    /** 残影三选一 —— 第 2 循环，从 3 个残影中选对手 */
    GHOST_CHOICE = 'ghost_choice',
    /** 残影战斗 */
    GHOST_BATTLE = 'ghost_battle',
    /** 赏金挑战 —— 10% 概率出现，Boss 级野怪，高风险高回报 */
    BOUNTY_BATTLE = 'bounty_battle',
    /** 商店 —— 每层第 2 循环末尾，唯一的购物机会 */
    SHOP = 'shop',
    /** 赌约选择 —— 赌徒流派专属，每场战斗前触发（可跳过） */
    WAGER = 'wager',
}

/**
 * 路线选择类型。
 * 每层第 1 循环提供三选一（1-2 层锁定普通，3 层起解锁）。
 * 三选一：精英战斗 / 普通战斗 A / 普通战斗 B，每个选项展示怪物名称。
 */
export enum RouteType {
    /** 精英战斗 —— 高风险高收益，金币 ×1.5，必出稀有卡，遗物掉率 25% */
    ELITE = 'ELITE',
    /** 普通战斗 —— 标准难度标准奖励，稳健推进的默认选择 */
    NORMAL = 'NORMAL',
    /** 赏金挑战 —— 10% 概率额外出现，精英 ×1.5 强度，胜利额外送遗物 */
    BOUNTY = 'BOUNTY',
}

/** 单局运行状态 */
export enum RunStatus {
    /** 进行中 */
    ONGOING = 'ONGOING',
    /** 通关胜利 */
    VICTORY = 'VICTORY',
    /** 死亡失败 */
    DEFEAT = 'DEFEAT',
}

/**
 * 临时增益效果类型。
 * 来自事件奖励 / 赌约正面效果，在下场战斗初始化时应用。
 */
export enum TempBuffType {
    /** 本场战斗 ATK +value */
    ATK_ADD = 'ATK_ADD',
    /** 本场战斗 SPD +value */
    SPD_ADD = 'SPD_ADD',
    /** 本场战斗伤害倍率 +value（如 0.5 = +50%） */
    DAMAGE_MULT = 'DAMAGE_MULT',
    /** 本场战斗受到伤害倍率 +value */
    DAMAGE_TAKEN_MULT = 'DAMAGE_TAKEN_MULT',
    /** 立即改变 HP（正数回复，负数扣血） */
    HP_CHANGE = 'HP_CHANGE',
    /** 覆盖加时阈值（如速战速决赌约 = 30 周期） */
    OVERTIME_LIMIT = 'OVERTIME_LIMIT',
}
