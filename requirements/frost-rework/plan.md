# 霜蚀机制重做 — 执行计划

## 目标

- 冻结不再永久，固定持续到下一周期开始
- 冻结触发时消耗全部霜蚀层数
- 冻结期间新施加的霜蚀 1:1 转化为伤害（走护甲）
- 霜蚀不再每周期自然衰减
- 永冬卡重新设计

## 步骤

### 1. 类型层改动
- `CharacterTypes.ts`：RuntimeCombatant 新增 `frozenUntilCycle: number`（-1 表示未冻结）
- `BattleTypes.ts`：`frostDecayPerCycle` 改为 0 或移除；新增日志类型 `FROST_SHATTER`（冻结触发/霜蚀转伤害）

### 2. EffectiveStats 调整
- `isFrozen()` 改为检查 `frozenUntilCycle` 字段而非实时计算速度
- 霜蚀仍然降低有效速度（蓄力阶段的减速效果保留）

### 3. StatusManager 改动
- `applyStatus(FROST)`: 检查施加后是否触发冻结（effective_speed ≤ 0）→ 清零霜蚀、设置 frozenUntilCycle
- 新增 `applyFrostDuringFreeze()`: 冻结期间霜蚀→伤害的转化逻辑
- `resolveDecays()`: 移除霜蚀衰减逻辑
- 新增 `resolveUnfreeze()`: 周期开始时检查解冻

### 4. CardEffectResolver 改动
- `resolveStatus()` 中施加霜蚀时，若目标处于冻结状态 → 转为造成等量伤害
- 实现 `FROST_SCALING`、`FROZEN_BONUS_DAMAGE` special 效果

### 5. BattleEngine 改动
- `fillGauges()`: 用新的 isFrozen 判定
- `playCard()`: 冻结触发检测改用新逻辑
- 周期结算前/后处理解冻

### 6. CycleResolver 改动
- 周期结算开始时先执行解冻检查

### 7. 卡牌数据更新 (ice.ts)
- 永冬：重新设计效果（如"冻结触发时保留一半霜蚀"或"霜蚀转伤害倍率 ×2"）
- 更新所有卡牌描述文本（移除"减速 X"后缀，因为不再衰减所以减速是持久的）

### 8. 文档更新
- battle-base.md §2.6、§3.2、§7.1

## 风险和待确认

- 永冬的新效果需要和用户确认具体设计方向
- 冰封领域在冻结期间触发的 TURN_START 霜蚀也应转为伤害
