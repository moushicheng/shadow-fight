/**
 * Phase 2.10 战斗奖励结算 — RewardSettlement 关键验证点测试
 *
 * 验证点（对应 plan.md §2.10）：
 * 1. 普通战斗给予标准金币奖励
 * 2. 精英路线金币奖励 = 标准 × 1.5
 * 3. 高星残影金币奖励 +30%，遗物掉落概率 +10%
 * 4. 每场战斗胜利有 20% 概率额外掉落遗物（3 选 1）
 * 5. 获取的卡牌/遗物正确写入 RunState
 * 6. 赏金挑战额外遗物
 * 7. 战斗统计正确更新
 * 8. 种子确定性
 */
import { describe, it, expect } from 'vitest';
import { RewardSettlement, BattleContext, BattleReward } from '../game/assets/scripts/core/run/RewardSettlement';
import { RewardGenerator } from '../game/assets/scripts/core/card/RewardGenerator';
import { RelicManager } from '../game/assets/scripts/core/relic/RelicManager';
import { FactionPool } from '../game/assets/scripts/core/faction/FactionPool';
import { FloorManager } from '../game/assets/scripts/core/run/FloorManager';
import { SeededRandom } from '../game/assets/scripts/core/utils/SeededRandom';
import { RunState } from '../game/assets/scripts/types/RunTypes';
import { CardDef } from '../game/assets/scripts/types/CardTypes';
import { RelicDef } from '../game/assets/scripts/types/RelicTypes';
import {
    Faction, CardRarity, CardType, EffectTarget, RunStatus,
    RelicRarity, RelicTrigger,
} from '../game/assets/scripts/types/Enums';

// ─── 测试数据工厂 ────────────────────────────────────────

function makeCard(overrides: Partial<CardDef> & { id: string; faction: Faction; rarity: CardRarity }): CardDef {
    return {
        name: overrides.id,
        description: '',
        cardType: CardType.ATTACK,
        tags: [],
        manaCost: 1,
        effects: [{ target: EffectTarget.ENEMY }],
        floorMin: 1,
        floorMax: 10,
        dropWeight: 1.0,
        droppable: true,
        buyable: true,
        eventObtainable: true,
        starterOnly: false,
        upgrade: { name: `${overrides.id}+`, costReduction: 1, enhancedDescription: '', enhancedEffects: [] },
        ...overrides,
    };
}

function makeRelic(overrides: Partial<RelicDef> & { id: string }): RelicDef {
    return {
        name: overrides.id,
        description: '',
        rarity: RelicRarity.NORMAL,
        trigger: RelicTrigger.PASSIVE,
        effect: { type: 'test', params: {} },
        shopPrice: { min: 100, max: 200 },
        floorMin: 1,
        ...overrides,
    };
}

const TEST_CARDS: CardDef[] = [
    makeCard({ id: 'c_slash', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'c_guard', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'c_heal', faction: Faction.COMMON, rarity: CardRarity.RARE }),
    makeCard({ id: 'c_power', faction: Faction.COMMON, rarity: CardRarity.EPIC }),
    makeCard({ id: 'ice_bolt', faction: Faction.ICE, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'ice_blizzard', faction: Faction.ICE, rarity: CardRarity.RARE }),
    makeCard({ id: 'fire_strike', faction: Faction.FIRE, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'fire_inferno', faction: Faction.FIRE, rarity: CardRarity.RARE }),
];

const TEST_RELICS: RelicDef[] = [
    makeRelic({ id: 'relic_a', rarity: RelicRarity.NORMAL }),
    makeRelic({ id: 'relic_b', rarity: RelicRarity.NORMAL }),
    makeRelic({ id: 'relic_c', rarity: RelicRarity.RARE }),
    makeRelic({ id: 'relic_d', rarity: RelicRarity.RARE }),
    makeRelic({ id: 'relic_e', rarity: RelicRarity.LEGENDARY }),
];

const ICE_FIRE_POOL = new FactionPool([Faction.ICE, Faction.FIRE]);
const RELIC_MGR = new RelicManager(TEST_RELICS);

