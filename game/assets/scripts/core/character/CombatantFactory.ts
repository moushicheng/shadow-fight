import { PlayerBaseProperty, RuntimeCombatant } from '../../types/CharacterTypes';
import { calcMaxHp, calcMaxMp, calcAttack, calcBaseSpeed } from './AttributeGenerator';

/**
 * 从基础属性创建战斗运行时实例。
 * 每场战斗开始时调用，HP/MP 回满，护甲/状态/行动槽全部归零。
 *
 * @param base 四维基础属性（可能已被事件/遗物永久修改）
 */
export function createCombatant(base: PlayerBaseProperty): RuntimeCombatant {
    const maxHp = calcMaxHp(base.CON);
    const maxMp = calcMaxMp(base.MANA);

    return {
        currentHp: maxHp,
        maxHp,
        attack: calcAttack(base.STR),
        baseSpeed: calcBaseSpeed(base.SPD),
        maxMp,
        currentMp: maxMp,
        armor: 0,

        frostStacks: 0,
        burnStacks: 0,
        poisonStacks: 0,

        actionGauge: 0,
        deckIndex: 0,

        activePowers: [],
        buffs: [],
    };
}

/**
 * 为野怪/残影创建战斗实例。
 * 与玩家不同，HP 按 maxHp × 难度系数设定（不使用"死亡时 HP"）。
 */
export function createMonsterCombatant(
    base: PlayerBaseProperty,
    hpMultiplier: number = 1.0,
): RuntimeCombatant {
    const combatant = createCombatant(base);
    combatant.maxHp = Math.floor(combatant.maxHp * hpMultiplier);
    combatant.currentHp = combatant.maxHp;
    return combatant;
}
