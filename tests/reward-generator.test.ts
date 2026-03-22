/**
 * Phase 2.9 卡牌奖励生成 — RewardGenerator 关键验证点测试
 *
 * 验证点（对应 plan.md §2.9）：
 * 1. 战斗胜利后生成 3 张候选卡牌供玩家三选一
 * 2. 候选卡牌全部来自流派池内 + 通用，不出现池外卡
 * 3. 精英路线必出稀有及以上品质卡牌
 * 4. 品质掉落概率正确（55%/30%/12%/3%），7层+紫金各+5%
 * 5. 3 张候选不重复
 * 6. 种子确定性
 * 7. 卡池不足时优雅降级
 */
import { describe, it, expect } from 'vitest';
import { RewardGenerator } from '../game/assets/scripts/core/card/RewardGenerator';
import { FactionPool } from '../game/assets/scripts/core/faction/FactionPool';
import { SeededRandom } from '../game/assets/scripts/core/utils/SeededRandom';
import { CardDef } from '../game/assets/scripts/types/CardTypes';
import {
    Faction, CardRarity, CardType, EffectTarget,
} from '../game/assets/scripts/types/Enums';

// ─── 测试用卡牌数据 ──────────────────────────────────────

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

const TEST_CARDS: CardDef[] = [
    // 通用 —— 各品质
    makeCard({ id: 'c_slash', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'c_guard', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'c_heal', faction: Faction.COMMON, rarity: CardRarity.RARE }),
    makeCard({ id: 'c_power', faction: Faction.COMMON, rarity: CardRarity.EPIC }),
    makeCard({ id: 'c_legend', faction: Faction.COMMON, rarity: CardRarity.LEGENDARY }),

    // 冰系
    makeCard({ id: 'ice_bolt', faction: Faction.ICE, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'ice_blizzard', faction: Faction.ICE, rarity: CardRarity.RARE }),
    makeCard({ id: 'ice_nova', faction: Faction.ICE, rarity: CardRarity.EPIC }),
    makeCard({ id: 'ice_absolute_zero', faction: Faction.ICE, rarity: CardRarity.LEGENDARY }),

    // 火系
    makeCard({ id: 'fire_strike', faction: Faction.FIRE, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'fire_inferno', faction: Faction.FIRE, rarity: CardRarity.RARE }),
    makeCard({ id: 'fire_meteor', faction: Faction.FIRE, rarity: CardRarity.EPIC }),

    // 毒系（不在流派池中，不应出现）
    makeCard({ id: 'poison_dart', faction: Faction.POISON, rarity: CardRarity.NORMAL }),
    makeCard({ id: 'poison_cloud', faction: Faction.POISON, rarity: CardRarity.RARE }),

    // 不可掉落的卡
    makeCard({ id: 'starter_only', faction: Faction.COMMON, rarity: CardRarity.NORMAL, starterOnly: true }),
    makeCard({ id: 'no_drop', faction: Faction.COMMON, rarity: CardRarity.NORMAL, droppable: false }),
];

const ICE_FIRE_POOL = new FactionPool([Faction.ICE, Faction.FIRE]);

// ─── 基本生成测试 ─────────────────────────────────────

describe('RewardGenerator — 基本生成', () => {

    it('生成 3 张候选卡牌', () => {
        const rng = new SeededRandom(42);
        const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, rng);
        expect(result.length).toBe(3);
    });

    it('候选卡牌不重复', () => {
        for (let seed = 0; seed < 100; seed++) {
            const rng = new SeededRandom(seed);
            const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, rng);
            const ids = result.map(c => c.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it('全部来自流派池内 + 通用，不出现池外卡', () => {
        const allowed = new Set([Faction.ICE, Faction.FIRE, Faction.COMMON]);
        for (let seed = 0; seed < 200; seed++) {
            const rng = new SeededRandom(seed);
            const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, rng);
            for (const card of result) {
                expect(allowed.has(card.faction)).toBe(true);
            }
        }
    });

    it('不包含 starterOnly 或 droppable=false 的卡', () => {
        for (let seed = 0; seed < 100; seed++) {
            const rng = new SeededRandom(seed);
            const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, rng);
            for (const card of result) {
                expect(card.starterOnly).toBe(false);
                expect(card.droppable).toBe(true);
            }
        }
    });

    it('不包含池外流派（毒系）的卡', () => {
        for (let seed = 0; seed < 100; seed++) {
            const rng = new SeededRandom(seed);
            const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, rng);
            for (const card of result) {
                expect(card.faction).not.toBe(Faction.POISON);
            }
        }
    });
});

// ─── 精英路线 ──────────────────────────────────────────