function createRunState(overrides: Partial<RunState> = {}): RunState {
    return {
        seed: 42,
        baseProperty: { STR: 10, CON: 10, SPD: 10, MANA: 10 },
        currentHp: 180, maxHp: 180,
        deck: [
            { defId: 'c_slash', upgraded: false },
            { defId: 'c_guard', upgraded: false },
        ],
        relics: [],
        factionPool: [Faction.ICE, Faction.FIRE],
        hearts: 5, gold: 0,
        currentFloor: 5, currentCycle: 1,
        currentNode: 'monster_battle' as any, nodeIndex: 1,
        rerollUsed: false, serviceUseCount: 0,
        runStatus: RunStatus.ONGOING,
        tempBuffs: [], encounteredGhosts: [],
        stats: {
            monstersDefeated: 0, ghostsDefeated: 0,
            cardsObtained: 0, cardsRemoved: 0,
            goldEarned: 0, goldSpent: 0,
            damageDealt: 0, damageTaken: 0,
            highestFloor: 5,
        },
        ...overrides,
    };
}

function normalContext(floor = 5): BattleContext {
    return { floor, isElite: false, isBounty: false, isGhostBattle: false, isHighStarGhost: false };
}

function eliteContext(floor = 5): BattleContext {
    return { floor, isElite: true, isBounty: false, isGhostBattle: false, isHighStarGhost: false };
}

function bountyContext(floor = 5): BattleContext {
    return { floor, isElite: true, isBounty: true, isGhostBattle: false, isHighStarGhost: false };
}

function ghostContext(floor = 5, highStar = false): BattleContext {
    return { floor, isElite: false, isBounty: false, isGhostBattle: true, isHighStarGhost: highStar };
}

// ─── 金币奖励 ──────────────────────────────────────────

describe('RewardSettlement — 金币奖励', () => {

    it('普通战斗给予标准金币', () => {
        const gold = RewardSettlement.calcGoldReward(normalContext(5));
        const expected = FloorManager.getRewardConfig(5).baseGold;
        expect(gold).toBe(expected);
    });

    it('精英路线金币 = 标准 × 1.5', () => {
        const normalGold = RewardSettlement.calcGoldReward(normalContext(5));
        const eliteGold = RewardSettlement.calcGoldReward(eliteContext(5));
        expect(eliteGold).toBe(Math.round(normalGold * 1.5));
    });

    it('赏金挑战金币与精英相同（×1.5）', () => {
        const eliteGold = RewardSettlement.calcGoldReward(eliteContext(5));
        const bountyGold = RewardSettlement.calcGoldReward(bountyContext(5));
        expect(bountyGold).toBe(eliteGold);
    });

    it('高星残影金币 +30%', () => {
        const normalGold = RewardSettlement.calcGoldReward(normalContext(5));
        const highStarGold = RewardSettlement.calcGoldReward(ghostContext(5, true));
        expect(highStarGold).toBe(Math.round(normalGold * 1.3));
    });

    it('各层金币递增', () => {
        let prevGold = 0;
        for (let floor = 1; floor <= 10; floor++) {
            const gold = RewardSettlement.calcGoldReward(normalContext(floor));
            expect(gold).toBeGreaterThanOrEqual(prevGold);
            prevGold = gold;
        }
    });

    it('金币自动入账 RunState', () => {
        const run = createRunState();
        const rng = new SeededRandom(42);
        const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);

        expect(run.gold).toBe(reward.gold);
        expect(run.stats.goldEarned).toBe(reward.gold);
    });
});

// ─── 卡牌奖励 ──────────────────────────────────────────

describe('RewardSettlement — 卡牌奖励', () => {

    it('生成 3 张候选卡牌', () => {
        const run = createRunState();
        const rng = new SeededRandom(42);
        const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);

        expect(reward.cardChoices.length).toBe(3);
    });

    it('精英路线候选全部稀有及以上', () => {
        for (let seed = 0; seed < 50; seed++) {
            const run = createRunState();
            const rng = new SeededRandom(seed);
            const reward = RewardSettlement.generateReward(run, eliteContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);
            for (const c of reward.cardChoices) {
                expect([CardRarity.RARE, CardRarity.EPIC, CardRarity.LEGENDARY]).toContain(c.rarity);
            }
        }
    });

    it('applyCardChoice 将卡牌加入卡组末尾', () => {
        const run = createRunState();
        const rng = new SeededRandom(42);
        const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);
        const card = reward.cardChoices[0];
        const deckBefore = run.deck.length;

        RewardSettlement.applyCardChoice(run, card);

        expect(run.deck.length).toBe(deckBefore + 1);
        expect(run.deck[run.deck.length - 1].defId).toBe(card.id);
        expect(run.deck[run.deck.length - 1].upgraded).toBe(false);
        expect(run.stats.cardsObtained).toBe(1);
    });

    it('skipCardChoice 不影响卡组', () => {
        const run = createRunState();
        const deckBefore = run.deck.length;
        RewardSettlement.skipCardChoice();
        expect(run.deck.length).toBe(deckBefore);
    });
});

