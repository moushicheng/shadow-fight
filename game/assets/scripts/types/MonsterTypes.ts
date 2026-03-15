import { MonsterType, Faction } from './Enums';
import { PlayerBaseProperty } from './CharacterTypes';
import { CardInstance } from './CardTypes';

/**
 * 野怪模板定义。
 * 野怪是每层第 1 循环的 PvE 对手，由系统预设生成。
 * 生成规则：总属性点 = 25 + 层数 × 3，卡组大小 = 3 + 层数。
 * 难度低于同层残影，作为资源积累和机制熟悉的缓冲层。
 */
export interface MonsterTemplate {
    /** 野怪唯一 ID */
    id: string;
    /** 显示名称 */
    name: string;
    /**
     * 野怪类型：
     * - NORMAL: 普通野怪，属性平均，通用卡牌（1-10 层）
     * - FACTION: 流派野怪，具备某一流派简易卡组（3-10 层）
     * - ELITE: 精英野怪，属性更高，携带遗物，卡组完善（6-10 层）
     */
    type: MonsterType;
    /** 可出现的最低层数 */
    floorMin: number;
    /** 可出现的最高层数 */
    floorMax: number;
    /** 关联流派（流派野怪用，决定其卡组风格） */
    faction?: Faction;
    /** 基础属性模板 —— 实际值会乘以层数难度系数 */
    baseProperty: PlayerBaseProperty;
    /** 预设卡组 */
    deck: CardInstance[];
    /** 携带遗物 ID 列表（普通野怪无遗物，精英野怪 1-2 个） */
    relics: string[];
    /** 击败后掉落金币范围 */
    goldDrop: { min: number; max: number };
}