describe('RewardGenerator — 精英路线', () => {

    it('精英路线必出稀有及以上品质', () => {
        for (let seed = 0; seed < 200; seed++) {
            const rng = new SeededRandom(seed);
            const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, true, rng);
            for (const card of result) {
                expect([CardRarity.RARE, CardRarity.EPIC, CardRarity.LEGENDARY]).toContain(card.rarity);
            }
        }
    });

    it('精英品质权重无 NORMAL', () => {
        const weights = RewardGenerator.buildRarityWeights(5, true);
        const normalWeight = weights.find(w => w.rarity === CardRarity.NORMAL);
        expect(normalWeight).toBeUndefined();
    });

    it('精英品质权重总和 ≈ 1', () => {
        const weights = RewardGenerator.buildRarityWeights(5, true);
        const total = weights.reduce((s, w) => s + w.weight, 0);
        expect(total).toBeCloseTo(1.0, 5);
    });
});

// ─── 品质概率分布 ──────────────────────────────────────

describe('RewardGenerator — 品质概率分布', () => {

    it('基础概率分布正确（NORMAL ~55%，RARE ~30%，EPIC ~12%，LEGENDARY ~3%）', () => {
        const weights = RewardGenerator.buildRarityWeights(3, false);
        const rng = new SeededRandom(12345);
        const counts: Record<CardRarity, number> = {
            [CardRarity.NORMAL]: 0,
            [CardRarity.RARE]: 0,
            [CardRarity.EPIC]: 0,
            [CardRarity.LEGENDARY]: 0,
        };
        const total = 10000;

        for (let i = 0; i < total; i++) {
            counts[RewardGenerator.rollRarity(weights, rng)]++;
        }

        expect(counts[CardRarity.NORMAL] / total).toBeCloseTo(0.55, 1);
        expect(counts[CardRarity.RARE] / total).toBeCloseTo(0.30, 1);
        expect(counts[CardRarity.EPIC] / total).toBeCloseTo(0.12, 1);
        expect(counts[CardRarity.LEGENDARY] / total).toBeCloseTo(0.03, 1);
    });

    it('7 层以上紫/金各 +5%（EPIC ~17%，LEGENDARY ~8%，NORMAL ~45%）', () => {
        const weights = RewardGenerator.buildRarityWeights(8, false);

        const normalW = weights.find(w => w.rarity === CardRarity.NORMAL)!;
        const epicW = weights.find(w => w.rarity === CardRarity.EPIC)!;
        const legendW = weights.find(w => w.rarity === CardRarity.LEGENDARY)!;

        expect(normalW.weight).toBeCloseTo(0.45, 5);
        expect(epicW.weight).toBeCloseTo(0.17, 5);
        expect(legendW.weight).toBeCloseTo(0.08, 5);
    });

    it('7 层以上掷骰验证（EPIC + LEGENDARY 占比 > 基础）', () => {
        const weights = RewardGenerator.buildRarityWeights(8, false);
        const rng = new SeededRandom(99999);
        let highRarity = 0;
        const total = 5000;

        for (let i = 0; i < total; i++) {
            const r = RewardGenerator.rollRarity(weights, rng);
            if (r === CardRarity.EPIC || r === CardRarity.LEGENDARY) highRarity++;
        }

        expect(highRarity / total).toBeGreaterThan(0.20);
    });

    it('精英 + 7 层以上的组合权重正确', () => {
        const weights = RewardGenerator.buildRarityWeights(8, true);

        expect(weights.find(w => w.rarity === CardRarity.NORMAL)).toBeUndefined();

        const total = weights.reduce((s, w) => s + w.weight, 0);
        expect(total).toBeCloseTo(1.0, 5);

        const legendW = weights.find(w => w.rarity === CardRarity.LEGENDARY)!;
        expect(legendW.weight).toBeGreaterThan(0.10);
    });
});

// ─── 品质降级 ──────────────────────────────────────────

