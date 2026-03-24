import { PlayerBaseProperty } from '../../types/CharacterTypes';
import { Attribute } from '../../types/Enums';
import { SeededRandom } from '../utils/SeededRandom';

const TOTAL_POINTS = 40;
const SPD_MIN = 3;
const ATTRIBUTES: Attribute[] = [Attribute.STR, Attribute.CON, Attribute.SPD, Attribute.MANA];

/**
 * 随机生成四维基础属性（总点数 40，SPD 下限 3）。
 * 算法：先给 SPD 分配最低 3 点，然后将剩余点数随机分配到四维。
 */
export function generateBaseProperty(rng: SeededRandom): PlayerBaseProperty {
    const prop: PlayerBaseProperty = { STR: 0, CON: 0, SPD: SPD_MIN, MANA: 0 };
    let remaining = TOTAL_POINTS - SPD_MIN;

    // 用 "随机切割" 法分配剩余点数
    const cuts: number[] = [];
    for (let i = 0; i < ATTRIBUTES.length - 1; i++) {
        cuts.push(rng.nextInt(0, remaining));
    }
    cuts.push(0);
    cuts.push(remaining);
    cuts.sort((a, b) => a - b);

    const portions = [];
    for (let i = 1; i < cuts.length; i++) {
        portions.push(cuts[i] - cuts[i - 1]);
    }

    prop.STR += portions[0];
    prop.CON += portions[1];
    prop.SPD += portions[2];
    prop.MANA += portions[3];

    return prop;
}

/** 从基础属性计算运行时数值 */
export function calcMaxHp(con: number): number {
    return con * 15 + 30;
}

export function calcMaxMp(mana: number): number {
    return Math.round(mana * 1.5);
}

export function calcAttack(str: number): number {
    return Math.max(str - 10, 0);
}

export function calcBaseSpeed(spd: number): number {
    return spd;
}
