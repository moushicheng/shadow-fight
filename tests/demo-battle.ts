/**
 * 基础战斗演示
 *
 * 双方 HP 100, MP 10, 各持 1 张普通攻击（0 费, 5 伤害）
 * 玩家 SPD 10, 对手 SPD 9
 * 运行至战斗结束，打印逐 tick 日志
 */
import { BattleEngine } from '../game/assets/scripts/core/battle/BattleEngine';
import { DEFAULT_BATTLE_CONFIG } from '../game/assets/scripts/types/BattleTypes';
import { EffectTarget, Faction, CardRarity, CardType } from '../game/assets/scripts/types/Enums';
import { makeFighter, makeCardDef, makeCardInstance, makeRegistry } from './helpers';

// ── 定义一张普通攻击卡 ──
const basicAttack = makeCardDef({
    id: 'basic_attack',
    name: '普通攻击',
    faction: Faction.COMMON,
    rarity: CardRarity.NORMAL,
    cardType: CardType.ATTACK,
    manaCost: 0,
    effects: [{
        target: EffectTarget.ENEMY,
        damage: { base: 5 },
    }],
});

const registry = makeRegistry([basicAttack]);

// ── 创建双方 ──
const player = makeFighter(
    '玩家(SPD10)',
    { baseSpeed: 10, currentHp: 100, maxHp: 100, currentMp: 10, maxMp: 10 },
    [makeCardInstance('basic_attack')],
);
const opponent = makeFighter(
    '对手(SPD9)',
    { baseSpeed: 9, currentHp: 100, maxHp: 100, currentMp: 10, maxMp: 10 },
    [makeCardInstance('basic_attack')],
);

// ── 开始战斗 ──
const engine = new BattleEngine(player, opponent, registry, DEFAULT_BATTLE_CONFIG, 42);
const state = engine.getState();

console.log('═══════════════════════════════════════════');
console.log('  ⚔️  基础战斗演示');
console.log('  玩家: HP 100 | MP 10 | SPD 10');
console.log('  对手: HP 100 | MP 10 | SPD 9');
console.log('  卡组: 各 1 张「普通攻击」(0费, 5伤害)');
console.log('═══════════════════════════════════════════\n');

let lastLogIdx = 0;

while (!state.isFinished) {
    engine.runTick();

    // 打印本 tick 新增的日志
    if (state.log.length > lastLogIdx) {
        for (let i = lastLogIdx; i < state.log.length; i++) {
            const e = state.log[i];
            const prefix = e.type === 'CYCLE_END' || e.type === 'OVERTIME_DAMAGE'
                ? `[Cycle ${e.cycle}]`
                : `[Tick ${String(e.tick).padStart(4)}]`;
            console.log(`${prefix} ${e.message}`);
        }
        lastLogIdx = state.log.length;
    }
}

// ── 战斗结束摘要 ──
console.log('\n═══════════════════════════════════════════');
console.log(`  战斗结束于 Tick ${state.tickCount} (${state.cycleCount} 周期)`);
console.log(`  结果: ${state.winner === 'draw' ? '平局' : state.winner === 'player' ? '玩家(SPD10) 获胜' : '对手(SPD9) 获胜'}`);
console.log(`  玩家 HP: ${state.player.combatant.currentHp}/${state.player.combatant.maxHp}`);
console.log(`  对手 HP: ${state.opponent.combatant.currentHp}/${state.opponent.combatant.maxHp}`);

const playerActions = state.log.filter(e => e.actor === 'player' && e.type === 'PLAY_CARD').length;
const opponentActions = state.log.filter(e => e.actor === 'opponent' && e.type === 'PLAY_CARD').length;
console.log(`  玩家出牌: ${playerActions} 次 | 对手出牌: ${opponentActions} 次`);
console.log('═══════════════════════════════════════════');