describe('RewardGenerator — 品质降级', () => {

    it('卡池无传说卡时，掷出传说会降级到较低品质', () => {
        const noLegendCards = TEST_CARDS.filter(c =>
            c.rarity !== CardRarity.LEGENDARY && c.faction !== Faction.POISON,
        );
        let hadLegendRoll = false;

        for (let seed = 0; seed < 500; seed++) {
            const rng = new SeededRandom(seed);
            const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, noLegendCards, 5, false, rng);
            for (const c of result) {
                expect(c.rarity).not.toBe(CardRarity.LEGENDARY);
            }
            if (result.length > 0) hadLegendRoll = true;
        }
        expect(hadLegendRoll).toBe(true);
    });

    it('仅有 NORMAL 卡时，精英路线仍能返回（降级兜底）', () => {
        const onlyNormal = [
            makeCard({ id: 'n1', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
            makeCard({ id: 'n2', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
            makeCard({ id: 'n3', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
        ];
        const rng = new SeededRandom(42);
        const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, onlyNormal, 5, true, rng);
        // 精英筛选时 filterAvailableCards 无 minRarity，品质降级发生在 _pickCardByRarity
        // 掷出 RARE 但池中只有 NORMAL，向上搜索无果后降级到 NORMAL
        expect(result.length).toBeGreaterThan(0);
    });
});

// ─── 边界情况 ──────────────────────────────────────────

describe('RewardGenerator — 边界情况', () => {

    it('空卡池返回空列表', () => {
        const rng = new SeededRandom(42);
        const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, [], 5, false, rng);
        expect(result).toEqual([]);
    });

    it('可用卡不足 3 张时返回全部可用', () => {
        const twoCards = [
            makeCard({ id: 'a', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
            makeCard({ id: 'b', faction: Faction.COMMON, rarity: CardRarity.RARE }),
        ];
        const rng = new SeededRandom(42);
        const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, twoCards, 5, false, rng);
        expect(result.length).toBe(2);
    });

    it('仅 1 张可用卡时返回 1 张', () => {
        const oneCard = [
            makeCard({ id: 'solo', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
        ];
        const rng = new SeededRandom(42);
        const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, oneCard, 5, false, rng);
        expect(result.length).toBe(1);
    });

    it('floorMin/floorMax 过滤生效', () => {
        const cards = [
            makeCard({ id: 'early', faction: Faction.COMMON, rarity: CardRarity.NORMAL, floorMin: 1, floorMax: 3 }),
            makeCard({ id: 'late', faction: Faction.COMMON, rarity: CardRarity.NORMAL, floorMin: 7, floorMax: 10 }),
            makeCard({ id: 'mid', faction: Faction.COMMON, rarity: CardRarity.NORMAL, floorMin: 4, floorMax: 6 }),
        ];
        const rng = new SeededRandom(42);
        const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, cards, 5, false, rng);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('mid');
    });
});

// ─── 种子确定性 ──────────────────────────────────────────

describe('RewardGenerator — 种子确定性', () => {

    it('相同种子生成相同的奖励', () => {
        const r1 = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, new SeededRandom(777));
        const r2 = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, new SeededRandom(777));
        expect(r1.map(c => c.id)).toEqual(r2.map(c => c.id));
    });

    it('不同种子生成不同的奖励（至少部分不同）', () => {
        let differ = false;
        for (let s = 0; s < 20; s++) {
            const a = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, new SeededRandom(s));
            const b = RewardGenerator.generateCardReward(ICE_FIRE_POOL, TEST_CARDS, 5, false, new SeededRandom(s + 1000));
            if (a[0]?.id !== b[0]?.id) { differ = true; break; }
        }
        expect(differ).toBe(true);
    });
});

// ─── dropWeight 权重生效 ────────────────────────────────

describe('RewardGenerator — dropWeight 权重', () => {

    it('高权重卡牌作为首选出现概率更高', () => {
        const weightedCards = [
            makeCard({ id: 'heavy', faction: Faction.COMMON, rarity: CardRarity.NORMAL, dropWeight: 10.0 }),
            makeCard({ id: 'light1', faction: Faction.COMMON, rarity: CardRarity.NORMAL, dropWeight: 0.1 }),
            makeCard({ id: 'light2', faction: Faction.COMMON, rarity: CardRarity.NORMAL, dropWeight: 0.1 }),
            makeCard({ id: 'light3', faction: Faction.COMMON, rarity: CardRarity.NORMAL, dropWeight: 0.1 }),
            makeCard({ id: 'filler1', faction: Faction.COMMON, rarity: CardRarity.RARE }),
            makeCard({ id: 'filler2', faction: Faction.COMMON, rarity: CardRarity.EPIC }),
        ];

        let heavyFirst = 0;
        let lightFirst = 0;
        const total = 2000;

        for (let seed = 0; seed < total; seed++) {
            const rng = new SeededRandom(seed);
            const result = RewardGenerator.generateCardReward(ICE_FIRE_POOL, weightedCards, 1, false, rng);
            if (result.length > 0 && result[0].rarity === CardRarity.NORMAL) {
                if (result[0].id === 'heavy') heavyFirst++;
                else lightFirst++;
            }
        }

        expect(heavyFirst).toBeGreaterThan(lightFirst * 3);
    });
});
