# dsh-darena

**D宠大乐斗**：纯小游戏插件。侧栏点开就是一个占满高度的对局面板——实时匹配真人、三局两胜、11 档难度阶梯、排行榜。

- 主功能：面板内直接打（`https://hivisionelec.cn/dcdld`）。
- 附属功能：把账号绑定的宠物显示在客户端右下角（默认开，右键菜单或设置里可关；关掉不影响对战与战绩）。
- 形象唯一来源＝账号绑定宠物（`/api/identity` + `/api/pet-profile?uid=`）；已绑定就直接进大厅，不会重复问。
- 与 `dsh-ai-office`（AI 办公室）互不依赖，可各自单独安装。

```bash
npm run check && npm run install:local   # 装到 ~/.dsh/plugins/dsh-darena/
```
