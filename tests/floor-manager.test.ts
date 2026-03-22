/**
 * Phase 2.3 层级推进 — FloorManager 关键验证点测试
 *
 * 验证点：
 * 1. 层级阶段划分正确（新手/成长/挑战/Boss）
 * 2. 事件概率分布正确（按层级阶段）
 * 3. 野怪参数计算正确（属性总点、卡组大小、遗物规则、野怪类型）
 * 4. 精英参数 = 当前层 +2 的野怪强度
 * 5. 1-2 层路线锁定，3 层起解锁
 * 6. 赏金挑战出现概率约 10%
 * 7. 金币奖励计算（含精英 ×1.5 倍率）
 */
import { describe, it, expect } from 'vitest';
import { FloorManager, FloorTier } from '../game/assets/scripts/core/run/FloorManager';
import { EventCategory, MonsterType } from '../game/assets/scripts/types/Enums';
import { SeededRandom } from '../game/assets/scripts/core/utils/SeededRandom';

describe('FloorManager — 层级阶段划分', () => {
    it('1-3 层为新手区', () => {
        expect(FloorManager.getTier(1)).toBe(FloorTier.NOVICE);
        expect(FloorManager.getTier(2)).toBe(FloorTier.NOVICE);
        expect(FloorManager.getTier(3)).toBe(FloorTier.NOVICE);
    });

    it('4-6 层为成长区', () => {
        expect(FloorManager.getTier(4)).toBe(FloorTier.GROWTH);
        expect(FloorManager.getTier(5)).toBe(FloorTier.GROWTH);
        expect(FloorManager.getTier(6)).toBe(FloorTier.GROWTH);
    });

    it('7-9 层为挑战区', () => {
        expect(FloorManager.getTier(7)).toBe(FloorTier.CHALLENGE);
        expect(FloorManager.getTier(8)).toBe(FloorTier.CHALLENGE);
        expect(FloorManager.getTier(9)).toBe(FloorTier.CHALLENGE);
    });

    it('第 10 层为 Boss 层', () => {
        expect(FloorManager.getTier(10)).toBe(FloorTier.BOSS);
        expect(FloorManager.isBossFloor(10)).toBe(true);
        expect(FloorManager.isBossFloor(9)).toBe(false);
    });
});

describe('FloorManager — 事件概率分布', () => {
    it('1-3 层概率：正面 50% / 中性 30% / 负面 20%', () => {
        const dist = FloorManager.getEventProbability(1);
        expect(dist[EventCategory.POSITIVE]).toBe(0.50);
        expect(dist[EventCategory.NEUTRAL]).toBe(0.30);
        expect(dist[EventCategory.NEGATIVE]).toBe(0.20);
    });

    it('4-6 层概率：正面 35% / 中性 35% / 负面 30%', () => {
        const dist = FloorManager.getEventProbability(5);
        expect(dist[EventCategory.POSITIVE]).toBe(0.35);
        expect(dist[EventCategory.NEUTRAL]).toBe(0.35);
        expect(dist[EventCategory.NEGATIVE]).toBe(0.30);
    });

    it('7-9 层概率：正面 20% / 中性 35% / 负面 45%', () => {
        const dist = FloorManager.getEventProbability(8);
        expect(dist[EventCategory.POSITIVE]).toBe(0.20);
        expect(dist[EventCategory.NEUTRAL]).toBe(0.35);
        expect(dist[EventCategory.NEGATIVE]).toBe(0.45);
    });

    it('大量抽样下各类型事件占比符合概率（±3% 误差）', () => {
        const SAMPLES = 10000;
        const rng = new SeededRandom(12345);
        const counts = {
            [EventCategory.POSITIVE]: 0,
            [EventCategory.NEUTRAL]: 0,
            [EventCategory.NEGATIVE]: 0,
        };

        for (let i = 0; i < SAMPLES; i++) {
            const cat = FloorManager.rollEventCategory(2, rng);
            counts[cat]++;
        }

        // 1-3 层：正面 50% / 中性 30% / 负面 20%
        expect(counts[EventCategory.POSITIVE] / SAMPLES).toBeCloseTo(0.50, 1);
        expect(counts[EventCategory.NEUTRAL] / SAMPLES).toBeCloseTo(0.30, 1);
        expect(counts[EventCategory.NEGATIVE] / SAMPLES).toBeCloseTo(0.20, 1);

        expect(Math.abs(counts[EventCategory.POSITIVE] / SAMPLES - 0.50)).toBeLessThan(0.03);
        expect(Math.abs(counts[EventCategory.NEUTRAL] / SAMPLES - 0.30)).toBeLessThan(0.03);
        expect(Math.abs(counts[EventCategory.NEGATIVE] / SAMPLES - 0.20)).toBeLessThan(0.03);
    });

    it('7-9 层大量抽样符合预期概率', () => {
        const SAMPLES = 10000;
        const rng = new SeededRandom(67890);
        const counts = {
            [EventCategory.POSITIVE]: 0,
            [EventCategory.NEUTRAL]: 0,
            [EventCategory.NEGATIVE]: 0,
        };

        for (let i = 0; i < SAMPLES; i++) {
            counts[FloorManager.rollEventCategory(8, rng)]++;
        }

        expect(Math.abs(counts[EventCategory.POSITIVE] / SAMPLES - 0.20)).toBeLessThan(0.03);
        expect(Math.abs(counts[EventCategory.NEUTRAL] / SAMPLES - 0.35)).toBeLessThan(0.03);
        expect(Math.abs(counts[EventCategory.NEGATIVE] / SAMPLES - 0.45)).toBeLessThan(0.03);
    });
});

