/**
 * 赛季配置。
 * 每赛季 4 周，赛季结束后重置排行榜和残影池。
 * 每赛季可引入 1 个特色规则增加新鲜感。
 */
export interface SeasonConfig {
    /** 赛季唯一 ID */
    id: string;
    /** 赛季名称 */
    name: string;
    /** 赛季持续天数（默认 28 天 = 4 周） */
    durationDays: number;
    /** 赛季特殊规则（可选） */
    rule?: SeasonRule;
    /** 开始时间戳 */
    startTime: number;
    /** 结束时间戳 */
    endTime: number;
}

/** 赛季特殊规则 */
export interface SeasonRule {
    /** 规则类型 */
    type: SeasonRuleType;
    /** 规则参数 */
    params: Record<string, unknown>;
}

/** 赛季规则类型 */
export enum SeasonRuleType {
    /** 三流派赛季 —— 流派池从 2 个扩展为 3 个 */
    THREE_FACTIONS = 'THREE_FACTIONS',
    /** 精英赛季 —— 残影 HP ×1.3 但奖励 ×1.5，野怪升级为精英 */
    ELITE_SEASON = 'ELITE_SEASON',
    /** 遗物狂欢 —— 遗物掉率翻倍 */
    RELIC_CARNIVAL = 'RELIC_CARNIVAL',
    /** 速攻赛季 —— 加时阈值从 100 周期降为 50 周期 */
    SPEED_SEASON = 'SPEED_SEASON',
}

/**
 * 排行榜条目。
 * 赛季内排行维度：最高通关层数（同层比剩余 HP）、最速通关、残影击杀榜。
 */
export interface LeaderboardEntry {
    /** 玩家唯一 ID */
    oderId: string;
    /** 玩家昵称 */
    playerName: string;
    /** 所属赛季 ID */
    seasonId: string;
    /** 通关层数 */
    clearedFloor: number;
    /** 通关时剩余 HP（同层排序用） */
    remainingHp: number;
    /** 记录时间戳 */
    timestamp: number;
}
