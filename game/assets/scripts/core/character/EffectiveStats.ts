import { RuntimeCombatant } from '../../types/CharacterTypes';
import { BuffType } from '../../types/Enums';
import { BattleConfig, DEFAULT_BATTLE_CONFIG } from '../../types/BattleTypes';

/**
 * 有效速度计算。
 *
 * effective_speed = baseSpeed + speedBuffs - floor(frostStacks / frostPerSpeedReduction) - drainedSpd
 * 下限为 0（冻结状态）。
 *
 * @see battle-base.md §2.5
 */
export function getEffectiveSpeed(
    c: RuntimeCombatant,
    config: BattleConfig = DEFAULT_BATTLE_CONFIG,
): number {
    const buffBonus = sumBuffValue(c, BuffType.SPEED_BONUS);
    const buffPenalty = sumBuffValue(c, BuffType.SPEED_DEBUFF);
    const frostReduction = Math.floor(c.frostStacks / config.frostPerSpeedReduction);
    const raw = c.baseSpeed + buffBonus - buffPenalty - frostReduction;
    return Math.max(0, raw);
}

/** 是否处于冻结状态 */
export function isFrozen(
    c: RuntimeCombatant,
    config: BattleConfig = DEFAULT_BATTLE_CONFIG,
): boolean {
    return getEffectiveSpeed(c, config) <= 0;
}

/**
 * 有效攻击力计算。
 *
 * effective_attack = attack + atkBuffs - drainedAtk
 * 下限为 0。
 */
export function getEffectiveAttack(c: RuntimeCombatant): number {
    const buffBonus = sumBuffValue(c, BuffType.DAMAGE_BONUS);
    const buffPenalty = sumBuffValue(c, BuffType.ATK_DEBUFF);
    return Math.max(0, c.attack + buffBonus - buffPenalty);
}

/**
 * 获取当前 HP 占最大 HP 的百分比 (0-1)。
 */
export function getHpPercent(c: RuntimeCombatant): number {
    return c.maxHp > 0 ? c.currentHp / c.maxHp : 0;
}

/**
 * 已损失 HP。
 */
export function getLostHp(c: RuntimeCombatant): number {
    return c.maxHp - c.currentHp;
}

/**
 * 对角色造成伤害（扣 HP，不低于 0）。返回实际造成的 HP 伤害。
 */
export function applyHpDamage(c: RuntimeCombatant, amount: number): number {
    const actual = Math.min(c.currentHp, Math.max(0, amount));
    c.currentHp -= actual;
    return actual;
}

/**
 * 回复 HP（不超过 maxHp）。返回实际回复量。
 */
export function healHp(c: RuntimeCombatant, amount: number): number {
    const before = c.currentHp;
    c.currentHp = Math.min(c.maxHp, c.currentHp + Math.max(0, amount));
    return c.currentHp - before;
}

/**
 * 消耗 MP。返回是否足够消耗。
 */
export function spendMp(c: RuntimeCombatant, cost: number): boolean {
    if (c.currentMp < cost) return false;
    c.currentMp -= cost;
    return true;
}

/**
 * 回复 MP（不超过 maxMp）。返回实际回复量。
 */
export function recoverMp(c: RuntimeCombatant, amount: number): number {
    const before = c.currentMp;
    c.currentMp = Math.min(c.maxMp, c.currentMp + Math.max(0, amount));
    return c.currentMp - before;
}

/**
 * 增加护甲。
 */
export function gainArmor(c: RuntimeCombatant, amount: number): void {
    c.armor += Math.max(0, amount);
}

/**
 * 护甲吸收伤害。返回穿透后剩余的伤害值。
 */
export function absorbByArmor(c: RuntimeCombatant, damage: number): number {
    if (c.armor <= 0 || damage <= 0) return damage;
    const absorbed = Math.min(damage, c.armor);
    c.armor -= absorbed;
    return damage - absorbed;
}

/** 汇总指定类型 Buff 的数值之和 */
export function sumBuffValue(c: RuntimeCombatant, buffType: BuffType): number {
    let total = 0;
    for (const buff of c.buffs) {
        if (buff.type === buffType) {
            total += buff.value;
        }
    }
    return total;
}

/** 是否存活 */
export function isAlive(c: RuntimeCombatant): boolean {
    return c.currentHp > 0;
}
