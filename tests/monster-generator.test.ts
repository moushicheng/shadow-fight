/**
 * Phase 2.6 野怪生成系统 — MonsterGenerator 关键验证点测试
 *
 * 设计理念：怪物由开发者精心设计（模板），MonsterGenerator 负责选择 + 缩放。
 *
 * 验证点：
 * 1. 属性缩放精确（总点 = 25 + floor × 3，比例保持）
 * 2. 精英缩放 = floor+2 等效层
 * 3. 赏金缩放 = 精英 × 1.5
 * 4. 模板过滤遵守层数范围和类型限制
 * 5. 战斗属性正确派生（maxHp/attack/baseSpeed/maxMp）
 * 6. 选择逻辑：去重、类型优先、空池兜底
 * 7. 种子确定性
 */
import { describe, it, expect } from 'vitest';
import { MonsterGenerator, MonsterInstance } from '../game/assets/scripts/core/monster/MonsterGenerator';
import { SeededRandom } from '../game/assets/scripts/core/utils/SeededRandom';
import { FloorManager } from '../game/assets/scripts/core/run/FloorManager';
import { Faction, MonsterType } from '../game/assets/scripts/types/Enums';
import { MonsterTemplate } from '../game/assets/scripts/types/MonsterTypes';

// ─── 测试用模板数据（模拟开发者设计的怪物）────────────────

const TEMPLATES: MonsterTemplate[] = [
    {
        id: 'slime', name: '史莱姆', type: MonsterType.NORMAL,
        floorMin: 1, floorMax: 5,
        baseProperty: { STR: 5, CON: 8, SPD: 4, MANA: 3 },
        deck: [
            { defId: 'common_slash', upgraded: false },
            { defId: 'common_guard', upgraded: false },
        ],
        relics: [],
        goldDrop: { min: 10, max: 20 },
    },
    {
        id: 'bat', name: '蝙蝠', type: MonsterType.NORMAL,
        floorMin: 1, floorMax: 7,
        baseProperty: { STR: 4, CON: 3, SPD: 10, MANA: 3 },
        deck: [
            { defId: 'common_slash', upgraded: false },
            { defId: 'common_quick', upgraded: false },
        ],
        relics: [],
        goldDrop: { min: 12, max: 18 },
    },
    {
        id: 'ice_wolf', name: '冰原狼', type: MonsterType.FACTION,
        faction: Faction.ICE,
        floorMin: 3, floorMax: 8,
        baseProperty: { STR: 4, CON: 5, SPD: 8, MANA: 3 },
        deck: [
            { defId: 'ice_frost_bolt', upgraded: false },
            { defId: 'ice_chill', upgraded: false },
            { defId: 'common_guard', upgraded: false },
        ],
        relics: [],
        goldDrop: { min: 15, max: 25 },
    },
    {
        id: 'fire_lizard', name: '火蜥', type: MonsterType.FACTION,
        faction: Faction.FIRE,
        floorMin: 3, floorMax: 10,
        baseProperty: { STR: 10, CON: 4, SPD: 3, MANA: 3 },
        deck: [
            { defId: 'fire_flame_strike', upgraded: false },
            { defId: 'fire_ember', upgraded: false },
        ],
        relics: [],
        goldDrop: { min: 15, max: 25 },
    },
    {
        id: 'dark_knight', name: '暗影骑士', type: MonsterType.ELITE,
        floorMin: 6, floorMax: 10,
        baseProperty: { STR: 10, CON: 8, SPD: 6, MANA: 6 },
        deck: [
            { defId: 'elite_heavy_slash', upgraded: false },
            { defId: 'elite_dark_shield', upgraded: false },
            { defId: 'common_slash', upgraded: false },
        ],
        relics: ['relic_dark_armor'],
        goldDrop: { min: 30, max: 50 },
    },
    {
        id: 'golem', name: '石像鬼', type: MonsterType.NORMAL,
        floorMin: 4, floorMax: 10,
        baseProperty: { STR: 6, CON: 12, SPD: 2, MANA: 0 },
        deck: [
            { defId: 'common_slam', upgraded: false },
            { defId: 'common_guard', upgraded: false },
        ],
        relics: [],
        goldDrop: { min: 18, max: 28 },
    },
];

// ─── 辅助函数 ──────────────────────────────────────────

function attrTotal(p: { STR: number; CON: number; SPD: number; MANA: number }): number {
    return p.STR + p.CON + p.SPD + p.MANA;
}

// ─── 属性缩放 ──────────────────────────────────────────

