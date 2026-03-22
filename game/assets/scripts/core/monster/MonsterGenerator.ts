import { MonsterType } from '../../types/Enums';
import { MonsterTemplate } from '../../types/MonsterTypes';
import { PlayerBaseProperty } from '../../types/CharacterTypes';
import { SeededRandom } from '../utils/SeededRandom';
import { FloorManager } from '../run/FloorManager';
import { calcMaxHp, calcAttack, calcBaseSpeed, calcMaxMp } from '../character/AttributeGenerator';

/**
 * 战斗用野怪实例。
 * 由开发者在 data/monsters.ts 中设计模板，MonsterGenerator 负责
 * 选择合适模板并按层级缩放属性，生成可直接用于战斗的实例。
 */
export interface MonsterInstance {
    templateId: string;
    name: string;
    type: MonsterType;
    faction?: string;
    baseProperty: PlayerBaseProperty;
    maxHp: number;
    attack: number;
    baseSpeed: number;
    maxMp: number;
    deck: { defId: string; upgraded: boolean }[];
    relics: string[];
    goldDrop: number;
}

const MONSTER_SPD_MIN = 1;

/**
 * MonsterGenerator —— 野怪生成系统（模板驱动）。
 *
 * 设计理念：每个怪物都是开发者精心设计的——
 * 卡组搭配、属性比例、遗物配置、名字风格全部写在 MonsterTemplate 里。
 * 本类仅负责：
 *   1. 从模板池中按层数/类型筛选合适的模板
 *   2. 将模板的属性按当前层的难度公式等比缩放
 *   3. 输出战斗可用的 MonsterInstance
 *
 * 纯逻辑层，不持有可变状态，不依赖引擎 API。
 */
export class MonsterGenerator {

    /**
     * 等比缩放属性到目标总点数。
     * 保持模板设计的属性比例，通过舍入修正确保总点精确。
     * SPD 保底 >= 1，防止怪物无法行动。
     */
    static scaleAttributes(
        base: PlayerBaseProperty,
        targetTotal: number,
    ): PlayerBaseProperty {
        const currentTotal = base.STR + base.CON + base.SPD + base.MANA;

        if (currentTotal === 0 || currentTotal === targetTotal) {
            return { ...base };
        }

        const scale = targetTotal / currentTotal;
        const scaled: PlayerBaseProperty = {
            STR: Math.max(0, Math.round(base.STR * scale)),
            CON: Math.max(0, Math.round(base.CON * scale)),
            SPD: Math.max(MONSTER_SPD_MIN, Math.round(base.SPD * scale)),
            MANA: Math.max(0, Math.round(base.MANA * scale)),
        };

        const actual = scaled.STR + scaled.CON + scaled.SPD + scaled.MANA;
        const diff = targetTotal - actual;
        if (diff !== 0) {
            const sorted = (['STR', 'CON', 'SPD', 'MANA'] as const)
                .slice().sort((a, b) => scaled[b] - scaled[a]);
            scaled[sorted[0]] = Math.max(0, scaled[sorted[0]] + diff);
        }

        return scaled;
    }

    /**
     * 从模板实例化普通难度怪物。
     * 属性总点缩放到 25 + floor × 3。
     */
    static instantiate(
        template: MonsterTemplate,
        floor: number,
        rng: SeededRandom,
    ): MonsterInstance {
        const targetTotal = 25 + floor * 3;
        return MonsterGenerator._createInstance(template, targetTotal, rng);
    }

    /**
     * 从模板实例化精英难度怪物。
     * 属性按 floor+2 等效层计算（更高总点）。
     */
    static instantiateAsElite(
        template: MonsterTemplate,
        floor: number,
        rng: SeededRandom,
    ): MonsterInstance {
        const eliteParams = FloorManager.getEliteParams(floor);
        return MonsterGenerator._createInstance(template, eliteParams.attributeTotal, rng);
    }

    /**
     * 从模板实例化赏金难度怪物。
     * 属性 = 精英 × 1.5。
     */
    static instantiateAsBounty(
        template: MonsterTemplate,
        floor: number,
        rng: SeededRandom,
    ): MonsterInstance {
        const bountyParams = FloorManager.getBountyParams(floor);
        return MonsterGenerator._createInstance(template, bountyParams.bountyAttributeTotal, rng);
    }