// ─── 遗物掉落 ──────────────────────────────────────────

describe('RewardSettlement — 遗物掉落', () => {

    it('遗物掉落 ~20%（大量抽样，±8% 误差）', () => {
        let drops = 0;
        const total = 1000;
        for (let seed = 0; seed < total; seed++) {
            const run = createRunState();
            const rng = new SeededRandom(seed);
            const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);
            if (reward.relicChoices.length > 0) drops++;
        }
        const rate = drops / total;
        expect(rate).toBeGreaterThan(0.12);
        expect(rate).toBeLessThan(0.28);
    });

    it('遗物掉落时提供 3 选 1 候选', () => {
        for (let seed = 0; seed < 500; seed++) {
            const run = createRunState();
            const rng = new SeededRandom(seed);
            const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);
            if (reward.relicChoices.length > 0) {
                expect(reward.relicChoices.length).toBeLessThanOrEqual(3);
                expect(reward.relicChoices.length).toBeGreaterThan(0);
                return;
            }
        }
        throw new Error('No relic drop in 500 seeds');
    });

    it('applyRelicChoice 将遗物加入 RunState', () => {
        const run = createRunState();

        const result = RewardSettlement.applyRelicChoice(run, 'relic_a');

        expect(result).toBe(true);
        expect(run.relics).toContain('relic_a');
    });

    it('applyRelicChoice 不重复添加', () => {
        const run = createRunState({ relics: ['relic_a'] });

        const result = RewardSettlement.applyRelicChoice(run, 'relic_a');

        expect(result).toBe(false);
        expect(run.relics.filter(r => r === 'relic_a').length).toBe(1);
    });

    it('高星残影遗物掉率更高', () => {
        let normalDrops = 0;
        let highStarDrops = 0;
        const total = 2000;

        for (let seed = 0; seed < total; seed++) {
            const rng1 = new SeededRandom(seed);
            const run1 = createRunState();
            const r1 = RewardSettlement.generateReward(run1, ghostContext(5, false), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng1);
            if (r1.relicChoices.length > 0) normalDrops++;

            const rng2 = new SeededRandom(seed);
            const run2 = createRunState();
            const r2 = RewardSettlement.generateReward(run2, ghostContext(5, true), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng2);
            if (r2.relicChoices.length > 0) highStarDrops++;
        }

        expect(highStarDrops).toBeGreaterThan(normalDrops);
    });
});

// ─── 赏金额外遗物 ────────────────────────────────────

describe('RewardSettlement — 赏金额外遗物', () => {

    it('赏金挑战必有额外遗物候选', () => {
        const run = createRunState();
        const rng = new SeededRandom(42);
        const reward = RewardSettlement.generateReward(run, bountyContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);

        expect(reward.bountyRelicChoices.length).toBeGreaterThan(0);
        expect(reward.bountyRelicChoices.length).toBeLessThanOrEqual(3);
    });

    it('非赏金挑战无额外遗物', () => {
        const run = createRunState();
        const rng = new SeededRandom(42);
        const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);

        expect(reward.bountyRelicChoices.length).toBe(0);
    });

    it('赏金额外遗物可独立于普通遗物掉落', () => {
        let hasBoth = false;
        for (let seed = 0; seed < 500; seed++) {
            const run = createRunState();
            const rng = new SeededRandom(seed);
            const reward = RewardSettlement.generateReward(run, bountyContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);
            if (reward.relicChoices.length > 0 && reward.bountyRelicChoices.length > 0) {
                hasBoth = true;
                break;
            }
        }
        expect(hasBoth).toBe(true);
    });
});

// ─── 战斗统计更新 ──────────────────────────────────────

