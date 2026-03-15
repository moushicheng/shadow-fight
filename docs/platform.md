# 平台适配与数据架构

## 一、抖音平台适配

### 1.1 社交特性

| 功能          | 说明                                     |
| ------------- | ---------------------------------------- |
| 残影来源展示  | 战斗前显示对手抖音昵称和头像             |
| 复仇机制      | 被残影击败后可加入复仇名单，下次优先匹配 |
| 好友挑战      | 直接用好友数据生成对手                   |
| 通关/金卡分享 | 生成分享卡片到抖音                       |

### 1.2 竖屏 UI 布局

> 完整 UI 与交互设计见 [`ui-interaction.md`](ui-interaction.md)，涵盖战斗界面、卡组管理、商店、事件、路线/残影选择等全部场景。

### 1.3 单局时长控制

- 目标：**5-15 分钟**
- 战斗完全自动，玩家决策点在战斗外：**路线选择、残影选择**、事件选择、卡牌奖励 3 选 1、商店购买、卡组排序、赌约选择（赌徒流派）
- 路线选择和残影选择每次约 3-5 秒，不显著增加单局时长
- 支持中途暂停/恢复（存当前 RunState）

---

## 二、数据架构

### 2.1 客户端状态

```typescript
type RunState = {
  seed: number; // 本局随机种子
  baseProperty: PlayerBaseProperty; // 可被事件/遗物修改
  currentHp: number;
  maxHp: number;
  deck: string[]; // 有序卡组
  relics: string[]; // 当前持有遗物
  factionPool: string[]; // 流派池（如 ['ICE', 'BERSERKER']）
  gold: number;
  currentFloor: number; // 1-10
  currentCycle: number; // 1 或 2
  currentNode: "event" | "route_choice" | "monster_battle" | "elite_battle" | "ghost_choice" | "ghost_battle" | "bounty_battle" | "shop" | "wager"; // wager 仅赌徒流派
  tempBuffs: TempBuff[]; // 临时增益（下场战斗生效后消失）
};
```

### 2.2 服务端数据

```typescript
type GhostRecord = {
  oderId: string;
  ghost: Ghost;
  seasonId: string;
  createdAt: Date;
};

type LeaderboardEntry = {
  oderId: string;
  playerName: string;
  seasonId: string;
  clearedFloor: number;
  remainingHp: number;
  timestamp: Date;
};
```
