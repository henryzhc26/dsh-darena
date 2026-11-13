# DS 宠物 · 比武台（dsh-pet-arena）

两只宠物，各调用一个**真实的 AI 模型**，在同一张机关房里比谁先到终点。

- 不是随机数打架：胜负来自「答得对不对、走得快不快」。同一个 seed 生成同一张地图，双方各调一次模型，输出一行路线，判定全部在本地纯函数里复算。
- 免费可用：DSH 自带的 DeepSeek V4.1 Flash。你接了别的模型（Claude / Gemini / 任何 OpenAI 兼容接口），就能用你自己那把 key，按你自己的额度计费。
- 你能参与，但不能代打：开局选战术（稳/快/赌，只改打分权重），每局一次「助威」+5 分。
- 排行榜按净胜场排（胜 − 负）。

## 玩法

1. 选我方模型、对手模型、难度（7×7 入门 / 9×9 挑战）；
2. 点「开始对战」：两边各获得同一张图，终点藏在死胡同里、门口一扇门，**必须先拿钥匙**；
3. 模型输出动作序列（例如 `<PLAN>E E S S K U N</PLAN>`），前端逐格播放；
4. 先到终点者赢；同到比步数，再比用时。

## 模型从哪来

插件装进 DSH 后，**默认走宿主自己的模型通道**（`ctx.llm`）：你 DSH 里能选的模型都会出现在下拉里，不用再填 key，额度也算在你自己名下。宿主通道拿不到时，自动退回下面这套直连。

| 来源 | 说明 |
|---|---|
| 宿主模型（插件内） | DSH 已配置的 provider / 模型，自动列出 |
| DeepSeek（免费） | 用 DSH 账号自带的额度 |
| 你已接入 | 检测本机是否有对应 key：中转站（Claude 系列）、Gemini |
| 手动添加 | 任何 OpenAI 兼容接口，填 baseURL + 模型 ID + key，先探活通了才保存 |

key 只落本机文件（`~/.dsh/bot/pet-hub/`），网页与日志里只出现尾号。

## 在哪打开

侧栏一行「DS 宠物 · 比武台」。面板里就是游戏页（`/pet-arena/`）。

## 数据落盘

- 宠物档案：`~/.dsh/bot/pet-hub/pets.json`
- 排行榜：`~/.dsh/bot/pet-hub/arena-board.json`
- 手动添加的模型：`~/.dsh/bot/pet-hub/extra-models.json` + `extra-keys/`

## 目录

```
index.js            host：/pet-arena 静态页 + /pet-arena/api/* 接口
client.js           侧栏面板（iframe 到 /pet-arena/）
server/pet-llm.cjs  模型目录、真调用、排行榜、宠物档案
public/             游戏页（index.html / core.js / assets）
cordis.patch.yml    bundle patch
```

## 已知边界

- 排行榜是**本机**的：多用户要同一张榜，需要一个托管后端（当前版本不做）。
- 模型调用走本机 key 文件；后续版本改为走宿主 LLM 服务。