describe('RewardSettlement — 战斗统计', () => {

    it('野怪战斗更新 monstersDefeated', () => {
        const run = createRunState();
        const rng = new SeededRandom(42);
        RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);

        expect(run.stats.monstersDefeated).toBe(1);
        expect(run.stats.ghostsDefeated).toBe(0);
    });

    it('残影战斗更新 ghostsDefeated', () => {
        const run = createRunState();
        const rng = new SeededRandom(42);
        RewardSettlement.generateReward(run, ghostContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);

        expect(run.stats.ghostsDefeated).toBe(1);
        expect(run.stats.monstersDefeated).toBe(0);
    });

    it('多次战斗累计统计', () => {
        const run = createRunState();
        for (let i = 0; i < 3; i++) {
            RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, new SeededRandom(i));
        }
        RewardSettlement.generateReward(run, ghostContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, new SeededRandom(99));

        expect(run.stats.monstersDefeated).toBe(3);
        expect(run.stats.ghostsDefeated).toBe(1);
        expect(run.stats.goldEarned).toBeGreaterThan(0);
    });
});

// ─── 完整流程 ──────────────────────────────────────────

describe('RewardSettlement — 完整流程', () => {

    it('普通战斗完整流程：金币入账 → 选卡 → 选遗物', () => {
        let completedOnce = false;
        for (let seed = 0; seed < 500 && !completedOnce; seed++) {
            const run = createRunState();
            const rng = new SeededRandom(seed);
            const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);

            expect(run.gold).toBe(reward.gold);

            if (reward.cardChoices.length > 0) {
                RewardSettlement.applyCardChoice(run, reward.cardChoices[0]);
                expect(run.deck[run.deck.length - 1].defId).toBe(reward.cardChoices[0].id);
            }

            if (reward.relicChoices.length > 0) {
                RewardSettlement.applyRelicChoice(run, reward.relicChoices[0].id);
                expect(run.relics).toContain(reward.relicChoices[0].id);
                completedOnce = true;
            }
        }
        expect(completedOnce).toBe(true);
    });

    it('赏金挑战完整流程：金币(×1.5) → 选卡(稀有+) → 选遗物 → 选额外遗物', () => {
        let completed = false;
        for (let seed = 0; seed < 500 && !completed; seed++) {
            const run = createRunState();
            const rng = new SeededRandom(seed);
            const reward = RewardSettlement.generateReward(run, bountyContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, rng);

            const normalGold = FloorManager.getRewardConfig(5).baseGold;
            expect(reward.gold).toBe(Math.round(normalGold * 1.5));

            for (const c of reward.cardChoices) {
                expect([CardRarity.RARE, CardRarity.EPIC, CardRarity.LEGENDARY]).toContain(c.rarity);
            }

            if (reward.bountyRelicChoices.length > 0) {
                RewardSettlement.applyRelicChoice(run, reward.bountyRelicChoices[0].id);
                expect(run.relics).toContain(reward.bountyRelicChoices[0].id);
                completed = true;
            }
        }
        expect(completed).toBe(true);
    });
});

// ─── 种子确定性 ──────────────────────────────────────────

describe('RewardSettlement — 种子确定性', () => {

    it('相同种子生成相同奖励', () => {
        const run1 = createRunState();
        const r1 = RewardSettlement.generateReward(run1, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, new SeededRandom(777));

        const run2 = createRunState();
        const r2 = RewardSettlement.generateReward(run2, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, TEST_CARDS, new SeededRandom(777));

        expect(r1.gold).toBe(r2.gold);
        expect(r1.cardChoices.map(c => c.id)).toEqual(r2.cardChoices.map(c => c.id));
        expect(r1.relicChoices.map(r => r.id)).toEqual(r2.relicChoices.map(r => r.id));
    });
});

// ─── 边界情况 ──────────────────────────────────────────

describe('RewardSettlement — 边界情况', () => {

    it('空卡池不崩溃', () => {
        const run = createRunState();
        const rng = new SeededRandom(42);
        const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, RELIC_MGR, [], rng);

        expect(reward.cardChoices).toEqual([]);
        expect(run.gold).toBeGreaterThan(0);
    });

    it('空遗物池不崩溃', () => {
        const emptyRelicMgr = new RelicManager([]);
        const run = createRunState();
        const rng = new SeededRandom(42);
        const reward = RewardSettlement.generateReward(run, normalContext(5), ICE_FIRE_POOL, emptyRelicMgr, TEST_CARDS, rng);

        expect(reward.relicChoices).toEqual([]);
    });

    it('applyGoldReward 累加而非覆盖', () => {
        const run = createRunState({ gold: 100 });
        RewardSettlement.applyGoldReward(run, 50);
        expect(run.gold).toBe(150);
        expect(run.stats.goldEarned).toBe(50);

        RewardSettlement.applyGoldReward(run, 30);
        expect(run.gold).toBe(180);
        expect(run.stats.goldEarned).toBe(80);
    });
});