describe('MonsterGenerator — 属性缩放 (scaleAttributes)', () => {

    it('缩放后总点精确等于目标值', () => {
        const base = { STR: 5, CON: 8, SPD: 4, MANA: 3 };
        for (let target = 20; target <= 60; target++) {
            const scaled = MonsterGenerator.scaleAttributes(base, target);
            expect(attrTotal(scaled)).toBe(target);
        }
    });

    it('保持原始属性比例（近似）', () => {
        const base = { STR: 10, CON: 5, SPD: 3, MANA: 2 }; // STR 最高
        const scaled = MonsterGenerator.scaleAttributes(base, 60);
        expect(scaled.STR).toBeGreaterThan(scaled.CON);
        expect(scaled.CON).toBeGreaterThan(scaled.SPD);
    });

    it('SPD 保底 >= 1', () => {
        const base = { STR: 10, CON: 10, SPD: 1, MANA: 10 };
        const scaled = MonsterGenerator.scaleAttributes(base, 10);
        expect(scaled.SPD).toBeGreaterThanOrEqual(1);
    });

    it('所有属性 >= 0', () => {
        const base = { STR: 5, CON: 8, SPD: 4, MANA: 3 };
        for (let target = 5; target <= 80; target++) {
            const scaled = MonsterGenerator.scaleAttributes(base, target);
            expect(scaled.STR).toBeGreaterThanOrEqual(0);
            expect(scaled.CON).toBeGreaterThanOrEqual(0);
            expect(scaled.SPD).toBeGreaterThanOrEqual(1);
            expect(scaled.MANA).toBeGreaterThanOrEqual(0);
        }
    });

    it('目标与当前相同时原样返回', () => {
        const base = { STR: 5, CON: 8, SPD: 4, MANA: 3 };
        const scaled = MonsterGenerator.scaleAttributes(base, 20);
        expect(scaled).toEqual(base);
    });

    it('全零属性不崩溃', () => {
        const base = { STR: 0, CON: 0, SPD: 0, MANA: 0 };
        const scaled = MonsterGenerator.scaleAttributes(base, 40);
        expect(scaled).toEqual(base);
    });

    it('缩放是深拷贝，不修改原对象', () => {
        const base = { STR: 5, CON: 8, SPD: 4, MANA: 3 };
        const original = { ...base };
        MonsterGenerator.scaleAttributes(base, 60);
        expect(base).toEqual(original);
    });
});

// ─── 普通实例化 ────────────────────────────────────────

describe('MonsterGenerator — 普通实例化 (instantiate)', () => {

    it('每层属性总点 = 25 + floor × 3', () => {
        const template = TEMPLATES[0]; // 史莱姆
        for (let floor = 1; floor <= 10; floor++) {
            const rng = new SeededRandom(floor * 100);
            const instance = MonsterGenerator.instantiate(template, floor, rng);
            expect(attrTotal(instance.baseProperty)).toBe(25 + floor * 3);
        }
    });

    it('保留模板的名称、ID、类型、流派', () => {
        const rng = new SeededRandom(42);
        const template = TEMPLATES[2]; // 冰原狼
        const instance = MonsterGenerator.instantiate(template, 5, rng);
        expect(instance.templateId).toBe('ice_wolf');
        expect(instance.name).toBe('冰原狼');
        expect(instance.type).toBe(MonsterType.FACTION);
        expect(instance.faction).toBe(Faction.ICE);
    });

    it('保留模板的卡组设计（深拷贝）', () => {
        const rng = new SeededRandom(42);
        const template = TEMPLATES[2]; // 3 张牌的冰原狼
        const instance = MonsterGenerator.instantiate(template, 5, rng);
        expect(instance.deck.length).toBe(3);
        expect(instance.deck[0].defId).toBe('ice_frost_bolt');
        expect(instance.deck[1].defId).toBe('ice_chill');
        expect(instance.deck[2].defId).toBe('common_guard');
        // 深拷贝
        expect(instance.deck).not.toBe(template.deck);
        expect(instance.deck[0]).not.toBe(template.deck[0]);
    });

    it('保留模板的遗物配置（深拷贝）', () => {
        const rng = new SeededRandom(42);
        const template = TEMPLATES[4]; // 暗影骑士，带遗物
        const instance = MonsterGenerator.instantiate(template, 7, rng);
        expect(instance.relics).toEqual(['relic_dark_armor']);
        expect(instance.relics).not.toBe(template.relics);
    });

    it('战斗属性正确派生', () => {
        const rng = new SeededRandom(42);
        const instance = MonsterGenerator.instantiate(TEMPLATES[0], 5, rng);
        expect(instance.maxHp).toBe(instance.baseProperty.CON * 15 + 30);
        expect(instance.attack).toBe(instance.baseProperty.STR);
        expect(instance.baseSpeed).toBe(instance.baseProperty.SPD);
        expect(instance.maxMp).toBe(Math.round(instance.baseProperty.MANA * 1.5));
    });

    it('金币在模板范围内', () => {
        const template = TEMPLATES[0]; // goldDrop: 10-20
        for (let i = 0; i < 50; i++) {
            const rng = new SeededRandom(i);
            const instance = MonsterGenerator.instantiate(template, 3, rng);
            expect(instance.goldDrop).toBeGreaterThanOrEqual(10);
            expect(instance.goldDrop).toBeLessThanOrEqual(20);
        }
    });
});

