import { CardDef, CardInstance } from '../../types/CardTypes';
import { RuntimeCombatant } from '../../types/CharacterTypes';
import { CardType, BuffType, CurseInsertPosition } from '../../types/Enums';
import { SeededRandom } from '../utils/SeededRandom';

// ─── 外部依赖接口 ────────────────────────────────────────

/** 卡牌定义查询接口，由外部提供 */
export interface CardDefProvider {
    getCardDef(defId: string): CardDef | undefined;
}

// ─── 结果类型 ────────────────────────────────────────────

export enum DeckActionType {
    /** 可以正常打出 */
    PLAY = 'PLAY',
    /** MP 不足，跳过 */
    SKIP_NO_MP = 'SKIP_NO_MP',
    /** 诅咒卡强制打出（无视 MP） */
    FORCE_PLAY = 'FORCE_PLAY',
    /** 卡组为空 */
    EMPTY_DECK = 'EMPTY_DECK',
    /** CardDef 查询失败，跳过并推进指针 */
    INVALID_DEF = 'INVALID_DEF',
}

/**
 * DeckRunner 解析后返回的行动描述。
 * BattleEngine 根据此结果决定是否执行卡牌效果。
 */
export interface DeckAction {
    type: DeckActionType;
    /** 当前指针位置的卡牌实例（EMPTY_DECK 时为 null） */
    cardInstance: CardInstance | null;
    /** 对应的卡牌定义（EMPTY_DECK / INVALID_DEF 时为 null） */
    cardDef: CardDef | null;
    /** 计算后的实际法力消耗 */
    effectiveManaCost: number;
}

/** 诅咒卡插入结果 */
export interface CurseInsertResult {
    /** 实际插入位置 */
    insertIndex: number;
    /** 插入后目标的 deckIndex 是否被推移 */
    indexShifted: boolean;
}

// ─── 主类 ────────────────────────────────────────────────

/**
 * 卡组指针与循环管理器。
 *
 * 负责所有与卡组指针相关的纯逻辑：
 * - 解析当前卡牌应执行的动作（打出 / 跳过 / 强制打出）
 * - 推进和循环卡组指针
 * - 从卡组移除卡牌（POWER / CURSE 打出后）
 * - 向卡组插入卡牌（诅咒插入）
 * - 有效法力消耗计算（含升级减费和 Buff 减费）
 *
 * 不涉及效果结算和日志，由 BattleEngine 组合使用。
 *
 * @see battle-base.md §五 行动解析
 */
export class DeckRunner {
    private readonly cardProvider: CardDefProvider;

    constructor(cardProvider: CardDefProvider) {
        this.cardProvider = cardProvider;
    }

    // ─── 当前卡牌解析 ────────────────────────────────────

    /**
     * 解析当前卡组指针位置的卡牌应执行什么动作。
     *
     * 判定逻辑：
     * 1. 卡组空 → EMPTY_DECK
     * 2. CardDef 找不到 → INVALID_DEF（调用方应推进指针）
     * 3. CURSE + forcePlay → FORCE_PLAY（无视 MP 强制执行）
     * 4. MP ≥ 费用 → PLAY
     * 5. MP < 费用 → SKIP_NO_MP
     *
     * @see battle-base.md §5.1 步骤 2-3
     */
    resolveCurrentCard(combatant: RuntimeCombatant, deck: CardInstance[]): DeckAction {
        if (deck.length === 0) {
            return { type: DeckActionType.EMPTY_DECK, cardInstance: null, cardDef: null, effectiveManaCost: 0 };
        }

        const cardInstance = deck[combatant.deckIndex];
        const cardDef = this.cardProvider.getCardDef(cardInstance.defId);

        if (!cardDef) {
            return { type: DeckActionType.INVALID_DEF, cardInstance, cardDef: null, effectiveManaCost: 0 };
        }

        const cost = this.getEffectiveManaCost(cardDef, cardInstance, combatant);
        const isForced = cardDef.cardType === CardType.CURSE && cardDef.forcePlay;

        if (isForced) {
            return { type: DeckActionType.FORCE_PLAY, cardInstance, cardDef, effectiveManaCost: cost };
        }

        if (combatant.currentMp >= cost) {
            return { type: DeckActionType.PLAY, cardInstance, cardDef, effectiveManaCost: cost };
        }

        return { type: DeckActionType.SKIP_NO_MP, cardInstance, cardDef, effectiveManaCost: cost };
    }

    // ─── 指针管理 ────────────────────────────────────────

    /**
     * 推进卡组指针到下一张牌（循环回第一张）。
     * @see battle-base.md §5.1 步骤 4-5
     */
    advanceDeckIndex(combatant: RuntimeCombatant, deck: CardInstance[]): void {
        if (deck.length === 0) return;
        combatant.deckIndex = (combatant.deckIndex + 1) % deck.length;
    }

    /**
     * 移除当前指针位置的卡牌。
     * 用于 POWER 卡打出后永久移除、CURSE 卡打出后移除。
     * 移除后指针保持在同一位置（指向下一张）或归零。
     */
    removeCurrentCard(combatant: RuntimeCombatant, deck: CardInstance[]): void {
        if (deck.length === 0) return;
        deck.splice(combatant.deckIndex, 1);
        if (deck.length > 0 && combatant.deckIndex >= deck.length) {
            combatant.deckIndex = 0;
        }
    }