describe('FloorManager — 野怪生成参数', () => {
    it('属性总点数 = 25 + 层数 × 3', () => {
        expect(FloorManager.getMonsterParams(1).attributeTotal).toBe(28);
        expect(FloorManager.getMonsterParams(5).attributeTotal).toBe(40);
        expect(FloorManager.getMonsterParams(10).attributeTotal).toBe(55);
    });

    it('卡组大小 = 3 + 层数', () => {
        expect(FloorManager.getMonsterParams(1).deckSize).toBe(4);
        expect(FloorManager.getMonsterParams(5).deckSize).toBe(8);
        expect(FloorManager.getMonsterParams(10).deckSize).toBe(13);
    });

    it('1-3 层野怪无遗物', () => {
        expect(FloorManager.getMonsterParams(1).relicRange).toEqual([0, 0]);
        expect(FloorManager.getMonsterParams(3).relicRange).toEqual([0, 0]);
    });

    it('4-6 层野怪携带 1 个普通遗物', () => {
        expect(FloorManager.getMonsterParams(4).relicRange).toEqual([1, 1]);
        expect(FloorManager.getMonsterParams(6).relicRange).toEqual([1, 1]);
    });

    it('7-9 层野怪携带 1-2 个遗物', () => {
        expect(FloorManager.getMonsterParams(7).relicRange).toEqual([1, 2]);
        expect(FloorManager.getMonsterParams(9).relicRange).toEqual([1, 2]);
    });

    it('流派野怪 3 层起出现', () => {
        expect(FloorManager.getMonsterParams(2).allowedTypes).not.toContain(MonsterType.FACTION);
        expect(FloorManager.getMonsterParams(3).allowedTypes).toContain(MonsterType.FACTION);
    });

    it('精英野怪 6 层起出现', () => {
        expect(FloorManager.getMonsterParams(5).allowedTypes).not.toContain(MonsterType.ELITE);
        expect(FloorManager.getMonsterParams(6).allowedTypes).toContain(MonsterType.ELITE);
    });
});

describe('FloorManager — 精英战斗参数', () => {
    it('精英等效层数 = 当前层 + 2', () => {
        expect(FloorManager.getEliteParams(4).effectiveFloor).toBe(6);
        expect(FloorManager.getEliteParams(3).effectiveFloor).toBe(5);
    });

    it('精英属性按等效层数计算', () => {
        const params = FloorManager.getEliteParams(4);
        // 等效第 6 层：25 + 6×3 = 43
        expect(params.attributeTotal).toBe(43);
        // 卡组：3 + 6 = 9
        expect(params.deckSize).toBe(9);
    });

    it('精英等效层数不超过 10', () => {
        expect(FloorManager.getEliteParams(9).effectiveFloor).toBe(10);
        expect(FloorManager.getEliteParams(10).effectiveFloor).toBe(10);
    });
});

describe('FloorManager — 路线选择可用性', () => {
    it('1-2 层路线锁定为普通战斗', () => {
        expect(FloorManager.isRouteChoiceLocked(1)).toBe(true);
        expect(FloorManager.isRouteChoiceLocked(2)).toBe(true);
    });

    it('3 层起解锁三选一', () => {
        expect(FloorManager.isRouteChoiceLocked(3)).toBe(false);
        expect(FloorManager.isRouteChoiceLocked(5)).toBe(false);
    });
});

describe('FloorManager — 赏金挑战', () => {
    it('赏金挑战出现概率约 10%（大量抽样）', () => {
        const SAMPLES = 10000;
        const rng = new SeededRandom(99999);
        let bountyCount = 0;

        for (let i = 0; i < SAMPLES; i++) {
            if (FloorManager.rollBountyChallenge(rng)) bountyCount++;
        }

        const ratio = bountyCount / SAMPLES;
        expect(Math.abs(ratio - 0.10)).toBeLessThan(0.03);
    });
});

describe('FloorManager — 金币奖励', () => {
    it('精英路线金币 = 基础 ×1.5', () => {
        const normalGold = FloorManager.calcBattleGold(5, false);
        const eliteGold = FloorManager.calcBattleGold(5, true);
        expect(eliteGold).toBe(Math.round(normalGold * 1.5));
    });

    it('层数越高金币越多', () => {
        expect(FloorManager.calcBattleGold(1, false)).toBeLessThan(
            FloorManager.calcBattleGold(5, false),
        );
        expect(FloorManager.calcBattleGold(5, false)).toBeLessThan(
            FloorManager.calcBattleGold(9, false),
        );
    });
});

describe('FloorManager — Boss 层', () => {
    it('Boss 层 HP 倍率 = 1.5', () => {
        expect(FloorManager.bossHpMultiplier).toBe(1.5);
    });

    it('最大层数 = 10', () => {
        expect(FloorManager.maxFloor).toBe(10);
    });

    it('7 层以上有高品质掉率加成', () => {
        expect(FloorManager.hasHighRarityBonus(6)).toBe(false);
        expect(FloorManager.hasHighRarityBonus(7)).toBe(true);
    });
});