// ─── 精英实例化 ────────────────────────────────────────

describe('MonsterGenerator — 精英实例化 (instantiateAsElite)', () => {

    it('属性总点 = 25 + (floor+2) × 3', () => {
        const template = TEMPLATES[4]; // 暗影骑士
        for (let floor = 3; floor <= 10; floor++) {
            const rng = new SeededRandom(floor * 100);
            const instance = MonsterGenerator.instantiateAsElite(template, floor, rng);
            const effectiveFloor = Math.min(floor + 2, 10);
            expect(attrTotal(instance.baseProperty)).toBe(25 + effectiveFloor * 3);
        }
    });

    it('同层精英属性高于普通', () => {
        const template = TEMPLATES[0];
        for (let floor = 3; floor <= 9; floor++) {
            const rng1 = new SeededRandom(42);
            const rng2 = new SeededRandom(42);
            const normal = MonsterGenerator.instantiate(template, floor, rng1);
            const elite = MonsterGenerator.instantiateAsElite(template, floor, rng2);
            expect(attrTotal(elite.baseProperty)).toBeGreaterThan(attrTotal(normal.baseProperty));
        }
    });
});

// ─── 赏金实例化 ────────────────────────────────────────

describe('MonsterGenerator — 赏金实例化 (instantiateAsBounty)', () => {

    it('属性总点 = round(精英属性 × 1.5)', () => {
        const template = TEMPLATES[4];
        for (let floor = 3; floor <= 10; floor++) {
            const rng = new SeededRandom(floor * 100);
            const instance = MonsterGenerator.instantiateAsBounty(template, floor, rng);
            const eliteParams = FloorManager.getEliteParams(floor);
            expect(attrTotal(instance.baseProperty)).toBe(Math.round(eliteParams.attributeTotal * 1.5));
        }
    });

    it('同层赏金属性高于精英', () => {
        const template = TEMPLATES[4];
        for (let floor = 3; floor <= 9; floor++) {
            const rng1 = new SeededRandom(42);
            const rng2 = new SeededRandom(42);
            const elite = MonsterGenerator.instantiateAsElite(template, floor, rng1);
            const bounty = MonsterGenerator.instantiateAsBounty(template, floor, rng2);
            expect(attrTotal(bounty.baseProperty)).toBeGreaterThan(attrTotal(elite.baseProperty));
        }
    });
});

// ─── 模板过滤 ──────────────────────────────────────────

describe('MonsterGenerator — 模板过滤 (filterForFloor)', () => {

    it('第 1-2 层：仅 NORMAL 类型', () => {
        for (let floor = 1; floor <= 2; floor++) {
            const result = MonsterGenerator.filterForFloor(TEMPLATES, floor);
            expect(result.length).toBeGreaterThan(0);
            for (const t of result) {
                expect(t.type).toBe(MonsterType.NORMAL);
            }
        }
    });

    it('第 3 层起：可含 FACTION 模板', () => {
        const result = MonsterGenerator.filterForFloor(TEMPLATES, 3);
        const hasFaction = result.some(t => t.type === MonsterType.FACTION);
        expect(hasFaction).toBe(true);
    });

    it('第 1-5 层：无 ELITE 模板', () => {
        for (let floor = 1; floor <= 5; floor++) {
            const result = MonsterGenerator.filterForFloor(TEMPLATES, floor);
            for (const t of result) {
                expect(t.type).not.toBe(MonsterType.ELITE);
            }
        }
    });

    it('第 6 层起：可含 ELITE 模板', () => {
        const result = MonsterGenerator.filterForFloor(TEMPLATES, 6);
        const hasElite = result.some(t => t.type === MonsterType.ELITE);
        expect(hasElite).toBe(true);
    });

    it('遵守模板 floorMin/floorMax', () => {
        // 史莱姆 floorMax=5，第 6 层不应出现
        const r6 = MonsterGenerator.filterForFloor(TEMPLATES, 6);
        expect(r6.find(t => t.id === 'slime')).toBeUndefined();

        // 冰原狼 floorMax=8，第 9 层不应出现
        const r9 = MonsterGenerator.filterForFloor(TEMPLATES, 9);
        expect(r9.find(t => t.id === 'ice_wolf')).toBeUndefined();

        // 石像鬼 floorMin=4，第 3 层不应出现
        const r3 = MonsterGenerator.filterForFloor(TEMPLATES, 3);
        expect(r3.find(t => t.id === 'golem')).toBeUndefined();
    });

    it('空模板池返回空', () => {
        const result = MonsterGenerator.filterForFloor([], 5);
        expect(result.length).toBe(0);
    });
});

