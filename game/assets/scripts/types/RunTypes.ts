import { Faction, GameNodeType, RunStatus, TempBuffType } from './Enums';
import { PlayerBaseProperty } from './CharacterTypes';
import { CardInstance } from './CardTypes';

/**
 * 临时增益。
 * 来源：事件奖励 / 赌约正面效果。
 * 在下一场战斗初始化阶段应用，生效后自动移除。
 */
export interface TempBuff {
    /** 增益 ID */
    id: string;
    /** 面向玩家的描述 */
    description: string;
    /** 效果列表 */
    effects: TempBuffEffect[];
}

/** 临时增益的具体效果 */
export interface TempBuffEffect {
    /** 效果类型 */
    type: TempBuffType;
    /** 效果数值 */
    value: number;
}

/**
 * 单局完整状态（RunState）。
 * 贯穿一整局游戏（从开局到通关/死亡），是存档/恢复的核心数据。
 * 支持中途暂停恢复（存入 LocalStorage）。
 */
export interface RunState {
    /** 本局随机种子（确保相同种子 = 相同结果） */
    seed: number;
    /** 四维基础属性（可被事件/遗物永久修改） */
    baseProperty: PlayerBaseProperty;
    /** 当前 HP —— 每场战斗结束后回满至 maxHp */
    currentHp: number;
    /** 最大 HP = CON × 15 + 30 */
    maxHp: number;
    /** 有序卡组（按此顺序循环出牌） */
    deck: CardInstance[];
    /** 当前持有遗物 ID 列表 */
    relics: string[];
    /** 流派池 —— 每局随机抽取的流派列表，决定可获取的卡牌范围 */
    factionPool: Faction[];
    /** 当前金币 */
    gold: number;
    /** 当前层数（1-10），通关第 10 层即胜利 */
    currentFloor: number;
    /** 当前循环（1 = PvE 循环，2 = PvP 循环） */
    currentCycle: 1 | 2;
    /** 当前所处的游戏节点类型 */
    currentNode: GameNodeType;
    /**
     * 当前在本层节点序列中的索引（0-5）。
     * 普通层 6 节点：事件→路线选择→事件→事件→残影选择→商店
     * 用于精确定位恢复位置（因为同层有多个 EVENT 节点）。
     */
    nodeIndex: number;
    /** 是否已使用本局的免费重摇机会 */
    rerollUsed: boolean;
    /** 商店服务累计使用次数（决定服务价格：50 + serviceUseCount × 25） */
    serviceUseCount: number;
    /** 当前局状态 */
    runStatus: RunStatus;
    /** 临时增益列表（下场战斗生效后消失） */
    tempBuffs: TempBuff[];
    /** 本局已遇到的残影 ID 列表（同局不重复匹配） */
    encounteredGhosts: string[];
    /** 本局统计数据 */
    stats: RunStats;
}

/** 单局统计数据（用于结算界面展示） */
export interface RunStats {
    /** 击败野怪数 */
    monstersDefeated: number;
    /** 击败残影数 */
    ghostsDefeated: number;
    /** 获得卡牌数 */
    cardsObtained: number;
    /** 移除卡牌数 */
    cardsRemoved: number;
    /** 累计获得金币 */
    goldEarned: number;
    /** 累计消费金币 */
    goldSpent: number;
    /** 累计造成伤害 */
    damageDealt: number;
    /** 累计受到伤害 */
    damageTaken: number;
    /** 到达最高层数 */
    highestFloor: number;
}
