import { PlayerBaseProperty } from './CharacterTypes';
import { CardInstance } from './CardTypes';
import { Faction } from './Enums';

/**
 * 残影数据（异步 PVP 核心）。
 * 玩家死亡时系统记录其完整构筑信息，存入对应层的对手池。
 * 其他玩家打到该层的第 2 循环时，从池中三选一挑战残影。
 * 残影的战斗逻辑与真人完全一致（按卡序自动出牌）。
 */
export interface Ghost {
    /** 玩家唯一 ID */
    oderId: string;
    /** 玩家昵称（战斗前展示） */
    playerName: string;
    /** 随机种子（用于重建属性） */
    seed: number;
    /** 死亡时的基础属性（含事件/遗物永久修改） */
    baseProperty: PlayerBaseProperty;
    /** 死亡时的有序卡组 */
    deck: CardInstance[];
    /** 死亡时持有的遗物列表 */
    relics: string[];
    /** 死在第几层（决定进入哪一层的对手池） */
    floor: number;
    /** 流派池 */
    factionPool: [Faction, Faction];
    /** 存档时间戳 */
    timestamp: number;
}

/**
 * 残影展示概要（三选一界面用）。
 * 展示部分信息便于玩家决策，隐藏具体卡牌/遗物/精确属性保留悬念。
 */
export interface GhostSummary {
    /** 玩家唯一 ID */
    oderId: string;
    /** 玩家昵称 */
    playerName: string;
    /** 流派池 —— 展示如「冰 + 刺客」，便于判断克制关系 */
    factionPool: [Faction, Faction];
    /** 难度星级 —— ★☆☆ 较弱 / ★★☆ 中等 / ★★★ 强力 */
    difficulty: 1 | 2 | 3;
    /** 卡组张数 —— 暗示构筑质量（少而精 vs 多而杂） */
    deckSize: number;
    /** 特殊标记 */
    tags: GhostTag[];
}

/** 残影特殊标记 */
export enum GhostTag {
    /** 悬赏目标 —— 击败额外 +50 金 */
    BOUNTY = 'BOUNTY',
    /** 复仇对象 —— 被此残影击败过，优先展示 */
    REVENGE = 'REVENGE',
    /** 好友残影 —— 来自抖音好友，优先展示 */
    FRIEND = 'FRIEND',
}

/**
 * 服务端残影记录。
 * 残影按赛季存储，赛季结束后清空。
 */
export interface GhostRecord {
    /** 玩家唯一 ID */
    oderId: string;
    /** 完整残影数据 */
    ghost: Ghost;
    /** 所属赛季 ID */
    seasonId: string;
    /** 创建时间 */
    createdAt: number;
}