// ─── 选择 + 实例化 ────────────────────────────────────

describe('MonsterGenerator — 选择并实例化 (pickAndInstantiate)', () => {

    it('返回有效实例', () => {
        const rng = new SeededRandom(42);
        const instance = MonsterGenerator.pickAndInstantiate(TEMPLATES, 3, rng);
        expect(instance).not.toBeNull();
        expect(instance!.name.length).toBeGreaterThan(0);
        expect(attrTotal(instance!.baseProperty)).toBe(25 + 3 * 3);
    });

    it('excludeIds 排除指定模板', () => {
        const rng = new SeededRandom(42);
        const usedIds: string[] = [];
        for (let i = 0; i < 20; i++) {
            const instance = MonsterGenerator.pickAndInstantiate(
                TEMPLATES, 1, new SeededRandom(i), usedIds,
            );
            if (instance) {
                usedIds.push(instance.templateId);
            }
        }
        // 第 1 层只有 slime 和 bat，排除两个后应返回 null
        const result = MonsterGenerator.pickAndInstantiate(
            TEMPLATES, 1, rng, ['slime', 'bat'],
        );
        expect(result).toBeNull();
    });

    it('无合法模板时返回 null', () => {
        const rng = new SeededRandom(42);
        const result = MonsterGenerator.pickAndInstantiate([], 5, rng);
        expect(result).toBeNull();
    });
});

describe('MonsterGenerator — 选择精英 (pickElite)', () => {

    it('优先选 ELITE 类型模板', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 20; i++) {
            const instance = MonsterGenerator.pickElite(TEMPLATES, 6, new SeededRandom(i));
            expect(instance).not.toBeNull();
            // 第 6 层有 dark_knight (ELITE)，应该被优先选中
            expect(instance!.templateId).toBe('dark_knight');
        }
    });

    it('无 ELITE 模板时退化为任意合法模板', () => {
        const noElite = TEMPLATES.filter(t => t.type !== MonsterType.ELITE);
        const rng = new SeededRandom(42);
        const instance = MonsterGenerator.pickElite(noElite, 5, rng);
        expect(instance).not.toBeNull();
    });

    it('使用精英属性缩放', () => {
        const rng = new SeededRandom(42);
        const instance = MonsterGenerator.pickElite(TEMPLATES, 6, rng);
        expect(instance).not.toBeNull();
        const effectiveFloor = Math.min(6 + 2, 10);
        expect(attrTotal(instance!.baseProperty)).toBe(25 + effectiveFloor * 3);
    });
});

describe('MonsterGenerator — 选择赏金 (pickBounty)', () => {

    it('使用赏金属性缩放', () => {
        const rng = new SeededRandom(42);
        const instance = MonsterGenerator.pickBounty(TEMPLATES, 6, rng);
        expect(instance).not.toBeNull();
        const eliteParams = FloorManager.getEliteParams(6);
        expect(attrTotal(instance!.baseProperty)).toBe(Math.round(eliteParams.attributeTotal * 1.5));
    });

    it('赏金属性高于精英', () => {
        const rng1 = new SeededRandom(42);
        const rng2 = new SeededRandom(42);
        const elite = MonsterGenerator.pickElite(TEMPLATES, 6, rng1);
        const bounty = MonsterGenerator.pickBounty(TEMPLATES, 6, rng2);
        expect(elite).not.toBeNull();
        expect(bounty).not.toBeNull();
        expect(attrTotal(bounty!.baseProperty)).toBeGreaterThan(attrTotal(elite!.baseProperty));
    });
});

// ─── 确定性 ────────────────────────────────────────────

describe('MonsterGenerator — 种子确定性', () => {

    it('相同种子 + 相同模板 = 相同实例', () => {
        const template = TEMPLATES[0];
        const i1 = MonsterGenerator.instantiate(template, 5, new SeededRandom(12345));
        const i2 = MonsterGenerator.instantiate(template, 5, new SeededRandom(12345));
        expect(i1.baseProperty).toEqual(i2.baseProperty);
        expect(i1.goldDrop).toBe(i2.goldDrop);
        expect(i1.deck).toEqual(i2.deck);
        expect(i1.relics).toEqual(i2.relics);
    });

    it('不同种子可能产生不同金币（模板范围内）', () => {
        const template = TEMPLATES[0]; // goldDrop: 10-20
        const golds = new Set<number>();
        for (let seed = 0; seed < 100; seed++) {
            const instance = MonsterGenerator.instantiate(template, 5, new SeededRandom(seed));
            golds.add(instance.goldDrop);
        }
        expect(golds.size).toBeGreaterThan(1);
    });
});
