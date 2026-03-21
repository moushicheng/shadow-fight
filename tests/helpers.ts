/**
 * 测试辅助工具：构建 mock 数据、简化测试的工厂函数。
 */
import { RuntimeCombatant, ActiveBuff } from '../game/assets/scripts/types/CharacterTypes';
import { BattleFighter, BattleConfig, DEFAULT_BATTLE_CONFIG } from '../game/assets/scripts/types/BattleTypes';
import { CardDef, CardInstance, CardEffect } from '../game/assets/scripts/types/CardTypes';
import { Faction, CardRarity, CardType, EffectTarget } from '../game/assets/scripts/types/Enums';
import { CardRegistry } from '../game/assets/scripts/core/battle/BattleEngine';

export function makeCombatant(overrides: Partial<RuntimeCombatant> = {}): RuntimeCombatant {
    return {
        currentHp: 100,
        maxHp: 100,
        attack: 10,
        baseSpeed: 10,
        maxMp: 5,
        currentMp: 5,
        armor: 0,
        frostStacks: 0,
        burnStacks: 0,
        poisonStacks: 0,
        actionGauge: 0,
        deckIndex: 0,
        activePowers: [],
        buffs: [],
        ...overrides,
    };
}

export function makeFighter(
    name: string,
    combatant: Partial<RuntimeCombatant> = {},
    deck: CardInstance[] = [],
    relics: string[] = [],
): BattleFighter {
    return {
        name,
        combatant: makeCombatant(combatant),
        deck,
        relics,
    };
}

export function makeCardDef(overrides: Partial<CardDef> = {}): CardDef {
    return {
        id: 'test_card',
        name: '测试卡',
        faction: Faction.COMMON,
        description: '测试用',
        rarity: CardRarity.NORMAL,
        cardType: CardType.ATTACK,
        tags: [],
        manaCost: 1,
        effects: [{
            target: EffectTarget.ENEMY,
            damage: { base: 5 },
        }],
        floorMin: 1,
        floorMax: 10,
        dropWeight: 1,
        droppable: true,
        buyable: true,
        eventObtainable: true,
        starterOnly: false,
        upgrade: {
            name: '测试卡+',
            costReduction: 1,
            enhancedDescription: '增强',
            enhancedEffects: [],
        },
        ...overrides,
    };
}

export function makeCardInstance(defId: string, upgraded = false): CardInstance {
    return { defId, upgraded };
}

/**
 * 构建简易 CardRegistry：从 CardDef 数组创建查询映射。
 */
export function makeRegistry(defs: CardDef[]): CardRegistry {
    const map = new Map(defs.map(d => [d.id, d]));
    return { getCardDef: (id: string) => map.get(id) };
}
