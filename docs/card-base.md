# 卡牌基础参数设定

本文档定义所有卡牌共享的基础参数结构，为后续各流派卡牌设计提供统一模板。

---

## 一、卡牌标识参数

| 参数 | 字段名 | 类型 | 说明 |
| --- | --- | --- | --- |
| 唯一标识 | id | string | 全局唯一，格式：`{faction}_{snake_case_name}`，如 `fire_flame_strike`、`common_normal_attack` |
| 卡牌名称 | name | string | 显示名称，如「火焰冲击」 |
| 流派标签 | faction | enum | `ICE` `FIRE` `POISON` `HEX` `BLOOD` `ASSASSIN` `BERSERKER` `GUARDIAN` `MONK` `GAMBLER` `COMMON` |
| 效果描述 | description | string | 面向玩家的效果文本，如"造成 10 伤害，施加 2 层灼烧" |
| 背景描述 | flavorText | string | 可选，卡牌故事/氛围文本 |

---

## 二、卡牌分类参数

### 2.1 品质（Rarity）

| 品质 | 值 | 颜色 | 战斗掉落概率 | 商店基础价格 | 移除费用 | 升级费用 |
| --- | --- | --- | --- | --- | --- | --- |
| 普通 | NORMAL | 白 | 55% | 30-50 金 | 50 金 | 80 金 |
| 稀有 | RARE | 蓝 | 30% | 80-120 金 | 50 金 | 80 金 |
| 史诗 | EPIC | 紫 | 12% | 150-200 金 | 50 金 | 80 金 |
| 传说 | LEGENDARY | 金 | 3% | 300-400 金 | 50 金 | 80 金 |

> 7 层以上紫/金掉落概率各 +5%（参见 game-design 5.2）。

### 2.2 卡牌类型（CardType）

卡牌按功能分为以下类型，用于 UI 展示分类、AI 构筑逻辑和部分遗物/事件的条件判断：

| 类型 | 值 | 说明 | 示例 |
| --- | --- | --- | --- |
| 攻击 | ATTACK | 以造成伤害为主要目的 | 普通攻击、火焰冲击、轻击 |
| 防御 | DEFENSE | 以获取护甲/减伤为主要目的 | 铁壁 |
| 技能 | SKILL | 功能性卡牌（增益/控制/回复/属性操作） | 聚气、魔力瓶、丢雪球 |
| 诅咒 | CURSE | 被塞入对手卡组的负面牌，轮到时强制使用 | 虚弱（费用 2 无效果） |

> 一张卡只归属一个主类型。当功能混合时（如「吸力打击」既造伤害又汲取属性），按**主要设计意图**分类——吸力打击主要为了造伤害+汲取，归为 ATTACK。

---

## 三、战斗参数

### 3.1 法力消耗（manaCost）

| 参数 | 字段名 | 类型 | 范围 | 说明 |
| --- | --- | --- | --- | --- |
| 法力消耗 | manaCost | number | 0-5 | 使用该卡牌需消耗的法力值 |

费用设计指导：

| 费用 | 定位 | 使用场景 |
| --- | --- | --- |
| 0 | 免费工具牌 | 聚气、魔力瓶等辅助牌，效果不应太强 |
| 1 | 轻量牌 | 基础攻击、小幅增益，高速角色可大量使用 |
| 2 | 标准牌 | 大多数流派核心牌的默认费用 |
| 3 | 重型牌 | 强力效果，需要法力规划 |
| 4-5 | 终结牌 | 极端效果，通常需要配合回蓝手段或武僧体系 |

> 法力不足时跳过该卡，自动播放下一张。

### 3.2 效果（Effects）

每张卡牌拥有一个效果列表，按顺序执行。每个效果节点的可选字段如下：

#### 伤害类

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| damage.base | number | 固定伤害值，如 `10` |
| damage.scaling | object | 属性缩放，如 `{ attribute: "SPD", multiplier: 1.0 }` 表示 1×SPD 伤害 |
| damage.formula | string | 复杂公式（当 base+scaling 不够用时），如 `"lostHp * 0.3"` |
| damage.ignoreArmor | boolean | 是否无视护甲，默认 false |

#### 护甲类

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| armor.gain | number | 获得固定护甲值 |
| armor.scaling | object | 属性缩放护甲，如 `{ attribute: "CON", multiplier: 0.5 }` |

