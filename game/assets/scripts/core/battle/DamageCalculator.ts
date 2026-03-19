import { Attribute, BuffType, Faction } from '../../types/Enums';
import { DamageEffect } from '../../types/CardTypes';
import { RuntimeCombatant } from '../../types/CharacterTypes';
import {
    getEffectiveAttack, absorbByArmor, applyHpDamage,
} from '../character/EffectiveStats';

// ─── 类型定义 ────────────────────────────────────────────

/** 伤害计算结果（含完整链路明细，供日志/UI 使用） */
export interface DamageResult {
    /** 修正后最终伤害（护甲结算前） */
    finalDamage: number;
    /** 被护甲吸收的伤害值 */
    armorAbsorbed: number;
    /** 目标实际损失的 HP */
    actualHpDamage: number;
}

// ─── 伤害计算器 ──────────────────────────────────────────

/**
 * 伤害计算器。
 *
 * 负责完整伤害管线：基础伤害求值 → 灼烧加成 → Buff 修正 → 易伤/减伤 → 护甲结算 → HP 扣除。
 * 也提供低级接口（applyRawDamage）用于引爆、加时等已经算好最终值的场景。
 *
 * @see battle-base.md §六 伤害计算
 */
export class DamageCalculator {

    // ─── 属性查询 ────────────────────────────────────────

    /** 将 Attribute 枚举映射到战斗运行时数值 */
    static getAttributeValue(attr: Attribute, c: RuntimeCombatant): number {
        switch (attr) {
            case Attribute.STR: return getEffectiveAttack(c);
            case Attribute.CON: return c.maxHp;
            case Attribute.SPD: return c.baseSpeed;
            case Attribute.MANA: return c.maxMp;
            default: return 0;
        }
    }

    // ─── 公式求值 ────────────────────────────────────────

    /**
     * 构建公式变量上下文。
     * 公式字符串中可引用这些变量，如 "lostHp * 0.3"。
     */
    static buildFormulaVars(
        caster: RuntimeCombatant,
        target: RuntimeCombatant,
        extras?: Record<string, number>,
    ): Record<string, number> {
        return {
            lostHp: caster.maxHp - caster.currentHp,
            currentHp: caster.currentHp,
            maxHp: caster.maxHp,
            armor: caster.armor,
            currentMp: caster.currentMp,
            atk: getEffectiveAttack(caster),
            spd: caster.baseSpeed,
            burnStacks: target.burnStacks,
            frostStacks: target.frostStacks,
            poisonStacks: target.poisonStacks,
            ...extras,
        };
    }

    /**
     * 简易公式求值器。
     * 支持格式：变量名 | "变量 * 数字" | "数字 * 变量"。
     */
    static evaluateFormula(formula: string, vars: Record<string, number>): number {
        const mulMatch = formula.match(/^\s*(\w+)\s*\*\s*([\d.]+)\s*$/);
        if (mulMatch) {
            return Math.floor((vars[mulMatch[1]] ?? 0) * parseFloat(mulMatch[2]));
        }
        const mulMatch2 = formula.match(/^\s*([\d.]+)\s*\*\s*(\w+)\s*$/);
        if (mulMatch2) {
            return Math.floor(parseFloat(mulMatch2[1]) * (vars[mulMatch2[2]] ?? 0));
        }
        const trimmed = formula.trim();
        if (trimmed in vars) {
            return vars[trimmed];
        }
        return 0;
    }

    // ─── 基础伤害 ────────────────────────────────────────

    /**
     * 从 DamageEffect 计算基础伤害值（固定值 + 属性缩放 + 公式）。
     * 不含任何修正（灼烧加成、Buff 加成等由后续流程处理）。
     *
     * @see battle-base.md §6.1
     */
    static evaluateBaseDamage(
        dmg: DamageEffect,
        caster: RuntimeCombatant,
        formulaVars: Record<string, number>,
    ): number {
        let total = 0;

        if (dmg.base != null) {
            total += dmg.base;
        }
        if (dmg.scaling) {
            const attrValue = DamageCalculator.getAttributeValue(dmg.scaling.attribute, caster);
            total += Math.floor(attrValue * dmg.scaling.multiplier);
        }
        if (dmg.formula) {
            total += DamageCalculator.evaluateFormula(dmg.formula, formulaVars);
        }

        return total;
    }

    // ─── 伤害修正与护甲结算 ──────────────────────────────

    /**
     * 完整伤害管线：基础伤害 → 灼烧加成 → 乘算Buff → 加算Buff → 易伤 → 减伤 → 护甲 → 扣血。
     * 会直接修改 receiver 的 armor 和 currentHp。
     *
     * @param baseDamage  已计算好的基础伤害（来自 evaluateBaseDamage）
     * @param caster      施法者（用于读取 Buff）
     * @param receiver    承受者（直接扣除护甲/HP）
     * @param cardFaction 来源卡牌的流派（火系享受灼烧加成）
     * @param enemyBurnStacks 敌方灼烧层数（灼烧加成始终基于敌方层数，即使自伤也用敌方值）
     * @param ignoreArmor 是否无视护甲（毒药/自伤）
     *
     * @see battle-base.md §6.2, §6.3
     */
    static applyDamage(
        baseDamage: number,
        caster: RuntimeCombatant,
        receiver: RuntimeCombatant,
        cardFaction: Faction,
        enemyBurnStacks: number,
        ignoreArmor: boolean,
    ): DamageResult {
        let dmg = baseDamage;

        if (cardFaction === Faction.FIRE) {
            dmg += enemyBurnStacks;
        }

        const damageMult = 1.0 + DamageCalculator.sumBuff(caster, BuffType.DAMAGE_MULTIPLY);
        const damageBonus = DamageCalculator.sumBuff(caster, BuffType.DAMAGE_BONUS);
        dmg = Math.max(0, Math.floor(dmg * damageMult + damageBonus));

        const vuln = DamageCalculator.sumBuff(receiver, BuffType.VULNERABILITY);
        if (vuln > 0) {
            dmg = Math.floor(dmg * (1.0 + vuln));
        }

        const reduction = DamageCalculator.sumBuff(receiver, BuffType.DAMAGE_REDUCTION);
        dmg = Math.max(0, dmg - reduction);

        return DamageCalculator.applyRawDamage(dmg, receiver, ignoreArmor);
    }

    /**
     * 低级伤害应用：仅护甲吸收 + HP 扣除，不经过任何修正管线。
     * 用于引爆(DETONATE)、加时伤害等已经计算好最终值的场景。
     */
    static applyRawDamage(
        damage: number,
        target: RuntimeCombatant,
        ignoreArmor: boolean,
    ): DamageResult {
        if (ignoreArmor) {
            const actual = applyHpDamage(target, damage);
            return { finalDamage: damage, armorAbsorbed: 0, actualHpDamage: actual };
        }

        const armorBefore = target.armor;
        const afterArmor = absorbByArmor(target, damage);
        const armorAbsorbed = armorBefore - target.armor;
        const actual = applyHpDamage(target, afterArmor);
        return { finalDamage: damage, armorAbsorbed, actualHpDamage: actual };
    }

    // ─── 内部工具 ────────────────────────────────────────

    private static sumBuff(c: RuntimeCombatant, type: BuffType): number {
        let total = 0;
        for (const buff of c.buffs) {
            if (buff.type === type) total += buff.value;
        }
        return total;
    }
}