    /**
     * 过滤出适合当前层的模板。
     * 遵守 floorMin/floorMax 范围和层级类型限制
     * （1-2 层仅 NORMAL，3+ 层含 FACTION，6+ 层含 ELITE）。
     */
    static filterForFloor(
        templates: MonsterTemplate[],
        floor: number,
    ): MonsterTemplate[] {
        const params = FloorManager.getMonsterParams(floor);
        const allowedTypes = new Set(params.allowedTypes);
        return templates.filter(t =>
            floor >= t.floorMin &&
            floor <= t.floorMax &&
            allowedTypes.has(t.type),
        );
    }

    /**
     * 从模板池中随机选一个适合当前层的模板，实例化为普通难度。
     * 可通过 excludeIds 排除已选过的模板（用于路线三选一去重）。
     */
    static pickAndInstantiate(
        templates: MonsterTemplate[],
        floor: number,
        rng: SeededRandom,
        excludeIds: string[] = [],
    ): MonsterInstance | null {
        const candidate = MonsterGenerator._pickTemplate(
            templates, floor, rng, excludeIds,
        );
        if (!candidate) return null;
        return MonsterGenerator.instantiate(candidate, floor, rng);
    }

    /**
     * 选择模板并以精英难度实例化。
     * 优先选 ELITE 类型模板；池中无 ELITE 时退化为任意合法模板。
     */
    static pickElite(
        templates: MonsterTemplate[],
        floor: number,
        rng: SeededRandom,
        excludeIds: string[] = [],
    ): MonsterInstance | null {
        const candidate = MonsterGenerator._pickTemplate(
            templates, floor, rng, excludeIds, MonsterType.ELITE,
        );
        if (!candidate) return null;
        return MonsterGenerator.instantiateAsElite(candidate, floor, rng);
    }

    /**
     * 选择模板并以赏金难度实例化。
     */
    static pickBounty(
        templates: MonsterTemplate[],
        floor: number,
        rng: SeededRandom,
        excludeIds: string[] = [],
    ): MonsterInstance | null {
        const candidate = MonsterGenerator._pickTemplate(
            templates, floor, rng, excludeIds, MonsterType.ELITE,
        );
        if (!candidate) return null;
        return MonsterGenerator.instantiateAsBounty(candidate, floor, rng);
    }

    // ─── 私有方法 ──────────────────────────────────────

    /** 从过滤后的模板中随机选一个，支持类型优先 + 排除列表 */
    private static _pickTemplate(
        templates: MonsterTemplate[],
        floor: number,
        rng: SeededRandom,
        excludeIds: string[],
        preferType?: MonsterType,
    ): MonsterTemplate | null {
        const excludeSet = new Set(excludeIds);
        const valid = MonsterGenerator.filterForFloor(templates, floor)
            .filter(t => !excludeSet.has(t.id));

        if (valid.length === 0) return null;

        if (preferType) {
            const preferred = valid.filter(t => t.type === preferType);
            if (preferred.length > 0) return rng.pick(preferred);
        }

        return rng.pick(valid);
    }

    /** 根据模板和目标属性总点创建实例 */
    private static _createInstance(
        template: MonsterTemplate,
        targetAttributeTotal: number,
        rng: SeededRandom,
    ): MonsterInstance {
        const scaledProp = MonsterGenerator.scaleAttributes(
            template.baseProperty, targetAttributeTotal,
        );
        const goldDrop = rng.nextInt(template.goldDrop.min, template.goldDrop.max);

        return {
            templateId: template.id,
            name: template.name,
            type: template.type,
            faction: template.faction,
            baseProperty: scaledProp,
            maxHp: calcMaxHp(scaledProp.CON),
            attack: calcAttack(scaledProp.STR),
            baseSpeed: calcBaseSpeed(scaledProp.SPD),
            maxMp: calcMaxMp(scaledProp.MANA),
            deck: template.deck.map(c => ({ ...c })),
            relics: [...template.relics],
            goldDrop,
        };
    }
}