#### 回复类

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| heal.hp | number | 回复固定 HP |
| heal.hpPercent | number | 回复最大 HP 的百分比（0-1） |
| heal.mp | number | 回复固定 MP |

#### 状态效果类

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| status.type | enum | `FROST` `BURN` `POISON` |
| status.stacks | number | 施加层数 |
| status.target | enum | `ENEMY`（默认）或 `SELF` |

#### 汲取类（血族）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| drain.attribute | enum | `ATK` `SPD` `ARMOR` |
| drain.amount | number | 汲取数值（对方 -N，己方 +N） |

#### 诅咒类（咒术师）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| curse.cardId | string | 塞入对手卡组的诅咒卡 ID |
| curse.count | number | 塞入数量 |
| curse.insertPosition | enum | `RANDOM`（默认）`NEXT`（插在下一张）`TOP`（插在队首） |

#### 特殊机制类

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| special.type | string | 特殊效果标识，如 `"DETONATE"`（引爆灼烧）、`"DICE_ROLL"`（投骰）、`"CONVERT_ATTRIBUTE"`（属性转化） |
| special.params | object | 特殊效果的具体参数，按需定义 |

### 3.3 效果条件（Condition）

部分效果需满足条件才能触发（或触发增强版本）。条件可附加在任意效果节点上：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| condition.type | enum | 条件类型（见下表） |
| condition.operator | enum | `>=` `<=` `>` `<` `==` |
| condition.value | number | 阈值 |
| condition.fallback | object | 条件不满足时的替代效果（可选） |

常用条件类型：

| 条件类型 | 说明 | 示例 |
| --- | --- | --- |
| `HP_PERCENT` | 当前 HP 占比 | 狂战士"若 HP < 30%，伤害翻倍" |
| `CURRENT_MP` | 当前法力值 | 武僧"若 MP ≥ 8，造成 35 伤害" |
| `CURRENT_ARMOR` | 当前护甲值 | 守卫"若护甲 > 0，受到伤害 -5" |
| `ENEMY_STATUS` | 敌方状态层数 | 火系"若灼烧 ≥ 10，引爆伤害 +50%" |
| `TURN_COUNT` | 当前回合数 | "第 1 回合额外获得 5 护甲" |
| `CARDS_PLAYED_THIS_TURN` | 本回合已出牌数 | 刺客"本回合第 3 张及之后的牌伤害 +5" |
| `MP_SPENT_THIS_TURN` | 本回合已消耗 MP | 武僧"造成本回合已消耗 MP ×2 伤害" |

### 3.4 目标（Target）

| 值 | 说明 |
| --- | --- |
| ENEMY | 对敌方生效（默认） |
| SELF | 对自身生效 |

> 大多数攻击牌默认 ENEMY，增益牌默认 SELF。部分卡牌同时包含 ENEMY 和 SELF 效果（如吸血：伤害敌方 + 回复自身），通过效果列表中的多个节点分别指定 target。

---

## 四、掉落与获取参数

### 4.1 出现层数（Floor Availability）

| 参数 | 字段名 | 类型 | 说明 |
| --- | --- | --- | --- |
| 最低出现层 | floorMin | number | 该卡最早出现在第几层（战斗掉落/商店/事件），默认 1 |
| 最高出现层 | floorMax | number | 该卡最晚出现在第几层，默认 10（通常不限制） |

设计指导：

| 层数限制 | 用途 |
| --- | --- |
| floorMin: 1 | 基础牌，从开局就能获得 |
| floorMin: 3 | 中期核心牌，需要一定构筑基础 |
| floorMin: 5 | 后期强力牌，作为卡组成型的关键拼图 |
| floorMin: 7 | 终局级牌，极端效果，只在最后阶段出现 |

### 4.2 掉落权重（Drop Weight）

| 参数 | 字段名 | 类型 | 说明 |
| --- | --- | --- | --- |
| 掉落权重 | dropWeight | number | 同品质同流派内的相对掉落概率权重，默认 1.0 |

> 掉落流程：先按品质概率（55%/30%/12%/3%）决定品质 → 再从该品质的可用卡牌池中按 dropWeight 加权随机。权重 2.0 表示出现概率是同品质其他牌的 2 倍。

### 4.3 获取渠道限制（Acquisition）

