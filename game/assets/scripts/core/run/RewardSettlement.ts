import { CardDef } from '../../types/CardTypes';
import { RelicDef } from '../../types/RelicTypes';
import { RunState } from '../../types/RunTypes';
import { FactionPool } from '../faction/FactionPool';
import { RewardGenerator } from '../card/RewardGenerator';
import { RelicManager } from '../relic/RelicManager';
import { FloorManager } from './FloorManager';
import { SeededRandom } from '../utils/SeededRandom';

/** 奖励选项数量 */
const CARD_CHOICE_COUNT = 3;
const RELIC_CHOICE_COUNT = 3;

// ─── 战斗上下文 ──────────────────────────────────────────

/** 战斗结算所需的上下文信息 */
export interface BattleContext {
    /** 当前层 */
    floor: number;
    /** 是否精英路线 */
    isElite: boolean;
    /** 是否赏金挑战 */
    isBounty: boolean;
    /** 是否残影战斗 */
    isGhostBattle: boolean;
    /** 是否高星残影（金币 +30%，遗物掉率 +10%） */
    isHighStarGhost: boolean;
}

// ─── 结算结果 ──────────────────────────────────────────

/** 战斗奖励包（生成后交给 UI 层展示） */
export interface BattleReward {
    /** 获得的金币（自动入账） */
    gold: number;
    /** 卡牌候选（3 选 1，玩家选择后调用 applyCardChoice） */
    cardChoices: CardDef[];
    /** 遗物候选（0 或 3 选 1，由掉落概率决定） */
    relicChoices: RelicDef[];
    /** 赏金额外遗物候选（仅赏金挑战胜利时有值） */
    bountyRelicChoices: RelicDef[];
}

// ─── 主类 ──────────────────────────────────────────────

/**
 * RewardSettlement —— 战斗奖励结算。
 *
 * 职责：
 * - 计算金币奖励（基础 / 精英 ×1.5 / 高星残影 +30%）
 * - 生成卡牌三选一（委托 RewardGenerator）
 * - 判定遗物掉落并生成三选一（委托 RelicManager）
 * - 赏金挑战额外遗物
 * - 将玩家选择写入 RunState（金币/卡牌/遗物/统计）
 *
 * 纯静态方法，不持有可变状态，不依赖引擎 API。
 */
export class RewardSettlement {

    // ─── 奖励生成 ──────────────────────────────────────

    /**
     * 生成完整的战斗奖励包。
     * 金币自动入账到 RunState，卡牌和遗物返回候选列表供玩家选择。
     */
    static generateReward(
        runState: RunState,
        context: BattleContext,
        factionPool: FactionPool,
        relicManager: RelicManager,
        allCards: CardDef[],
        rng: SeededRandom,
    ): BattleReward {
        const gold = RewardSettlement.calcGoldReward(context);
        RewardSettlement.applyGoldReward(runState, gold);

        const cardChoices = RewardGenerator.generateCardReward(
            factionPool, allCards, context.floor, context.isElite, rng,
        );

        let relicChoices: RelicDef[] = [];
        if (RelicManager.shouldDropRelic(rng, context.floor, context.isElite, context.isHighStarGhost)) {
            relicChoices = relicManager.generateChoices(
                context.floor, runState.relics, RELIC_CHOICE_COUNT, rng,
            );
        }

        let bountyRelicChoices: RelicDef[] = [];
        if (context.isBounty) {
            bountyRelicChoices = relicManager.generateChoices(
                context.floor, runState.relics, RELIC_CHOICE_COUNT, rng,
            );
        }

        RewardSettlement._updateBattleStats(runState, context);

        return { gold, cardChoices, relicChoices, bountyRelicChoices };
    }

    // ─── 金币计算 ──────────────────────────────────────

    /**
     * 计算金币奖励。
     * - 基础金币来自 FloorManager（按层级递增）
     * - 精英路线 ×1.5
     * - 高星残影 +30%
     */
    static calcGoldReward(context: BattleContext): number {
        const config = FloorManager.getRewardConfig(context.floor);
        let gold = config.baseGold;

        if (context.isElite || context.isBounty) {
            gold = Math.round(gold * config.eliteGoldMultiplier);
        }

        if (context.isHighStarGhost) {
            gold = Math.round(gold * (1 + config.highStarGhostGoldBonus));
        }

        return gold;
    }

    // ─── 玩家选择应用 ──────────────────────────────────

    /** 玩家选择一张卡牌奖励，加入卡组末尾 */
    static applyCardChoice(runState: RunState, card: CardDef): void {
        runState.deck.push({ defId: card.id, upgraded: false });
        runState.stats.cardsObtained += 1;
    }

    /** 玩家选择一个遗物奖励，加入遗物列表（去重） */
    static applyRelicChoice(runState: RunState, relicId: string): boolean {
        return RelicManager.acquireRelic(runState, relicId);
    }

    /** 金币入账 */
    static applyGoldReward(runState: RunState, gold: number): void {
        runState.gold += gold;
        runState.stats.goldEarned += gold;
    }

    /** 跳过卡牌选择（玩家可以选择不拿） */
    static skipCardChoice(): void {
        // no-op
    }

    /** 跳过遗物选择 */
    static skipRelicChoice(): void {
        // no-op
    }

    // ─── 私有方法 ──────────────────────────────────────

    /** 更新战斗统计 */
    private static _updateBattleStats(runState: RunState, context: BattleContext): void {
        if (context.isGhostBattle) {
            runState.stats.ghostsDefeated += 1;
        } else {
            runState.stats.monstersDefeated += 1;
        }
    }
}
