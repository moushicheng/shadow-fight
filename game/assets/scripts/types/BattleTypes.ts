import { RuntimeCombatant } from './CharacterTypes';
import { CardInstance } from './CardTypes';

/**
 * 战斗参与者完整数据。
 * 包含玩家或对手（残影/野怪）的所有战斗信息。
 */
export interface BattleFighter {
    /** 显示名称（玩家昵称 / 野怪名 / 残影玩家名） */
    name: string;
    /** 运行时战斗属性 */
    combatant: RuntimeCombatant;
    /** 有序卡组（按此顺序循环出牌） */
    deck: CardInstance[];
    /** 持有遗物 ID 列表 */
    relics: string[];
}

/**
 * 战斗运行时状态。
 * 由 BattleEngine 维护，每个 tick 更新。UI 层监听此状态渲染画面。
 */
export interface BattleState {
    /** 玩家（攻方） */
    player: BattleFighter;
    /** 对手（守方：残影/野怪） */
    opponent: BattleFighter;
    /** 当前 tick 数（最小时间单位） */
    tickCount: number;
    /** 当前周期数（每 100 tick 为一个周期，用于状态衰减/毒伤/MP 回复） */
    cycleCount: number;
    /** 战斗是否已结束 */
    isFinished: boolean;
    /** 获胜方（null = 尚未结束） */
    winner: 'player' | 'opponent' | 'draw' | null;
    /** 战斗日志（用于 UI 展示和回放） */
    log: BattleLogEntry[];
}

/** 战斗日志条目 */
export interface BattleLogEntry {
    /** 发生的 tick */
    tick: number;
    /** 发生的周期 */
    cycle: number;
    /** 行为主体 */
    actor: 'player' | 'opponent' | 'system';
    /** 日志类型 */
    type: BattleLogType;
    /** 面向玩家的描述文本 */
    message: string;
    /** 附加数据（伤害值、状态层数等，用于 UI 飘字） */
    details?: Record<string, unknown>;
}

/** 战斗日志类型枚举 */
export enum BattleLogType {
    /** 打出卡牌 */
    PLAY_CARD = 'PLAY_CARD',
    /** MP 不足跳过卡牌 */
    SKIP_CARD = 'SKIP_CARD',
    /** 造成伤害 */
    DAMAGE = 'DAMAGE',
    /** 回复 HP/MP */
    HEAL = 'HEAL',
    /** 获得护甲 */
    ARMOR_GAIN = 'ARMOR_GAIN',
    /** 施加状态效果（霜蚀/灼烧/毒药） */
    STATUS_APPLY = 'STATUS_APPLY',
    /** 状态效果衰减 */
    STATUS_DECAY = 'STATUS_DECAY',
    /** 汲取属性（血族） */
    DRAIN = 'DRAIN',
    /** 诅咒卡被塞入对手卡组 */
    CURSE_INSERT = 'CURSE_INSERT',
    /** 周期结算（毒伤/衰减/MP 回复） */
    CYCLE_END = 'CYCLE_END',
    /** 进入冻结状态（有效速度 ≤ 0） */
    FREEZE = 'FREEZE',
    /** 解除冻结 */
    UNFREEZE = 'UNFREEZE',
    /** 加时伤害（100 周期后递增） */
    OVERTIME_DAMAGE = 'OVERTIME_DAMAGE',
    /** 战斗结束 */
    BATTLE_END = 'BATTLE_END',
    /** 能力卡效果激活（首次打出） */
    POWER_ACTIVATE = 'POWER_ACTIVATE',
    /** 能力卡效果触发（按时机） */
    POWER_TRIGGER = 'POWER_TRIGGER',
    /** 遗物效果触发 */
    RELIC_TRIGGER = 'RELIC_TRIGGER',
}

/**
 * 战斗配置（可调参数）。
 * 赛季规则可修改这些参数（如速攻赛季将 overtimeStartCycle 从 100 降到 50）。
 */
export interface BattleConfig {
    /** 行动槽触发阈值 —— 行动槽 ≥ 此值时执行行动 */
    gaugeThreshold: number;
    /** 每多少 tick 触发一次周期结算 */
    ticksPerCycle: number;
    /** 霜蚀减速系数 —— 每 N 层霜蚀 = effective_speed -1 */
    frostPerSpeedReduction: number;
    /** 霜蚀每周期衰减层数 */
    frostDecayPerCycle: number;
    /** 毒药每周期衰减层数（先伤害后衰减） */
    poisonDecayPerCycle: number;
    /** MP 每周期回复量（不超上限） */
    mpRecoveryPerCycle: number;
    /** 加时起始周期 —— 超过此周期后每周期双方受递增伤害 */
    overtimeStartCycle: number;
    /** 强制结束周期 —— 超过此周期判平局，双方不获奖励 */
    forceEndCycle: number;
}

/** 默认战斗配置（基于 battle-base.md §11.2） */
export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
    gaugeThreshold: 100,         // 行动槽阈值 —— 行动槽 ≥ 此值时执行行动
    ticksPerCycle: 10,           // 每10tick=1周期（≈1回合，SPD10角色每周期行动1次）
    frostPerSpeedReduction: 3,   // 每 3 层霜蚀 = -1 speed
    frostDecayPerCycle: 1,       // 每周期 -1 层（1周期≈1回合，衰减更慢以保证冰系控制力）
    poisonDecayPerCycle: 1,      // 每周期 -1 层
    mpRecoveryPerCycle: 1,       // 每周期 +1 MP
    overtimeStartCycle: 20,      // 第 20 周期开始加时（SPD10约20次行动）
    forceEndCycle: 30,           // 第 30 周期强制结束
};