| 参数 | 字段名 | 类型 | 说明 |
| --- | --- | --- | --- |
| 可战斗掉落 | droppable | boolean | 是否在战斗奖励池中出现，默认 true |
| 可商店购买 | buyable | boolean | 是否在商店中出现，默认 true |
| 可事件获得 | eventObtainable | boolean | 是否在事件奖励中出现，默认 true |
| 仅初始卡组 | starterOnly | boolean | 仅作为初始卡组卡牌，不在其他渠道出现（如「普通攻击」），默认 false |

---

## 五、升级参数

每张卡牌有一个升级版本（商店支付 80 金升级）。升级提供二选一：

| 升级路线 | 字段名 | 说明 |
| --- | --- | --- |
| 费用减免 | upgrade.costReduction | 法力消耗 -1（最低降到 0） |
| 效果增强 | upgrade.enhancedEffects | 效果数值 +30%（具体到每个效果字段的增强值） |

每张卡在设计时需明确两条升级路线的具体数值：

| 参数 | 字段名 | 类型 | 说明 |
| --- | --- | --- | --- |
| 升级后名称 | upgrade.name | string | 升级后的显示名称，格式建议 `{原名}+`，如「火焰冲击+」 |
| 费用减免值 | upgrade.costReduction | number | 通常为 1 |
| 增强效果描述 | upgrade.enhancedDescription | string | 面向玩家的升级效果文本 |
| 增强效果数据 | upgrade.enhancedEffects | object | 覆盖原始 effects 中的数值字段 |

示例：

```
火焰冲击（原版）：费用 2，10 伤害 + 灼烧 2
├─ 升级路线 A（费用减免）：费用 1，10 伤害 + 灼烧 2
└─ 升级路线 B（效果增强）：费用 2，13 伤害 + 灼烧 3
```

---

## 六、卡牌标签（Tags）

标签用于遗物、事件、条件的交叉引用，一张卡可拥有多个标签：

| 标签 | 值 | 说明 | 示例卡牌 |
| --- | --- | --- | --- |
| 引爆 | DETONATE | 消耗灼烧层数转化为伤害 | 火系引爆类卡牌 |
| 吸血 | LIFESTEAL | 造成伤害的同时回复等量/部分 HP | 血族吸血类卡牌 |
| 汲取 | DRAIN | 偷取对手属性 | 血族汲取类卡牌 |
| 冻结 | FREEZE | 与霜蚀机制相关 | 冰系控制类卡牌 |
| 自伤 | SELF_DAMAGE | 以消耗己方 HP 为代价 | 狂战士搏命类卡牌 |
| 随机 | RANDOM | 效果包含随机性 | 赌徒系列卡牌 |
| 终结 | FINISHER | 设计意图为收割/终结的高伤害牌 | 刺客终结类卡牌 |
| 蓄力 | CHARGE | 不直接造伤害，为后续爆发做准备 | 叠灼烧牌、堆甲牌 |
| 工具 | UTILITY | 资源管理类功能牌 | 魔力瓶、聚气 |

---

## 七、诅咒卡专属参数

诅咒卡是特殊卡牌类型，由咒术师卡牌塞入对手卡组。需要额外参数：

| 参数 | 字段名 | 类型 | 说明 |
| --- | --- | --- | --- |
| 强制使用 | forcePlay | boolean | 轮到时是否强制使用（诅咒卡固定 true） |
| 使用后移除 | removeAfterPlay | boolean | 打出后是否从卡组中移除，默认 true |
| 负面效果 | curseEffect | object | 被迫使用时的效果（浪费法力/自伤/debuff 等） |

---

## 八、数据结构参考