    /**
     * 判断一张卡在打出后是否应从卡组移除。
     * - POWER 卡：始终移除（效果挂载到角色）
     * - CURSE 卡且 removeAfterPlay：移除（诅咒卡被消耗）
     */
    shouldRemoveAfterPlay(cardDef: CardDef): boolean {
        if (cardDef.cardType === CardType.POWER && cardDef.power) {
            return true;
        }
        if (cardDef.cardType === CardType.CURSE && cardDef.removeAfterPlay) {
            return true;
        }
        return false;
    }

    // ─── 诅咒卡插入 ──────────────────────────────────────

    /**
     * 将诅咒卡实例插入目标卡组。
     *
     * 插入位置规则：
     * - NEXT: 插在当前指针之后
     * - TOP: 插在队首
     * - RANDOM: 插在当前指针之后到卡组末尾之间的随机位置
     *
     * 插入后自动修正目标的 deckIndex（如果插入点在指针之前或等于指针位置）。
     *
     * @see battle-base.md §5.3 诅咒卡处理
     */
    insertCurseCard(
        curseDefId: string,
        targetDeck: CardInstance[],
        targetDeckIndex: number,
        position: CurseInsertPosition,
        rng: SeededRandom,
    ): CurseInsertResult {
        const curseCard: CardInstance = { defId: curseDefId, upgraded: false };
        const insertIdx = DeckRunner.calcInsertIndex(
            position, targetDeckIndex, targetDeck.length, rng,
        );
        targetDeck.splice(insertIdx, 0, curseCard);

        const indexShifted = insertIdx <= targetDeckIndex;
        return { insertIndex: insertIdx, indexShifted };
    }

    /**
     * 批量插入诅咒卡，自动维护 deckIndex 偏移。
     * 返回实际插入数量。
     */
    insertCurseCards(
        curseDefId: string,
        count: number,
        targetCombatant: RuntimeCombatant,
        targetDeck: CardInstance[],
        position: CurseInsertPosition,
        rng: SeededRandom,
    ): number {
        let inserted = 0;
        for (let i = 0; i < count; i++) {
            const result = this.insertCurseCard(
                curseDefId, targetDeck, targetCombatant.deckIndex, position, rng,
            );
            if (result.indexShifted) {
                targetCombatant.deckIndex++;
            }
            inserted++;
        }
        return inserted;
    }

    private static calcInsertIndex(
        position: CurseInsertPosition,
        currentIdx: number,
        deckLength: number,
        rng: SeededRandom,
    ): number {
        switch (position) {
            case CurseInsertPosition.NEXT:
                return Math.min(currentIdx + 1, deckLength);
            case CurseInsertPosition.TOP:
                return 0;
            case CurseInsertPosition.RANDOM:
            default: {
                const min = currentIdx + 1;
                const max = deckLength;
                if (min >= max) return deckLength;
                return rng.nextInt(min, max);
            }
        }
    }

    // ─── 费用计算 ────────────────────────────────────────

    /**
     * 计算实际法力消耗。
     *
     * 减免来源：
     * 1. 卡牌升级路线为 'cost' 时减免 costReduction（通常 -1）
     * 2. 角色身上的 COST_REDUCTION Buff 累加
     *
     * 最低为 0。
     */
    getEffectiveManaCost(
        cardDef: CardDef,
        cardInstance: CardInstance,
        combatant: RuntimeCombatant,
    ): number {
        let cost = cardDef.manaCost;

        if (cardInstance.upgraded && cardInstance.upgradePath === 'cost') {
            cost = Math.max(0, cost - cardDef.upgrade.costReduction);
        }

        let reduction = 0;
        for (const buff of combatant.buffs) {
            if (buff.type === BuffType.COST_REDUCTION) {
                reduction += buff.value;
            }
        }
        return Math.max(0, cost - reduction);
    }

    // ─── 查询工具 ────────────────────────────────────────

    /** 查看当前指针位置的卡牌（不推进指针） */
    peekCurrent(combatant: RuntimeCombatant, deck: CardInstance[]): { cardInstance: CardInstance; cardDef: CardDef } | null {
        if (deck.length === 0) return null;
        const cardInstance = deck[combatant.deckIndex];
        const cardDef = this.cardProvider.getCardDef(cardInstance.defId);
        if (!cardDef) return null;
        return { cardInstance, cardDef };
    }

    /** 预览接下来 N 张卡牌（供 UI 展示用） */
    peekNext(combatant: RuntimeCombatant, deck: CardInstance[], count: number): { cardInstance: CardInstance; cardDef: CardDef }[] {
        if (deck.length === 0) return [];

        const results: { cardInstance: CardInstance; cardDef: CardDef }[] = [];
        const n = Math.min(count, deck.length);

        for (let i = 0; i < n; i++) {
            const idx = (combatant.deckIndex + i) % deck.length;
            const ci = deck[idx];
            const cd = this.cardProvider.getCardDef(ci.defId);
            if (cd) {
                results.push({ cardInstance: ci, cardDef: cd });
            }
        }
        return results;
    }

    /** 获取卡组当前长度 */
    getDeckSize(deck: CardInstance[]): number {
        return deck.length;
    }

    /** 获取当前指针位置 */
    getCurrentIndex(combatant: RuntimeCombatant): number {
        return combatant.deckIndex;
    }

    /** 安全修正指针（防止越界，卡组被外部修改后调用） */
    clampDeckIndex(combatant: RuntimeCombatant, deck: CardInstance[]): void {
        if (deck.length === 0) {
            combatant.deckIndex = 0;
            return;
        }
        if (combatant.deckIndex >= deck.length) {
            combatant.deckIndex = combatant.deckIndex % deck.length;
        }
    }
}