```typescript
type Card = {
  // 标识
  id: string;
  name: string;
  faction: Faction;
  description: string;
  flavorText?: string;

  // 分类
  rarity: "NORMAL" | "RARE" | "EPIC" | "LEGENDARY";
  cardType: "ATTACK" | "DEFENSE" | "SKILL" | "CURSE";
  tags: CardTag[];

  // 战斗
  manaCost: number;
  effects: CardEffect[];

  // 掉落
  floorMin: number;
  floorMax: number;
  dropWeight: number;
  droppable: boolean;
  buyable: boolean;
  eventObtainable: boolean;
  starterOnly: boolean;

  // 升级
  upgrade: {
    name: string;
    costReduction: number;
    enhancedDescription: string;
    enhancedEffects: Partial<CardEffect>[];
  };

  // 诅咒卡专属
  forcePlay?: boolean;
  removeAfterPlay?: boolean;
};

type CardEffect = {
  target: "ENEMY" | "SELF";
  condition?: EffectCondition;

  damage?: {
    base?: number;
    scaling?: { attribute: Attribute; multiplier: number };
    formula?: string;
    ignoreArmor?: boolean;
  };
  armor?: {
    gain?: number;
    scaling?: { attribute: Attribute; multiplier: number };
  };
  heal?: {
    hp?: number;
    hpPercent?: number;
    mp?: number;
  };
  status?: {
    type: "FROST" | "BURN" | "POISON";
    stacks: number;
  };
  drain?: {
    attribute: "ATK" | "SPD" | "ARMOR";
    amount: number;
  };
  curse?: {
    cardId: string;
    count: number;
    insertPosition: "RANDOM" | "NEXT" | "TOP";
  };
  special?: {
    type: string;
    params: Record<string, any>;
  };
};

type EffectCondition = {
  type:
    | "HP_PERCENT"
    | "CURRENT_MP"
    | "CURRENT_ARMOR"
    | "ENEMY_STATUS"
    | "TURN_COUNT"
    | "CARDS_PLAYED_THIS_TURN"
    | "MP_SPENT_THIS_TURN";
  operator: ">=" | "<=" | ">" | "<" | "==";
  value: number;
  fallback?: CardEffect;
};

type Faction =
  | "ICE"
  | "FIRE"
  | "POISON"
  | "HEX"
  | "BLOOD"
  | "ASSASSIN"
  | "BERSERKER"
  | "GUARDIAN"
  | "MONK"
  | "GAMBLER"
  | "COMMON";

type CardTag =
  | "DETONATE"
  | "LIFESTEAL"
  | "DRAIN"
  | "FREEZE"
  | "SELF_DAMAGE"
  | "RANDOM"
  | "FINISHER"
  | "CHARGE"
  | "UTILITY";

type Attribute = "STR" | "CON" | "SPD" | "MANA";
```

---

## 九、卡牌设计模板

设计新卡牌时，按以下模板填写：

```
### {卡牌名}

- **ID**：{faction}_{snake_case}
- **流派**：{流派}
- **品质**：{白/蓝/紫/金}
- **类型**：{攻击/防御/技能/诅咒}
- **费用**：{0-5}
- **标签**：{标签列表}
- **出现层数**：{floorMin}-{floorMax}
- **掉落权重**：{默认 1.0}
- **效果描述**：{面向玩家的文本}
- **效果详情**：
  - {效果 1}
  - {效果 2}
  - ...
- **升级路线 A（费用 -1）**：{描述}
- **升级路线 B（效果 +30%）**：{描述}
- **设计意图**：{为什么需要这张牌，在构筑中的定位}
```

### 模板示例：火焰冲击

- **ID**：fire_flame_strike
- **流派**：FIRE
- **品质**：白（NORMAL）
- **类型**：攻击（ATTACK）
- **费用**：2
- **标签**：CHARGE
- **出现层数**：1-10
- **掉落权重**：1.0
- **效果描述**：造成 10 伤害，施加 2 层灼烧
- **效果详情**：
  - `{ target: "ENEMY", damage: { base: 10 }, status: { type: "BURN", stacks: 2 } }`
- **升级路线 A（费用 -1）**：费用降至 1，其余不变
- **升级路线 B（效果 +30%）**：造成 13 伤害，施加 3 层灼烧
- **设计意图**：火系的面包黄油牌，同时承担伤害和叠灼烧的双重职能，是火系卡组的骨架卡

---

## 十、设计约束与平衡红线

| 约束 | 说明 |
| --- | --- |
| 费用 0 的牌不应有高伤害 | 避免无限免费输出循环 |
| 传说卡不应是纯数值碾压 | 传说卡应改变玩法/提供独特机制，而非单纯"大数字" |
| 通用卡不应强于流派卡 | 通用卡定位为可靠的基础工具 |
| 诅咒卡费用不应超过 3 | 避免对手因诅咒卡耗尽全部法力导致体验崩溃 |
| 自伤卡不应扣超过 30 HP | 配合 Roguelike 的 HP 持续消耗，过高自伤会劝退 |
| 每流派至少 2 张白卡 | 保证低层掉落时流派体验的最低完整度 |
| 条件效果需有 fallback | 条件不满足时不应完全无用（除非费用极低） |
