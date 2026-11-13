/**
 * dsh-darena — D宠大乐斗（独立插件）
 *
 * 一个纯小游戏插件，两件事：
 *   1) 侧栏「D宠大乐斗」面板 —— 占满高度的对局页（实时匹配、三局两胜、11 档、排行榜）
 *   2) 客户端前台形象挂件（默认开、可关）—— 把账号绑定宠物显示在右下角
 * 不 import AI 办公室，也不依赖任何邻目录；共享小工具自带一份。
 */

window.__ModuleLoader__.load({
  id: 'dsh-darena',
  factory(require) {
    function __gameModule() {
    const React = require('react')
    const h = React.createElement

    /**
     * 面板本身是授权渲染进程，先把账号身份取到，再用 query 交给 iframe：
     * iframe 里的 /pet-arena/api/* 会被连接层围栏挡掉，签名令牌就是那道门的钥匙。
     * 两级取法：插件自带的 /pet-arena/api/identity → 本机 8925 兜底。
     */
    const IDENTITY_URLS = ['/pet-arena/api/identity', 'http://127.0.0.1:8925/api/identity']

    function loadIdentity(index) {
      const at = typeof index === 'number' ? index : 0
      const url = IDENTITY_URLS[at]
      if (!url) return Promise.resolve(null)
      return fetch(url, { cache: 'no-store', credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => (body && body.ok && body.bound && body.uid ? body : loadIdentity(at + 1)))
        .catch(() => loadIdentity(at + 1))
    }

    const STYLE_ID = 'darena-style'
    const CSS = `
.da-page { position: relative; display: flex; flex-direction: column; height: 100%; background: #04060b; }
.da-frame { flex: 1 1 auto; width: 100%; border: 0; background: #04060b; }
.da-note {
  flex: 0 0 auto; padding: 10px 14px; color: #8fa6c8; font-size: 12px;
  border-bottom: 1px solid rgba(120, 160, 230, .16); background: #0b1220;
}
`

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /**
     * 面板内容＝一个占满高度的大乐斗 iframe。
     * 形象不在这里选：账号已绑定就用账号那只（页面自己读 /api/pet-profile）；
     * 真没宠物时页面会引导领养一次，之后永不重复问。
     */
    function GamePage() {
      const [src, setSrc] = React.useState('')
      const [note, setNote] = React.useState('正在打开…')

      React.useEffect(() => {
        let alive = true
        loadIdentity().then((body) => {
          if (!alive) return
          const query = new URLSearchParams()
          if (body) {
            query.set('uid', body.uid)
            if (body.token) query.set('token', body.token)
          }
          const qs = query.toString()
          setSrc('/pet-arena/' + (qs ? '?' + qs : ''))
          setNote('')
        })
        return () => { alive = false }
      }, [])

      return h('div', { className: 'da-page' },
        note ? h('div', { className: 'da-note', role: 'status' }, note) : null,
        src ? h('iframe', {
          className: 'da-frame',
          src,
          title: 'D宠大乐斗',
          allow: 'clipboard-write',
        }) : null,
      )
    }

    function PanelIcon() {
      return h('svg', {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'm4 20 6.5-6.5' }),
        h('path', { d: 'm13.5 10.5 6.5-6.5' }),
        h('path', { d: 'M4.5 4.5 20 20' }),
        h('circle', { cx: 6.2, cy: 17.8, r: 1.5 }),
        h('circle', { cx: 17.8, cy: 17.8, r: 1.5 }),
      )
    }

    return {
      name: 'darena',
      inject: ['slots'],
      apply(ctx) {
        installStyles()
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
          const stopMain = ctx.slots.register({ name: 'main', key: 'darena' }, () => h(GamePage))
          const stopIcon = ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'darena',
            order: 44,
            label: () => 'D宠大乐斗',
          }, PanelIcon)
          return () => {
            stopIcon?.()
            stopMain?.()
          }
        })), 'darena: 注册侧栏面板')
      },
    }
    }

    function __petModule() {
    /** 图片走 Host 的静态路由，路径必须相对页面 base 解析（反代前缀下才对）。 */
    const ASSET_BASE = 'desktop-pet/assets/'
    const ART = {
      body: 'pet-head.png',
      eyesClosed: 'pet-head-eyes-closed-v8.png',
    }

    /* ── 桌宠形象：跟着网页里「我领的那只宠物」走 ──────────────────────
     * demo/index.html 把 {nick, avatarKey, status} 存在 127.0.0.1:8917 这个源
     * 的 localStorage（键 bo-my-pet::<uid>）。插件跑在 DSH 自己的源上，读不到
     * 别人的 localStorage，所以用一个 1×1 隐藏 iframe 去问一句：桥页
     * demo/pet-bridge.html 只做「读 localStorage → postMessage 回话」，不联网。
     * 取值顺序：本地记住的 dsh.pet.avatar → 网页里那只 → whale。 */
    const PET_BRIDGE = 'http://127.0.0.1:8917/pet-bridge.html'
    const PET_ARENA = 'http://127.0.0.1:8917/arena2/index.html'
    const PET_UID_KEY = 'dsh.pet.uid'
    const PET_AVATAR_KEY = 'dsh.pet.avatar'
    const AVATARS = {
      whale: '鲸鱼', 'whale-girl': '鲸娘',
      botking: '弗利萨', chudan: '鸣人', duizhang: '超赛悟空',
      tongxin: '马里奥', yucheng: '佩恩', bianji: '布欧',
      kangfu: '乔巴', lisenced: '路飞', liushui: '索隆',
    }
    const POS_KEY = 'dsh-pet-pos'
    const HIDDEN_KEY = 'dsh-pet-hidden'
    /** 桌面展示开关：'0' = 关（不挂载、不占位、不进菜单）；默认开。 */
    const DESKTOP_KEY = 'dsh.pet.desktop'
    function desktopEnabled() {
      try {
        return window.localStorage.getItem(DESKTOP_KEY) !== '0'
      } catch {
        return true
      }
    }
    function setDesktopEnabled(on) {
      try {
        window.localStorage.setItem(DESKTOP_KEY, on ? '1' : '0')
      } catch {
        // 存不了就只在本次会话生效
      }
    }
    const STYLE_ID = 'dsh-desktop-pet-style'
    const LAYER_ID = 'dsh-desktop-pet-layer'

    /** 素材是 197×500 @2x，显示尺寸按一半算。 */
    const PET_W = 110
    const PET_H = 210
    const MARGIN = 18
    const BUBBLE_MS = 3400

    /** 闲置多久睡着 / 小动作间隔。 */
    const SLEEP_AFTER_MS = 20 * 60 * 1000 // 20 分钟没人理才打盹：太短会让桌面宠物整天闭着眼像没在干活
    const ACTION_MIN_MS = 8000
    const ACTION_MAX_MS = 20000

    /** 右键「内部群巡查」时发给宇诚总管的指令。 */
    const PROMPT = '去查看「宇诚内部」微信群，把需要我处理的事汇报给我，没有就回一句正常'
    /** 巡查目标：只在这个 bot 的会话里写、发，别处一律不动。 */
    const TARGET_BOT = '宇诚总管'
    const TARGET_SESSION_ID = 'session-f1062e92-82bc-4c4b-89ca-fe3c2766c139'
    const PROMPT_KEYWORD = '宇诚内部'
    const SESSION_WAIT_MS = 4000
    const POLL_MS = 100
    const SEND_VERIFY_MS = 2000

    const BUBBLES = [
      '老板，要查一下内部群吗？',
      '我在呢',
      '点我，我就蹦一下',
      '今天也要好好干活哦',
      '有点困…但我还能撑',
      '右键我，还有别的小功能',
      '打字累了就摸摸我',
    ]

    const CLICK_LINES = ['在呢～', '嘿嘿', '戳我干嘛', '点右键有我']
    const ACTION_LINES = {
      wave: ['我在这儿～', '嗨'],
      nod: ['嗯嗯', '收到'],
      spin: ['转一圈给你看'],
      stretch: ['伸个懒腰'],
      hop: ['蹦！'],
      look: ['找什么呢'],
      yawn: ['哈——欠'],
      walk: ['走两步…', '换个地方'],
      sign: ['举给你看'],
      stomp: ['哼！', '不理你了'],
      sit: ['坐会儿…', '歇一下'],
      turn: ['转过去咯', '别看别看', '背对着你'],
      flip: ['后空翻！', '看好了', '翻一个'],
      slide: ['滑一下', '闪开～'],
    }

    /** 每个小动作的时长（ms），与 CSS 关键帧一致。 */
    const ACTION_MS = {
      wave: 1500,
      nod: 1300,
      spin: 1400,
      stretch: 2000,
      hop: 900,
      look: 1700,
      yawn: 1900,
      walk: 3400,
      sign: 2000,
      stomp: 1500,
      sit: 3000,
      turn: 3000,
      flip: 1200,
      slide: 2300,
    }
    const ACTIONS = Object.keys(ACTION_MS)

    /**
     * 随机动作权重（不是等概率：让"走路/举牌"这种有戏的动作更容易被抽到，
     * 抽中概率 = 权重 / 权重总和，见 pickWeighted）。
     */
    const ACTION_WEIGHTS = {
      wave: 2.2,
      nod: 2.2,
      spin: 1.2,
      stretch: 1.3,
      hop: 1.8,
      look: 1.8,
      yawn: 1.4,
      walk: 2.6,
      sign: 2.1,
      stomp: 1.5,
      sit: 1.5,
      turn: 0.9,
      flip: 0.7,
      slide: 0.7,
    }

    /**
     * 带 DOM/位置副作用的动作：除了 rig 上的关键帧，还会给 root 挂标记类（影子动画），
     * 所以统一由 stopExtras() 收尾 —— 拖动 / 睡着 / 隐藏 / 播下一个动作时立刻清掉，
     * 不会留下半截 transform 或 is-* 标记。
     */
    const EXTRA_ACTIONS = ['walk', 'sign', 'stomp', 'sit', 'spin', 'turn', 'flip', 'stretch', 'slide']
    const EXTRA_FLAG = {
      walk: 'is-walking', sign: 'is-signing', stomp: 'is-stomping', sit: 'is-sitting',
      spin: 'is-spinning', turn: 'is-turning', flip: 'is-flipping', stretch: 'is-stretching',
      slide: 'is-sliding',
    }

    /**
     * reduced-motion 下的静态姿态：只改形变（轻微压缩/拉长），不位移、不旋转；
     * 关键帧被内联的 animation: none 关掉，只留这一帧。
     */
    const REDUCED_POSE = {
      spin: 'scale(0.975, 1.015)',
      turn: 'scale(1.005, 0.995)',
      flip: 'scale(1.025, 0.975)',
      stretch: 'scale(0.955, 1.055)',
      slide: 'scale(1.015, 0.985)',
    }

    /** 新动作挂在 root 上的影子标记：收尾时统一摘掉，避免残留。 */
    const MOTION_FLAGS = ['is-spinning', 'is-turning', 'is-flipping', 'is-stretching', 'is-sliding']

    /** 举牌文案：短到 76px 的牌子上正好一行（最多 4 字）。 */
    const SIGN_LINES = ['摸鱼中', '该喝水', '腰要断', '看这里', '在忙呢', '歇会儿']

    /** 走路：px/s 的步速、起步/收尾占整段的缓动比例、左右都太窄就不走。 */
    const WALK_SPEED = 46
    const WALK_RAMP = 0.2
    const WALK_MIN_ROOM = 44

    /** 表情（右键「换个表情」轮换）：靠叠加层与滤镜，不换照片。 */
    const MOODS = ['normal', 'shy', 'sparkle', 'sleepy']
    const MOOD_LABEL = { normal: '平时', shy: '害羞', sparkle: '星星眼', sleepy: '迷糊' }

    /**
     * 干饭人设：吃 → 满足 → 放屁 →（30%）饭后小盹。
     * 这一组时间不进 ACTION_MS / ACTION_WEIGHTS：随机动作的权重分配有既有验收，
     * 喂食是独立行为链，只借用同一套 DOM/CSS/收尾机制。
     */
    const EAT_MS = 3200           // 大吃：脑袋上下点、身体前倾后仰
    const FULL_MS = 700           // 满足：摸肚子（压扁回弹）
    const FART_DELAY_MIN_MS = 1000 // 吃完后 1–1.5s 内必放（预算内，5s 前能演完三段）
    const FART_DELAY_MAX_MS = 1500
    const FART_BOUNCE_MS = 900    // 放屁时身体轻弹 + 眼睛一眯
    const FART_PUFF_MS = 2600     // 气团淡出并清 DOM，留出 3s 验收余量
    /** 打嗝视觉：身体上顶 + 头部前倾 620ms；口部气团 600ms；660ms 全部清掉（验收要求 700ms 内）。 */
    const BURP_MS = 620
    const BURP_CLEAN_MS = 660
    /** reduced-motion 下只留静态气团，200ms 后删；不跑任何关键帧。 */
    const QUIET_FX_MS = 200

    /**
     * 真·食物实体：嘴上真的叼着一个鸡腿/饭团/汉堡（Q 版插画，透明 PNG），
     * 随咀嚼抖，最后 FOOD_GULP_MS 缩到 0（＝咽下去），与 EAT_MS 同时收 DOM。
     * 素材按 4× 存（160px 宽 → 显示 40px），与宠物图 440×840 → 110×210 同一倍率。
     * left/top 是 110×210 坐标系里的显示位置（嘴边靠前一点），w/h 是显示尺寸。
     */
    const FOOD_GULP_MS = 300
    const FOOD_ASSETS = [
      { file: 'pet-food-chicken-leg.png', w: 40, h: 34.5, left: 9, top: 60, rot: -9 },
      { file: 'pet-food-rice-ball.png', w: 36, h: 33.6, left: 11, top: 61, rot: -5 },
      { file: 'pet-food-burger.png', w: 40, h: 36.25, left: 9, top: 58.5, rot: -6 },
    ]

    /**
     * 真·屎实体：气团散去的尾段，从臀部掉出来 → 落地压扁 → 弹一下 → 停留 2–3s → 淡出。
     * 坐标同样在 110×210 里（臀部外侧、脸以下），整层在朝右时镜像，永远不出 root。
     */
    const POOP_ASSET = { file: 'pet-poop.png', w: 32, h: 32, left: 74, top: 176 }
    const POOP_DELAY_MS = 1700 // 放屁后 1.7s 才掉：等气团先散开，接的正是「尾段」
    const POOP_DROP_MS = 920   // 下落 + 落地压扁 + 弹一下（与 dsh-pet-poop-drop 总长一致）
    const POOP_STAY_MS = 2400  // 落地静止停留（要求 2–3s）
    const POOP_FADE_MS = 520

    const MEAL_NAP_CHANCE = 0.3
    const MEAL_NAP_MIN_MS = 30 * 1000
    const MEAL_NAP_MAX_MS = 60 * 1000

    /** 饿了：每 20–60s 掷一次骰子，概率随「还没吃上」的轮次上升。 */
    const HUNGER_MIN_MS = 20 * 1000
    const HUNGER_MAX_MS = 60 * 1000
    const HUNGER_SHOW_MS = 1500
    const HUNGER_CHANCE_BASE = 0.12
    const HUNGER_CHANCE_STEP = 0.08
    const HUNGER_CHANCE_MAX = 0.72

    const CSS = `
#${LAYER_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  contain: layout style;
}
#${LAYER_ID} .pet-root {
  position: absolute;
  left: 0;
  top: 0;
  width: ${PET_W}px;
  height: ${PET_H}px;
  /* 朝向：-1 = 朝左（照片原始朝向），1 = 朝右（镜像）。JS 在转身时改写，
     坐下/举牌的"前倾"用它来定方向，免得朝右时把人往后仰。 */
  --pet-face: -1;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  will-change: transform;
}
#${LAYER_ID} .pet-root.is-dragging { cursor: grabbing; }
#${LAYER_ID} .pet-root:focus-visible {
  outline: 2px solid rgba(126, 108, 255, 0.85);
  outline-offset: 4px;
  border-radius: 14px;
}

/* —— 变换层：root(位置) > rig(惯性/动作) > sway(摆动) > bob(呼吸) > look(视线) —— */
#${LAYER_ID} .pet-rig {
  position: absolute;
  inset: 0;
  transform-origin: 50% 94%;
  will-change: transform;
}
#${LAYER_ID} .pet-rig.is-settle {
  transition: transform 520ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
#${LAYER_ID} .pet-sway {
  position: absolute;
  inset: 0;
  transform-origin: 50% 100%;
  animation: dsh-pet-sway 7.6s ease-in-out infinite;
}
#${LAYER_ID} .pet-bob {
  position: absolute;
  inset: 0;
  transform-origin: 50% 100%;
  animation: dsh-pet-breathe 4.3s ease-in-out infinite;
}
#${LAYER_ID} .pet-look {
  position: absolute;
  inset: 0;
  transform-origin: 50% 72%;
  transition: transform 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
}
#${LAYER_ID} .pet-art {
  position: absolute;
  inset: 0;
  filter: drop-shadow(0 7px 12px rgba(28, 24, 44, 0.2));
  transition: filter 200ms ease, transform 260ms cubic-bezier(0.4, 0, 0.3, 1);
  will-change: transform;
}
/* 走路朝向：整张照片水平镜像 = 转身（过渡穿过 scaleX(0) 时正好是一瞬间的侧身） */
#${LAYER_ID} .pet-root.is-face-right .pet-art {
  transform: scaleX(-1);
}
#${LAYER_ID} .pet-root.is-dragging .pet-art {
  filter: drop-shadow(0 15px 21px rgba(28, 24, 44, 0.3));
}
#${LAYER_ID} .pet-art img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 260ms ease;
  -webkit-user-drag: none;
  user-drag: none;
}
#${LAYER_ID} .pet-art img.is-on { opacity: 1; }
/* 网页里的 avatar 是 256×256 方图，在 110×210 的框里 object-fit contain 只有 110 高，
   放大到 ~156px 才像一只站在桌上的宠物（贴地不贴顶）。 */
#${LAYER_ID} .pet-root.is-avatar .pet-art img.pet-img {
  /* avatar 是 256×256 方图，contain 在 110×210 的框里本来就占满高度，
     只需一点点放大并贴住框底（脚踩在影子上），不要放太大把人顶出框。 */
  transform: scale(1.02);
  transform-origin: 50% 100%;
}
#${LAYER_ID} .pet-art .pet-lid {
  /* 闭眼素材按 pet-head.png 同框重制（440×840，眼位对齐），直接铺满即可。
     旧的 197×500 眼皮图套在这张头上会落到额头，已废弃。 */
  object-fit: fill;
  transform: none;
  transition: opacity 65ms linear;
}
#${LAYER_ID} .pet-root.is-blinking .pet-lid,
#${LAYER_ID} .pet-root.is-yawn .pet-lid,
#${LAYER_ID} .pet-root.is-sleeping .pet-lid,
#${LAYER_ID} .pet-root.mood-sleepy .pet-lid {
  opacity: 1;
}
#${LAYER_ID} .pet-root.is-sleeping .pet-lid { transition-duration: 300ms; }

/* —— 害羞腮红 —— */
#${LAYER_ID} .pet-blush {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 300ms ease;
  background:
    radial-gradient(ellipse 15% 5% at 35% 17.5%, rgba(255, 128, 150, 0.55), rgba(255, 128, 150, 0) 70%),
    radial-gradient(ellipse 15% 5% at 57% 17%, rgba(255, 128, 150, 0.55), rgba(255, 128, 150, 0) 70%);
}
#${LAYER_ID} .pet-root.mood-shy .pet-blush { opacity: 1; }
#${LAYER_ID} .pet-root.mood-sparkle .pet-art img.is-on { filter: saturate(1.12) brightness(1.04); }

/* —— 地面影子 —— */
#${LAYER_ID} .pet-shadow {
  position: absolute;
  left: 50%;
  bottom: -3px;
  width: 54px;
  height: 11px;
  margin-left: -27px;
  border-radius: 50%;
  background: radial-gradient(ellipse at 50% 50%, rgba(26, 22, 40, 0.32), rgba(26, 22, 40, 0) 72%);
  transition: transform 240ms ease, opacity 240ms ease;
}
#${LAYER_ID} .pet-root.is-jumping .pet-shadow {
  animation: dsh-pet-shadow-hop 900ms ease-out;
}

/* —— 粒子 —— */
#${LAYER_ID} .pet-fx {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
#${LAYER_ID} .pet-fx i {
  position: absolute;
  left: 50%;
  top: 40%;
  font-style: normal;
  font-size: 14px;
  line-height: 1;
  will-change: transform, opacity;
  filter: drop-shadow(0 2px 3px rgba(20, 16, 34, 0.22));
  animation: dsh-pet-fx var(--dur, 1000ms) cubic-bezier(0.18, 0.62, 0.36, 1) forwards;
}

/* —— 气泡 —— */
#${LAYER_ID} .pet-bubble {
  position: absolute;
  left: 50%;
  bottom: calc(100% - 2px);
  transform: translate(calc(-50% + var(--bub-dx, 0px)), calc(var(--bub-dy, 0px) + 6px));
  /* 允许换行后不能再让绝对定位按 110px 的宠物容器收缩（会变成一条竖线），
     先取 max-content 再用 max-width 折行 */
  width: max-content;
  max-width: 200px;
  padding: 7px 11px;
  border-radius: 12px;
  background: var(--dsh-surface, #ffffff);
  color: var(--dsh-text, #1d1b26);
  border: 1px solid rgba(120, 110, 140, 0.22);
  box-shadow: 0 8px 22px rgba(24, 22, 32, 0.16);
  font: 500 12px/1.45 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  white-space: normal;
  overflow-wrap: break-word;
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease, transform 180ms ease;
}
#${LAYER_ID} .pet-bubble.is-on {
  opacity: 1;
  transform: translate(calc(-50% + var(--bub-dx, 0px)), var(--bub-dy, 0px));
}
/* 宠物贴顶、气泡上方放不下时，翻到宠物脚下（箭头也翻到顶边） */
#${LAYER_ID} .pet-bubble.is-below {
  bottom: auto;
  top: calc(100% - 2px);
  transform: translate(calc(-50% + var(--bub-dx, 0px)), calc(var(--bub-dy, 0px) - 6px));
}
#${LAYER_ID} .pet-bubble.is-below.is-on {
  transform: translate(calc(-50% + var(--bub-dx, 0px)), var(--bub-dy, 0px));
}
#${LAYER_ID} .pet-bubble::after {
  content: '';
  position: absolute;
  left: var(--bub-arrow, 50%);
  bottom: -5px;
  width: 9px;
  height: 9px;
  margin-left: -4px;
  background: inherit;
  border-right: 1px solid rgba(120, 110, 140, 0.22);
  border-bottom: 1px solid rgba(120, 110, 140, 0.22);
  transform: rotate(45deg);
}
#${LAYER_ID} .pet-bubble.is-below::after {
  bottom: auto;
  top: -5px;
  border-right: 0;
  border-bottom: 0;
  border-left: 1px solid rgba(120, 110, 140, 0.22);
  border-top: 1px solid rgba(120, 110, 140, 0.22);
}

/* —— 右键菜单 —— */
#${LAYER_ID} .pet-menu {
  position: absolute;
  min-width: 152px;
  padding: 6px;
  border-radius: 12px;
  background: var(--dsh-surface, #ffffff);
  border: 1px solid rgba(120, 110, 140, 0.2);
  box-shadow: 0 14px 34px rgba(24, 22, 32, 0.22);
  pointer-events: auto;
  font: 500 12.5px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: var(--dsh-text, #1d1b26);
}
#${LAYER_ID} .pet-menu button {
  display: block;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
#${LAYER_ID} .pet-menu button:hover { background: rgba(120, 110, 140, 0.12); }
#${LAYER_ID} .pet-menu .pet-menu-hint {
  padding: 5px 9px 3px;
  font-size: 11px;
  opacity: 0.55;
}

/* —— 举牌：纯 div + CSS 画的小牌子，不引入图片 —— */
#${LAYER_ID} .pet-sign {
  position: absolute;
  right: calc(100% - 16px);
  bottom: 36%;
  box-sizing: border-box;
  width: 76px;
  padding: 6px 7px 5px;
  border-radius: 8px;
  background: linear-gradient(180deg, #fffdf4 0%, #ffeec8 100%);
  border: 1.5px solid rgba(158, 118, 42, 0.55);
  box-shadow: 0 2px 0 rgba(150, 112, 44, 0.26), 0 9px 18px rgba(40, 26, 8, 0.16);
  color: #55401a;
  font: 800 12px/1.35 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  letter-spacing: 0.4px;
  text-align: center;
  white-space: nowrap;
  opacity: 0;
  transform: translate(8px, 10px) rotate(-9deg) scale(0.78);
  transform-origin: 100% 92%;
  transition: opacity 150ms ease, transform 260ms cubic-bezier(0.2, 1.45, 0.35, 1);
  pointer-events: none;
  will-change: transform, opacity;
}
#${LAYER_ID} .pet-sign.is-on {
  opacity: 1;
  transform: translate(0, 0) rotate(-3deg) scale(1);
}
/* 左边贴边时把牌子换到右侧（牌杆跟着换边） */
#${LAYER_ID} .pet-sign.is-flip {
  right: auto;
  left: calc(100% - 16px);
  transform: translate(-8px, 10px) rotate(9deg) scale(0.78);
  transform-origin: 0% 92%;
}
#${LAYER_ID} .pet-sign.is-flip.is-on {
  transform: translate(0, 0) rotate(3deg) scale(1);
}
/* 牌杆：从牌子下沿斜着指向手 */
#${LAYER_ID} .pet-sign::after {
  content: '';
  position: absolute;
  right: -2px;
  bottom: -11px;
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: linear-gradient(180deg, #dcb467, #a87c2e);
  transform: rotate(16deg);
  transform-origin: 50% 0;
}
#${LAYER_ID} .pet-sign.is-flip::after {
  right: auto;
  left: -2px;
  transform: rotate(-16deg);
}

/* —— 生气「💢」：挪到头顶右上方，随跺脚节奏抖 —— */
#${LAYER_ID} .pet-anger {
  position: absolute;
  right: 9%;
  top: 5%;
  font-size: 19px;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  will-change: transform, opacity;
  filter: drop-shadow(0 1px 2px rgba(120, 20, 30, 0.25));
}

/* —— 关键帧 —— */
@keyframes dsh-pet-sway {
  0%, 100% { transform: rotate(-0.85deg); }
  50%      { transform: rotate(0.85deg); }
}
@keyframes dsh-pet-breathe {
  0%, 100% { transform: translateY(0) scale(1, 1); }
  50%      { transform: translateY(-1.1px) scale(1.005, 1.016); }
}
@keyframes dsh-pet-act-wave {
  0%   { transform: rotate(0deg) translateY(0); }
  12%  { transform: rotate(-6.5deg) translateY(-2px); }
  27%  { transform: rotate(4.5deg) translateY(0); }
  42%  { transform: rotate(-6deg) translateY(-2px); }
  57%  { transform: rotate(4deg) translateY(0); }
  72%  { transform: rotate(-3deg) translateY(-1px); }
  100% { transform: rotate(0deg) translateY(0); }
}
@keyframes dsh-pet-act-nod {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  18%      { transform: translateY(4px) rotate(1.6deg); }
  34%      { transform: translateY(-2px) rotate(-0.6deg); }
  52%      { transform: translateY(4px) rotate(1.6deg); }
  70%      { transform: translateY(-1px) rotate(-0.3deg); }
}
/* —— 原地转整圈：绕 Y 轴真的翻一圈（3D 透视），不是 2D 打转 ——
   0/100% 是同一帧；50% 正好转到背面，90/270 度附近侧面对镜头（最窄处），
   影子宽度跟着 cos 的角度收窄，看起来才像"整个人转过去"。 */
@keyframes dsh-pet-act-spin {
  0%   { transform: perspective(760px) translateY(0) rotateY(0deg) scale(1, 1); }
  7%   { transform: perspective(760px) translateY(calc(var(--act-down, 1) * 2px)) rotateY(-16deg) scale(1.035, 0.962); }
  18%  { transform: perspective(760px) translateY(calc(var(--act-up, 1) * -2px)) rotateY(42deg) scale(0.995, 1.01); }
  50%  { transform: perspective(760px) translateY(calc(var(--act-up, 1) * -4px)) rotateY(180deg) scale(0.955, 1.028); }
  82%  { transform: perspective(760px) translateY(calc(var(--act-up, 1) * -2px)) rotateY(318deg) scale(0.99, 1.012); }
  92%  { transform: perspective(760px) translateY(calc(var(--act-down, 1) * 1.5px)) rotateY(352deg) scale(1.022, 0.98); }
  100% { transform: perspective(760px) translateY(0) rotateY(360deg) scale(1, 1); }
}
@keyframes dsh-pet-shadow-spin {
  0%, 100% { transform: scale(1); opacity: 1; }
  7%       { transform: scale(1.07, 0.88); opacity: 1; }
  18%      { transform: scale(0.82, 0.96); opacity: 0.9; }
  50%      { transform: scale(0.6, 1); opacity: 0.78; }
  82%      { transform: scale(0.82, 0.96); opacity: 0.9; }
  92%      { transform: scale(1.05, 0.9); opacity: 1; }
}

/* —— 伸懒腰：先蹲一下蓄力，再拔高、纵向拉长 ~11%，最后回弹收势 ——
   和旧版相比不是只加 5% 的 scaleY，而是整段"站起来"的形变（配合 --act-up 留出头顶空间）。 */
@keyframes dsh-pet-act-stretch {
  0%   { transform: translateY(0) scale(1, 1) rotate(0deg); }
  10%  { transform: translateY(calc(var(--act-down, 1) * 3px)) scale(1.055, 0.94) rotate(0deg); }
  32%  { transform: translateY(calc(var(--act-up, 1) * -12px)) scale(0.925, 1.09) rotate(calc(var(--pet-face, -1) * -1.1deg)); }
  52%  { transform: translateY(calc(var(--act-up, 1) * -17px)) scale(0.915, 1.115) rotate(calc(var(--pet-face, -1) * -1.8deg)); }
  68%  { transform: translateY(calc(var(--act-up, 1) * -15px)) scale(0.92, 1.10) rotate(calc(var(--pet-face, -1) * -1.4deg)); }
  84%  { transform: translateY(calc(var(--act-down, 1) * 2px)) scale(1.022, 0.972) rotate(calc(var(--pet-face, -1) * 0.5deg)); }
  93%  { transform: translateY(calc(var(--act-up, 1) * -1.5px)) scale(0.998, 1.004) rotate(0deg); }
  100% { transform: translateY(0) scale(1, 1) rotate(0deg); }
}
@keyframes dsh-pet-shadow-stretch {
  0%, 100% { transform: scale(1); opacity: 1; }
  10%      { transform: scale(1.08, 0.84); opacity: 1; }
  40%      { transform: scale(0.72, 0.94); opacity: 0.72; }
  68%      { transform: scale(0.74, 0.95); opacity: 0.76; }
  84%      { transform: scale(1.06, 0.88); opacity: 1; }
}
@keyframes dsh-pet-act-hop {
  0%   { transform: translateY(0) scale(1, 1); }
  16%  { transform: translateY(calc(var(--act-down, 1) * 2px)) scale(1.05, 0.95); }
  46%  { transform: translateY(calc(var(--act-up, 1) * -26px)) scale(0.985, 1.02); }
  66%  { transform: translateY(0) scale(1.055, 0.945); }
  82%  { transform: translateY(calc(var(--act-up, 1) * -5px)) scale(0.995, 1.005); }
  100% { transform: translateY(0) scale(1, 1); }
}
@keyframes dsh-pet-act-look {
  0%, 100% { transform: rotate(0deg) translateX(0); }
  15%      { transform: rotate(-5.5deg) translateX(-2px); }
  38%      { transform: rotate(-5deg) translateX(-2px); }
  62%      { transform: rotate(5deg) translateX(2px); }
  84%      { transform: rotate(2.5deg) translateX(1px); }
}
@keyframes dsh-pet-act-yawn {
  0%, 100% { transform: translateY(0) scale(1, 1) rotate(0deg); }
  25%      { transform: translateY(3px) scale(1.012, 0.982) rotate(1.6deg); }
  55%      { transform: translateY(-4px) scale(0.99, 1.032) rotate(2.6deg); }
  80%      { transform: translateY(1px) scale(1, 0.99) rotate(1deg); }
}
@keyframes dsh-pet-shadow-hop {
  0%   { transform: scale(1); opacity: 1; }
  46%  { transform: scale(0.66); opacity: 0.55; }
  66%  { transform: scale(1.06); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes dsh-pet-fx {
  0%   { opacity: 0; transform: translate(-50%, 0) scale(0.35) rotate(0deg); }
  18%  { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), var(--dy)) scale(1.12) rotate(var(--rot)); }
}

#${LAYER_ID} .pet-rig.act-wave    { animation: dsh-pet-act-wave 1.5s ease-in-out; }
#${LAYER_ID} .pet-rig.act-nod     { animation: dsh-pet-act-nod 1.3s ease-in-out; }
#${LAYER_ID} .pet-rig.act-spin    { animation: dsh-pet-act-spin 1.4s cubic-bezier(0.42, 0.05, 0.32, 1); }
#${LAYER_ID} .pet-rig.act-stretch { animation: dsh-pet-act-stretch 2s cubic-bezier(0.36, 0.04, 0.3, 1); }
#${LAYER_ID} .pet-root.is-spinning .pet-shadow  { animation: dsh-pet-shadow-spin 1.4s cubic-bezier(0.42, 0.05, 0.32, 1); }
#${LAYER_ID} .pet-root.is-stretching .pet-shadow { animation: dsh-pet-shadow-stretch 2s cubic-bezier(0.36, 0.04, 0.3, 1); }
#${LAYER_ID} .pet-rig.act-hop     { animation: dsh-pet-act-hop 0.9s ease-out; }
#${LAYER_ID} .pet-rig.act-look    { animation: dsh-pet-act-look 1.7s ease-in-out; }
#${LAYER_ID} .pet-rig.act-yawn    { animation: dsh-pet-act-yawn 1.9s ease-in-out; }

/* —— 走路步态：一循环两步（左右各一步），680ms；横向位移由 JS 推进 root.transform ——
   680ms 是刻意的：walk 总时长 3400ms 正好 5 个整循环，停步时姿态回到循环起点，不会突然跳一下。
   --walk-lean 由 JS 按方向写成 ±2.2deg，转身时连同镜像一起翻。 */
@keyframes dsh-pet-act-walk {
  0%   { transform: translateY(0.6px) rotate(calc(var(--walk-lean, 2.2deg) - 0.4deg)) scale(1.006, 0.994); }
  25%  { transform: translateY(-2.4px) rotate(calc(var(--walk-lean, 2.2deg) + 1.5deg)) scale(0.995, 1.006); }
  50%  { transform: translateY(0.6px) rotate(calc(var(--walk-lean, 2.2deg) + 0.4deg)) scale(1.006, 0.994); }
  75%  { transform: translateY(-2.4px) rotate(calc(var(--walk-lean, 2.2deg) - 1.5deg)) scale(0.995, 1.006); }
  100% { transform: translateY(0.6px) rotate(calc(var(--walk-lean, 2.2deg) - 0.4deg)) scale(1.006, 0.994); }
}
@keyframes dsh-pet-shadow-step {
  0%, 50%, 100% { transform: scale(1.02, 1); opacity: 1; }
  22%, 72%      { transform: scale(0.84, 0.74); opacity: 0.6; }
}
#${LAYER_ID} .pet-rig.act-walk { animation: dsh-pet-act-walk 680ms ease-in-out infinite; }
#${LAYER_ID} .pet-root.is-walking .pet-shadow { animation: dsh-pet-shadow-step 680ms ease-in-out infinite; }

/* —— 招手举牌：抬手（抬手 0–14%，举稳 14–86%，收回 86–100%） —— */
@keyframes dsh-pet-act-sign {
  0%   { transform: translateY(0) rotate(0deg) scale(1, 1); }
  10%  { transform: translateY(-3px) rotate(calc(var(--pet-face, -1) * 2.6deg)) scale(0.995, 1.008); }
  16%  { transform: translateY(-5px) rotate(calc(var(--pet-face, -1) * 3.4deg)) scale(0.992, 1.012); }
  24%  { transform: translateY(-4.2px) rotate(calc(var(--pet-face, -1) * 3deg)) scale(0.994, 1.01); }
  72%  { transform: translateY(-4.8px) rotate(calc(var(--pet-face, -1) * 3.3deg)) scale(0.993, 1.011); }
  80%  { transform: translateY(-3.6px) rotate(calc(var(--pet-face, -1) * 2.6deg)) scale(0.996, 1.006); }
  90%  { transform: translateY(1.2px) rotate(calc(var(--pet-face, -1) * -0.5deg)) scale(1.004, 0.997); }
  100% { transform: translateY(0) rotate(0deg) scale(1, 1); }
}
#${LAYER_ID} .pet-rig.act-sign { animation: dsh-pet-act-sign 2s ease-in-out; }

/* —— 生气跺脚：两下重踏 + 余怒的小抖 —— */
@keyframes dsh-pet-act-stomp {
  0%   { transform: translate(0, 0) rotate(0deg) scale(1, 1); }
  6%   { transform: translate(0, calc(var(--act-down, 1) * 7px)) rotate(-0.8deg) scale(1.045, 0.935); }
  11%  { transform: translate(0, calc(var(--act-up, 1) * -1.5px)) rotate(0.6deg) scale(0.99, 1.012); }
  17%  { transform: translate(0, calc(var(--act-down, 1) * 6px)) rotate(0.9deg) scale(1.04, 0.94); }
  23%  { transform: translate(0, 0) rotate(-0.5deg) scale(0.995, 1.005); }
  30%  { transform: translate(-1.6px, calc(var(--act-down, 1) * 1px)) rotate(-1.3deg) scale(1, 1); }
  37%  { transform: translate(1.6px, 0) rotate(1.3deg) scale(1, 1); }
  44%  { transform: translate(-1.2px, 0) rotate(-1deg) scale(1, 1); }
  51%  { transform: translate(1px, 0) rotate(0.8deg) scale(1, 1); }
  58%  { transform: translate(-0.6px, 0) rotate(-0.4deg) scale(1, 1); }
  65%  { transform: translate(0, calc(var(--act-down, 1) * 5px)) rotate(0.4deg) scale(1.03, 0.95); }
  72%  { transform: translate(0, 0) rotate(-0.2deg) scale(0.995, 1.005); }
  86%  { transform: translate(0, 0) rotate(0deg) scale(1.002, 0.998); }
  100% { transform: translate(0, 0) rotate(0deg) scale(1, 1); }
}
#${LAYER_ID} .pet-rig.act-stomp { animation: dsh-pet-act-stomp 1.5s cubic-bezier(0.33, 0.9, 0.4, 1); }
@keyframes dsh-pet-shadow-stomp {
  0%        { transform: scale(1); opacity: 1; }
  6%        { transform: scale(1.14, 0.8); opacity: 1; }
  11%       { transform: scale(0.96, 1.02); opacity: 1; }
  17%       { transform: scale(1.12, 0.82); opacity: 1; }
  24%, 100% { transform: scale(1); opacity: 1; }
}
#${LAYER_ID} .pet-root.is-stomping .pet-shadow { animation: dsh-pet-shadow-stomp 1.5s ease-out; }

/* 「💢」：弹出来 → 抖动 → 飘走 */
@keyframes dsh-pet-anger {
  0%   { opacity: 0; transform: translate(3px, 8px) scale(0.4) rotate(-18deg); }
  9%   { opacity: 1; transform: translate(0, -3px) scale(1.2) rotate(-6deg); }
  16%  { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); }
  26%  { transform: translate(-1px, 0) scale(1.02) rotate(-5deg); }
  36%  { transform: translate(1.5px, 0) scale(1) rotate(4deg); }
  46%  { transform: translate(-1px, 0) scale(1.02) rotate(-2deg); }
  58%  { transform: translate(1px, 0) scale(1) rotate(2deg); }
  76%  { opacity: 1; transform: translate(0, 0) scale(1.05) rotate(0deg); }
  100% { opacity: 0; transform: translate(3px, -7px) scale(0.85) rotate(7deg); }
}
#${LAYER_ID} .pet-root.is-stomping .pet-anger { animation: dsh-pet-anger 1.5s ease-out both; }

/* —— 坐下伸腿：先沉下去、坐稳（呼吸同时放慢）、3s 后撑起来 —— */
@keyframes dsh-pet-act-sit {
  0%   { transform: translateY(0) rotate(0deg) scale(1, 1); }
  10%  { transform: translateY(calc(var(--act-up, 1) * -2px)) rotate(calc(var(--pet-face, -1) * -0.4deg)) scale(0.995, 1.008); }
  24%  { transform: translateY(calc(var(--act-down, 1) * 10px)) rotate(calc(var(--pet-face, -1) * 1.9deg)) scale(1.032, 0.95); }
  31%  { transform: translateY(calc(var(--act-down, 1) * 8.2px)) rotate(calc(var(--pet-face, -1) * 1.5deg)) scale(1.02, 0.966); }
  40%  { transform: translateY(calc(var(--act-down, 1) * 9.2px)) rotate(calc(var(--pet-face, -1) * 1.75deg)) scale(1.025, 0.96); }
  62%  { transform: translateY(calc(var(--act-down, 1) * 8.9px)) rotate(calc(var(--pet-face, -1) * 1.7deg)) scale(1.023, 0.962); }
  74%  { transform: translateY(calc(var(--act-down, 1) * 9.3px)) rotate(calc(var(--pet-face, -1) * 1.8deg)) scale(1.026, 0.959); }
  86%  { transform: translateY(calc(var(--act-up, 1) * -1.6px)) rotate(calc(var(--pet-face, -1) * -0.45deg)) scale(0.992, 1.008); }
  93%  { transform: translateY(calc(var(--act-down, 1) * 2px)) rotate(calc(var(--pet-face, -1) * 0.3deg)) scale(1.004, 0.996); }
  100% { transform: translateY(0) rotate(0deg) scale(1, 1); }
}
#${LAYER_ID} .pet-rig.act-sit { animation: dsh-pet-act-sit 3s cubic-bezier(0.42, 0.05, 0.35, 1); }
@keyframes dsh-pet-shadow-sit {
  0%, 10% { transform: scale(1); opacity: 1; }
  24%, 80% { transform: scale(1.09, 0.84); opacity: 1; }
  92%, 100% { transform: scale(1); opacity: 1; }
}
#${LAYER_ID} .pet-root.is-sitting .pet-shadow { animation: dsh-pet-shadow-sit 3s ease-in-out; }
/* 坐着的时候呼吸慢一点、浅一点（人坐着就是更松弛） */
#${LAYER_ID} .pet-root.is-sitting .pet-bob { animation-duration: 6.4s; }
#${LAYER_ID} .pet-root.is-sitting .pet-sway { animation-duration: 9.5s; }

/* —— 转身 180°：转过去、背对镜头停约 1 秒、再转回来 ——
   不是整圈：0→190°（过冲一点）→180° 停住 → 再正向转回 0°；
   与 spin 的区别是"停在背面"，而且整个过程只有 rig 的 3D 变换，窗口坐标不动。 */
@keyframes dsh-pet-act-turn {
  0%   { transform: perspective(820px) translateX(0) rotateY(0deg) scale(1, 1); }
  6%   { transform: perspective(820px) translateX(-2px) rotateY(-14deg) scale(1.03, 0.97); }
  20%  { transform: perspective(820px) translateX(-1px) rotateY(98deg) scale(0.99, 1.006); }
  30%  { transform: perspective(820px) translateX(3px) rotateY(190deg) scale(1.018, 0.988); }
  35%  { transform: perspective(820px) translateX(2px) rotateY(180deg) scale(1, 1); }
  48%  { transform: perspective(820px) translateX(1px) translateY(calc(var(--act-down, 1) * 1.5px)) rotateY(177deg) scale(1.006, 0.994); }
  60%  { transform: perspective(820px) translateX(3px) translateY(0) rotateY(183deg) scale(1, 1); }
  70%  { transform: perspective(820px) translateX(2px) rotateY(180deg) scale(1.004, 0.997); }
  79%  { transform: perspective(820px) translateX(2px) rotateY(110deg) scale(1.012, 0.99); }
  92%  { transform: perspective(820px) translateX(-2px) rotateY(-7deg) scale(1.018, 0.987); }
  100% { transform: perspective(820px) translateX(0) rotateY(0deg) scale(1, 1); }
}
@keyframes dsh-pet-shadow-turn {
  0%, 35%, 70%, 100% { transform: scale(1); opacity: 1; }
  20%  { transform: scale(0.72, 0.98); opacity: 0.82; }
  30%  { transform: scale(1.02, 0.98); opacity: 1; }
  79%  { transform: scale(0.72, 0.98); opacity: 0.82; }
  92%  { transform: scale(1.02, 0.98); opacity: 1; }
}
#${LAYER_ID} .pet-rig.act-turn { animation: dsh-pet-act-turn 3s cubic-bezier(0.44, 0.03, 0.34, 1); }
#${LAYER_ID} .pet-root.is-turning .pet-shadow { animation: dsh-pet-shadow-turn 3s cubic-bezier(0.44, 0.03, 0.34, 1); }

/* —— 原地后空翻：绕 X 轴向后翻一整圈 + 一条小弧线，落回原地 ——
   位移只写在 rig 的 transform 里，root 的窗口坐标完全不动；--act-up 保证贴顶时不飞出去。
   旋转中心改到腰（50% 50%）：rig 平时以脚底为原点做压缩，绕脚底翻跟头会让身体
   整个甩到脚下（贴底时直接被窗口裁掉），绕腰翻才是"原地后空翻"。 */
@keyframes dsh-pet-act-flip {
  0%   { transform: perspective(900px) translateY(0) rotateX(0deg) scale(1, 1); }
  8%   { transform: perspective(900px) translateY(calc(var(--act-down, 1) * 5px)) rotateX(8deg) scale(1.06, 0.93); }
  16%  { transform: perspective(900px) translateY(calc(var(--act-up, 1) * -10px)) rotateX(-34deg) scale(0.96, 1.03); }
  32%  { transform: perspective(900px) translateY(calc(var(--act-up, 1) * -34px)) rotateX(-132deg) scale(0.9, 0.96); }
  48%  { transform: perspective(900px) translateY(calc(var(--act-up, 1) * -42px)) rotateX(-230deg) scale(0.92, 0.94); }
  64%  { transform: perspective(900px) translateY(calc(var(--act-up, 1) * -26px)) rotateX(-320deg) scale(0.96, 1.02); }
  74%  { transform: perspective(900px) translateY(calc(var(--act-up, 1) * -2px)) rotateX(-360deg) scale(1, 1); }
  83%  { transform: perspective(900px) translateY(calc(var(--act-down, 1) * 4px)) rotateX(-360deg) scale(1.05, 0.945); }
  92%  { transform: perspective(900px) translateY(calc(var(--act-up, 1) * -2px)) rotateX(-360deg) scale(0.996, 1.006); }
  100% { transform: perspective(900px) translateY(0) rotateX(-360deg) scale(1, 1); }
}
@keyframes dsh-pet-shadow-flip {
  0%   { transform: scale(1); opacity: 1; }
  8%   { transform: scale(1.1, 0.8); opacity: 1; }
  32%  { transform: scale(0.62, 0.9); opacity: 0.5; }
  50%  { transform: scale(0.5, 0.86); opacity: 0.34; }
  68%  { transform: scale(0.72, 0.92); opacity: 0.6; }
  83%  { transform: scale(1.12, 0.82); opacity: 1; }
  92%  { transform: scale(0.97, 1.02); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
#${LAYER_ID} .pet-rig.act-flip { animation: dsh-pet-act-flip 1.2s cubic-bezier(0.4, 0.02, 0.32, 1); transform-origin: 50% 50%; }
#${LAYER_ID} .pet-root.is-flipping .pet-shadow { animation: dsh-pet-shadow-flip 1.2s cubic-bezier(0.4, 0.02, 0.32, 1); }

/* —— 滑步：往空的一侧滑出半个身位，回头看一眼，再滑回来 ——
   --slide-dir / --slide-dist 由 JS 按窗口剩余空间写；位移只发生在 rig 上，窗口坐标不变。 */
@keyframes dsh-pet-act-slide {
  0%   { transform: translateX(0) translateY(0) rotate(0deg) scale(1, 1); }
  10%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px) * 0.18)) translateY(calc(var(--act-up, 1) * -4px)) rotate(calc(var(--slide-dir, 1) * 2.6deg)) scale(0.99, 1.012); }
  26%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px))) translateY(0) rotate(calc(var(--slide-dir, 1) * 3.4deg)) scale(1.012, 0.988); }
  34%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px) * 0.96)) translateY(0) rotate(calc(var(--slide-dir, 1) * 2.2deg)) scale(1, 1); }
  46%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px) * 0.98)) translateY(calc(var(--act-up, 1) * -1.5px)) rotate(calc(var(--slide-dir, 1) * -1.4deg)) scale(1.006, 0.994); }
  58%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px) * 0.96)) translateY(0) rotate(calc(var(--slide-dir, 1) * 1.1deg)) scale(1, 1); }
  66%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px))) translateY(0) rotate(calc(var(--slide-dir, 1) * 2.8deg)) scale(1.006, 0.994); }
  84%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px) * 0.12)) translateY(calc(var(--act-up, 1) * -5px)) rotate(calc(var(--slide-dir, 1) * 1.8deg)) scale(0.99, 1.012); }
  93%  { transform: translateX(calc(var(--slide-dir, 1) * -2px)) translateY(calc(var(--act-down, 1) * 2px)) rotate(calc(var(--slide-dir, 1) * -0.6deg)) scale(1.012, 0.988); }
  100% { transform: translateX(0) translateY(0) rotate(0deg) scale(1, 1); }
}
@keyframes dsh-pet-shadow-slide {
  0%, 100% { transform: translateX(0) scale(1); opacity: 1; }
  10%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px) * 0.18)) scale(0.94, 0.9); opacity: 0.9; }
  26%, 66% { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px))) scale(1.02, 0.94); opacity: 1; }
  84%  { transform: translateX(calc(var(--slide-dir, 1) * var(--slide-dist, 30px) * 0.12)) scale(0.92, 0.88); opacity: 0.92; }
}
#${LAYER_ID} .pet-rig.act-slide { animation: dsh-pet-act-slide 2.3s cubic-bezier(0.36, 0.05, 0.3, 1); }
#${LAYER_ID} .pet-root.is-sliding .pet-shadow { animation: dsh-pet-shadow-slide 2.3s cubic-bezier(0.36, 0.05, 0.3, 1); }

/* —— 干饭人设：饿了张望 / 大吃 / 满足摸肚子 / 放屁 / 饭后小盹 ——
   全部只动 rig / look 的形变，root 的窗口坐标始终不动；粒子与气团都是临时 DOM。 */
@keyframes dsh-pet-hungry-look {
  0%, 100% { transform: rotate(0deg) translateX(0); }
  18%, 38% { transform: rotate(-4.2deg) translateX(-1.6px); }
  60%, 82% { transform: rotate(4.2deg) translateX(1.6px); }
}
#${LAYER_ID} .pet-root.is-hungry .pet-look {
  animation: dsh-pet-hungry-look 1.5s ease-in-out;
}

@keyframes dsh-pet-eat-head {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  24%      { transform: translateY(4px) rotate(1.5deg); }
  52%      { transform: translateY(-1.5px) rotate(-0.7deg); }
  76%      { transform: translateY(3px) rotate(1.1deg); }
}
#${LAYER_ID} .pet-root.is-eating .pet-look {
  animation: dsh-pet-eat-head 640ms ease-in-out infinite;
}

@keyframes dsh-pet-act-eating {
  0%, 100% { transform: perspective(720px) translateY(0) rotateX(0deg) scale(1, 1); }
  10%      { transform: perspective(720px) translateY(calc(var(--act-down, 1) * 3px)) rotateX(3.2deg) scale(1.018, 0.976); }
  24%      { transform: perspective(720px) translateY(calc(var(--act-up, 1) * -2px)) rotateX(-2.4deg) scale(0.988, 1.014); }
  38%      { transform: perspective(720px) translateY(calc(var(--act-down, 1) * 2.6px)) rotateX(2.8deg) scale(1.014, 0.982); }
  54%      { transform: perspective(720px) translateY(calc(var(--act-up, 1) * -1.6px)) rotateX(-2deg) scale(0.99, 1.012); }
  68%      { transform: perspective(720px) translateY(calc(var(--act-down, 1) * 2.2px)) rotateX(2.4deg) scale(1.012, 0.985); }
  84%      { transform: perspective(720px) translateY(calc(var(--act-up, 1) * -1.2px)) rotateX(-1.4deg) scale(0.994, 1.008); }
}
#${LAYER_ID} .pet-rig.act-eating {
  animation: dsh-pet-act-eating 3.2s cubic-bezier(0.42, 0.05, 0.35, 1);
}

@keyframes dsh-pet-act-full {
  /* 打嗝的「身体短促上顶」写在这一段首帧：进食链里的满足段就是嗝打出来的那一下，
     playBurp() 在链里不再往 rig 上叠第二个动画，避免两层 transform 打架。 */
  0%, 100% { transform: translateY(0) scale(1, 1); }
  10%      { transform: translateY(calc(var(--act-up, 1) * -4px)) scale(0.974, 1.032); }
  22%      { transform: translateY(calc(var(--act-down, 1) * 1px)) scale(1.055, 0.93); }
  34%      { transform: translateY(0) scale(0.985, 1.018); }
  52%      { transform: translateY(0) scale(1.035, 0.966); }
  70%      { transform: translateY(0) scale(0.995, 1.006); }
  84%      { transform: translateY(0) scale(1.012, 0.99); }
}
#${LAYER_ID} .pet-rig.act-full {
  animation: dsh-pet-act-full 700ms cubic-bezier(0.34, 1.4, 0.48, 1);
}

/* 打嗝：身体上顶（act-burp）+ 头/下巴快速前倾（is-burping 下的 look 关键帧）。
   头与身体分开动，才像"嗝"了一下，而不是整个人缩了一下。 */
@keyframes dsh-pet-act-burp {
  0%   { transform: translateY(0) scale(1, 1); }
  14%  { transform: translateY(calc(var(--act-up, 1) * -4px)) scale(0.972, 1.034); }
  27%  { transform: translateY(calc(var(--act-down, 1) * 1px)) scale(1.03, 0.97); }
  42%  { transform: translateY(calc(var(--act-up, 1) * -1.2px)) scale(0.996, 1.005); }
  58%  { transform: translateY(0) scale(1.007, 0.994); }
  100% { transform: translateY(0) scale(1, 1); }
}
#${LAYER_ID} .pet-rig.act-burp {
  animation: dsh-pet-act-burp 620ms cubic-bezier(0.24, 1.12, 0.36, 1);
}
@keyframes dsh-pet-burp-head {
  0%   { transform: translateY(0) rotate(0deg); }
  12%  { transform: translateY(1.2px) rotate(calc(var(--pet-face, -1) * 2.8deg)); }
  27%  { transform: translateY(2.6px) rotate(calc(var(--pet-face, -1) * -1.5deg)); }
  46%  { transform: translateY(0.8px) rotate(calc(var(--pet-face, -1) * 0.7deg)); }
  100% { transform: translateY(0) rotate(0deg); }
}
#${LAYER_ID} .pet-root.is-burping .pet-look {
  animation: dsh-pet-burp-head 620ms cubic-bezier(0.3, 0.9, 0.4, 1);
}

/* 口部气团：一小团偏白灰的暖气，先扩一下再往上飘淡；600ms 内演完，JS 660ms 删 DOM。
   与放屁的绿黄气团刻意拉开颜色/尺寸/位置。 */
#${LAYER_ID} .pet-burp {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
/* 朝向镜像：照片朝右时嘴在另一侧，整层以 root 中线（55px）翻过去 */
#${LAYER_ID} .pet-root.is-face-right .pet-burp { transform: scaleX(-1); }
#${LAYER_ID} .pet-burp b {
  position: absolute;
  left: 18px;
  top: 70px;
  width: 28px;
  height: 22px;
  margin: 0;
  transform-origin: 82% 76%; /* 以靠嘴的一角为轴，喷出来时像从嘴里鼓出去 */
  animation: dsh-pet-burp-cloud 600ms cubic-bezier(0.18, 0.66, 0.32, 1) forwards;
  will-change: transform, opacity;
  opacity: 0;
}
#${LAYER_ID} .pet-burp svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
#${LAYER_ID} .pet-burp svg path {
  fill: rgba(240, 246, 255, 0.88);
  stroke: rgba(78, 102, 152, 0.82);
  stroke-width: 1.35;
  vector-effect: non-scaling-stroke;
  paint-order: stroke;
}
#${LAYER_ID} .pet-burp svg {
  filter: drop-shadow(0 1px 1.5px rgba(24, 34, 58, 0.38));
}
/* 两缕细气流（短弧线）跟在云团后上方，给出"从嘴里喷出"的方向 */
#${LAYER_ID} .pet-burp .pet-burp-wisp {
  position: absolute;
  width: 14px;
  height: 12px;
  overflow: visible;
  animation: dsh-pet-burp-wisp 520ms ease-out forwards;
  opacity: 0;
}
#${LAYER_ID} .pet-burp .pet-burp-wisp path {
  fill: none;
  stroke: rgba(244, 248, 255, 0.85);
  stroke-width: 1.1;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
@keyframes dsh-pet-burp-cloud {
  0%   { opacity: 0; transform: translate(2px, 3px) scale(0.25); }
  16%  { opacity: 0.98; transform: translate(0, 0) scale(0.9); }
  42%  { opacity: 0.92; transform: translate(-3px, -4px) scale(1.02); }
  72%  { opacity: 0.45; transform: translate(-7px, -10px) scale(1.12); }
  100% { opacity: 0; transform: translate(-11px, -16px) scale(1.2); }
}
@keyframes dsh-pet-burp-wisp {
  0%   { opacity: 0; transform: translate(4px, 3px) scale(0.4); }
  22%  { opacity: 0.9; }
  100% { opacity: 0; transform: translate(-8px, -10px) scale(1.05); }
}
#${LAYER_ID} .pet-burp.is-quiet b,
#${LAYER_ID} .pet-burp.is-quiet .pet-burp-wisp {
  animation: none !important;
  opacity: 0.9;
  transform: none;
}

@keyframes dsh-pet-act-fart {
  /* 2–3px 快速横向抖 + 竖向轻弹：读数上是"噗"的一下，不是整个人跳 */
  0%, 100% { transform: translate(0, 0) scale(1, 1); }
  9%   { transform: translate(0, calc(var(--act-up, 1) * -3px)) scale(0.982, 1.026); }
  18%  { transform: translate(calc(var(--pet-face, -1) * -2.2px), 0) scale(1.028, 0.974); }
  25%  { transform: translate(calc(var(--pet-face, -1) * 2.2px), calc(var(--act-up, 1) * -1px)) scale(1.002, 0.998); }
  33%  { transform: translate(calc(var(--pet-face, -1) * -1.7px), 0) rotate(calc(var(--pet-face, -1) * 0.5deg)); }
  41%  { transform: translate(calc(var(--pet-face, -1) * 1.6px), 0) rotate(calc(var(--pet-face, -1) * -0.45deg)); }
  50%  { transform: translate(calc(var(--pet-face, -1) * -1px), 0); }
  64%  { transform: translate(0, 0) scale(1.006, 0.994); }
  80%  { transform: translate(0, 0) scale(0.999, 1.001); }
}
#${LAYER_ID} .pet-rig.act-fart {
  animation: dsh-pet-act-fart 900ms ease-out;
}
/* 影子被气浪推一下：轻微变宽变淡，跟身体抖动同拍 */
@keyframes dsh-pet-shadow-fart {
  0%   { transform: scale(1); opacity: 1; }
  18%  { transform: scale(1.06, 0.9); opacity: 0.96; }
  34%  { transform: scale(1.16, 0.84); opacity: 0.9; }
  52%  { transform: scale(1.1, 0.88); opacity: 0.94; }
  100% { transform: scale(1); opacity: 1; }
}
#${LAYER_ID} .pet-root.is-farting.is-fx-motion .pet-shadow {
  animation: dsh-pet-shadow-fart 900ms ease-out;
}

/* 眼睛一眯：半透明的闭眼图叠上去，比完全闭眼轻 */
#${LAYER_ID} .pet-root.is-squinting .pet-lid {
  opacity: 0.62;
  transition-duration: 90ms;
}

/* —— 放屁 v2：身后地面「喷气 → 扩散 → 上飘 → 淡出」 ——
   第一段 3 个喷口（i，数量被既有 G2 断言锁定为 3）从地面斜喷；第二段 5 团气（b）
   就地扩散后上飘；底下叠一个地面冲击环（span.pet-fart-ring），才像从地上喷出来。
   容器由 JS 在 2.6s 时整块删掉，子元素不单独挂定时器。 */
#${LAYER_ID} .pet-puff {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
#${LAYER_ID} .pet-root.is-face-right .pet-puff { transform: scaleX(-1); }
#${LAYER_ID} .pet-puff .pet-fart-ring {
  position: absolute;
  left: 88px;
  bottom: 5px;
  width: 30px;
  height: 10px;
  margin-left: -15px;
  border-radius: 50%;
  background: radial-gradient(ellipse at 50% 50%, rgba(232, 255, 186, 0.9), rgba(186, 228, 104, 0.5) 54%, rgba(150, 200, 80, 0) 78%);
  opacity: 0;
  animation: dsh-pet-fart-ring 520ms ease-out forwards;
  will-change: transform, opacity;
}
@keyframes dsh-pet-fart-ring {
  0%   { opacity: 0; transform: scale(0.25, 0.5); }
  20%  { opacity: 0.9; transform: scale(1.2, 1.05); }
  100% { opacity: 0; transform: scale(2.5, 1.55); }
}
#${LAYER_ID} .pet-puff i {
  position: absolute;
  left: 88px;
  bottom: 12px;
  width: var(--jet-size, 9px);
  height: var(--jet-size, 9px);
  margin-left: calc(var(--jet-size, 9px) / -2);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgba(246, 255, 210, 0.98), rgba(196, 234, 112, 0.88) 44%, rgba(126, 176, 62, 0.42) 68%, rgba(126, 176, 62, 0) 80%);
  opacity: 0;
  animation: dsh-pet-fart-jet var(--jet-dur, 460ms) cubic-bezier(0.14, 0.72, 0.3, 1) var(--jet-delay, 0ms) forwards;
  will-change: transform, opacity;
}
@keyframes dsh-pet-fart-jet {
  0%   { opacity: 0; transform: translate(0, 0) scale(0.22); }
  16%  { opacity: 0.96; transform: translate(calc(var(--jet-dx, 14px) * 0.3), calc(var(--jet-dy, -16px) * 0.3)) scale(1.1); }
  55%  { opacity: 0.62; transform: translate(calc(var(--jet-dx, 14px) * 0.72), calc(var(--jet-dy, -16px) * 0.72)) scale(1.25); }
  100% { opacity: 0; transform: translate(var(--jet-dx, 14px), var(--jet-dy, -16px)) scale(0.72); }
}
#${LAYER_ID} .pet-puff b {
  position: absolute;
  left: 88px;
  bottom: 14px;
  width: var(--cloud-size, 16px);
  height: var(--cloud-size, 16px);
  margin-left: calc(var(--cloud-size, 16px) / -2);
  border-radius: 50%;
  background: radial-gradient(circle at 36% 32%, rgba(250, 255, 224, 0.96), rgba(214, 241, 132, 0.8) 38%, rgba(160, 206, 82, 0.5) 60%, rgba(150, 196, 70, 0.16) 75%, rgba(150, 196, 70, 0) 84%);
  filter: blur(0.3px);
  opacity: 0;
  animation: dsh-pet-fart-cloud var(--cloud-dur, 1800ms) cubic-bezier(0.16, 0.6, 0.3, 1) var(--cloud-delay, 0ms) forwards;
  will-change: transform, opacity;
}
@keyframes dsh-pet-fart-cloud {
  0%   { opacity: 0; transform: translate(0, 0) scale(0.3); }
  14%  { opacity: 0.9; transform: translate(calc(var(--cloud-dx, 12px) * 0.2), calc(var(--cloud-dy, -58px) * 0.12)) scale(0.62); }
  40%  { opacity: 0.8; transform: translate(calc(var(--cloud-dx, 12px) * 0.45), calc(var(--cloud-dy, -58px) * 0.44)) scale(1.15); }
  72%  { opacity: 0.46; transform: translate(calc(var(--cloud-dx, 12px) * 0.85), calc(var(--cloud-dy, -58px) * 0.82)) scale(1.85); }
  100% { opacity: 0; transform: translate(var(--cloud-dx, 12px), var(--cloud-dy, -58px)) scale(2.35); }
}
/* reduced 的静态气团：独立 class（.pet-puff-static），不落进既有 "reduced 下 .pet-puff 必须为 0" 的断言 */
#${LAYER_ID} .pet-puff-static {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
#${LAYER_ID} .pet-root.is-face-right .pet-puff-static { transform: scaleX(-1); }
#${LAYER_ID} .pet-puff-static b {
  position: absolute;
  left: 88px;
  bottom: 10px;
  width: 18px;
  height: 14px;
  margin-left: -9px;
  border-radius: 50%;
  background: radial-gradient(circle at 36% 32%, rgba(250, 255, 224, 0.95), rgba(214, 241, 132, 0.78) 40%, rgba(160, 206, 82, 0.46) 62%, rgba(150, 196, 70, 0) 82%);
  opacity: 0.8;
}

/* —— 真·食物实体：嘴边叼着的鸡腿/饭团/汉堡（透明 PNG 插画，不是 emoji/方块）——
   挂在 .pet-look 里：脑袋上下点的时候，嘴里那口吃的会跟着一起动；这里只叠咀嚼抖动。
   关键帧周期 640ms，与 dsh-pet-eat-head 同拍（24% / 76% 就是咬下去的两口）。 */
#${LAYER_ID} .pet-food {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
#${LAYER_ID} .pet-root.is-face-right .pet-food { transform: scaleX(-1); }
#${LAYER_ID} .pet-food-chew {
  position: absolute;
  left: var(--food-left, 9px);
  top: var(--food-top, 60px);
  width: var(--food-w, 40px);
  height: var(--food-h, 34.5px);
  transform-origin: 64% 58%; /* 以靠嘴的一侧为轴，咬起来像被嚼 */
  animation: dsh-pet-food-chew 640ms ease-in-out infinite;
  will-change: transform;
}
#${LAYER_ID} .pet-food-pop {
  width: 100%;
  height: 100%;
  transform-origin: 62% 58%;
  animation: dsh-pet-food-in 200ms cubic-bezier(0.2, 1.3, 0.4, 1) both;
}
#${LAYER_ID} .pet-food-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* 素材骨节在右下：镜像后骨节朝外（远离嘴），看起来像被她叼着 */
  transform: scaleX(-1) rotate(var(--food-rot, -9deg));
  filter: drop-shadow(0 1.2px 1.2px rgba(30, 24, 18, 0.32));
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
@keyframes dsh-pet-food-in {
  0%   { opacity: 0; transform: scale(0.24); }
  62%  { opacity: 1; transform: scale(1.08); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes dsh-pet-food-chew {
  0%, 100% { transform: rotate(0deg) scale(1, 1); }
  24%      { transform: rotate(-2.6deg) scale(1.035, 0.955); }
  52%      { transform: rotate(1.7deg) scale(0.985, 1.022); }
  76%      { transform: rotate(-1.9deg) scale(1.022, 0.976); }
}
@keyframes dsh-pet-food-gulp {
  0%   { opacity: 1; transform: scale(1); }
  28%  { opacity: 1; transform: scale(1.14); }
  100% { opacity: 0; transform: scale(0.08); }
}
#${LAYER_ID} .pet-food.is-eaten .pet-food-pop {
  animation: dsh-pet-food-gulp 300ms cubic-bezier(0.55, 0, 0.75, 0.35) forwards;
}
/* reduced：不跑关键帧，食物静态停在嘴边，到点由 JS 直接摘掉 */
#${LAYER_ID} .pet-food.is-quiet .pet-food-chew,
#${LAYER_ID} .pet-food.is-quiet .pet-food-pop {
  animation: none !important;
  transform: none;
  opacity: 1;
}

/* —— 真·屎实体：放屁尾段从臀部落下 → 落地压扁 → 弹一下 → 停留 2–3s → 淡出 ——
   插在 .pet-rig 之前：宠物身体压在它上面，看着像从背后掉出来，且永远在脸以下。 */
#${LAYER_ID} .pet-poop {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
#${LAYER_ID} .pet-root.is-face-right .pet-poop { transform: scaleX(-1); }
#${LAYER_ID} .pet-poop-drop {
  position: absolute;
  left: var(--poop-left, 74px);
  top: var(--poop-top, 176px);
  width: var(--poop-w, 32px);
  height: var(--poop-h, 32px);
  transform-origin: 50% 94%; /* 以底部为轴：落地压扁、弹起都贴着地面 */
  animation: dsh-pet-poop-drop 920ms linear both;
  will-change: transform, opacity;
}
#${LAYER_ID} .pet-poop-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 1.4px 1.2px rgba(46, 28, 14, 0.34));
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
#${LAYER_ID} .pet-poop-shadow {
  position: absolute;
  left: calc(var(--poop-left, 74px) + var(--poop-w, 32px) / 2 - 16px);
  top: calc(var(--poop-top, 176px) + var(--poop-h, 32px) - 6px);
  width: 32px;
  height: 8px;
  border-radius: 50%;
  background: radial-gradient(ellipse at 50% 50%, rgba(44, 34, 26, 0.46), rgba(44, 34, 26, 0.18) 56%, rgba(44, 34, 26, 0) 76%);
  opacity: 0;
  animation: dsh-pet-poop-shadow 920ms linear both;
  will-change: transform, opacity;
}
/* 下落段加速（gravity），落地后的弹跳段再缓出 */
@keyframes dsh-pet-poop-drop {
  0%   { opacity: 0; transform: translateY(-24px) scale(0.62, 0.62); animation-timing-function: cubic-bezier(0.45, 0.05, 0.85, 0.6); }
  10%  { opacity: 1; transform: translateY(-23px) scale(0.78, 0.78); animation-timing-function: cubic-bezier(0.55, 0.02, 0.9, 0.55); }
  56%  { opacity: 1; transform: translateY(-1px) scale(1, 1); animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1); }
  62%  { opacity: 1; transform: translateY(2.5px) scale(1.15, 0.84); animation-timing-function: cubic-bezier(0.3, 0, 0.5, 1); }
  70%  { opacity: 1; transform: translateY(-7px) scale(0.95, 1.06); animation-timing-function: cubic-bezier(0.5, 0, 0.6, 1); }
  78%  { opacity: 1; transform: translateY(0.8px) scale(1.06, 0.94); animation-timing-function: cubic-bezier(0.3, 0, 0.5, 1); }
  86%  { opacity: 1; transform: translateY(-2.4px) scale(0.995, 1.008); }
  94%  { opacity: 1; transform: translateY(0) scale(1.008, 0.994); }
  100% { opacity: 1; transform: translateY(0) scale(1, 1); }
}
@keyframes dsh-pet-poop-shadow {
  0%   { opacity: 0; transform: scale(0.42, 0.5); }
  56%  { opacity: 0.55; transform: scale(0.76, 0.8); }
  62%  { opacity: 0.95; transform: scale(1.12, 0.9); }
  70%  { opacity: 0.5; transform: scale(0.74, 0.78); }
  78%  { opacity: 0.92; transform: scale(1.04, 0.96); }
  86%  { opacity: 0.72; transform: scale(0.93, 0.95); }
  100% { opacity: 0.82; transform: scale(1, 1); }
}
#${LAYER_ID} .pet-poop.is-fading {
  animation: dsh-pet-poop-fade 520ms ease-in forwards;
}
@keyframes dsh-pet-poop-fade {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}
/* reduced：没有下落/弹跳，静态贴在地面，到点由 JS 直接摘掉 */
#${LAYER_ID} .pet-poop.is-quiet .pet-poop-drop {
  animation: none !important;
  transform: none;
  opacity: 1;
}
#${LAYER_ID} .pet-poop.is-quiet .pet-poop-shadow {
  animation: none !important;
  transform: none;
  opacity: 0.8;
}

/* 饭后小盹：哈欠 → 闭眼 → 头垂 → 呼噜气泡；与 20 分钟自然睡互不占用状态 */
#${LAYER_ID} .pet-root.is-meal-yawn .pet-lid,
#${LAYER_ID} .pet-root.is-meal-nap .pet-lid {
  opacity: 1;
  transition-duration: 300ms;
}
#${LAYER_ID} .pet-root.is-meal-yawn .pet-rig {
  animation: dsh-pet-act-yawn 900ms ease-in-out;
}
#${LAYER_ID} .pet-root.is-meal-nap .pet-look {
  transform: translateY(2px) rotate(-1.5deg);
}
#${LAYER_ID} .pet-root.is-meal-nap .pet-sway { animation-duration: 12s; }
#${LAYER_ID} .pet-root.is-meal-nap .pet-bob  { animation-duration: 8.4s; }

/* 睡着：摆幅变大、呼吸变慢、身子微微塌下来 */
#${LAYER_ID} .pet-root.is-sleeping .pet-sway { animation-duration: 12.5s; }
#${LAYER_ID} .pet-root.is-sleeping .pet-bob  { animation-duration: 8.5s; }
#${LAYER_ID} .pet-root.is-sleeping .pet-look { transform: translateY(1px) rotate(-1.1deg); }

/* 降级：关掉所有循环、动作关键帧与新增动作的收放 */
@media (prefers-reduced-motion: reduce) {
  #${LAYER_ID} .pet-sway,
  #${LAYER_ID} .pet-bob,
  #${LAYER_ID} .pet-rig,
  #${LAYER_ID} .pet-look,
  #${LAYER_ID} .pet-anger,
  #${LAYER_ID} .pet-root.is-jumping .pet-shadow,
  #${LAYER_ID} .pet-root.is-walking .pet-shadow,
  #${LAYER_ID} .pet-root.is-stomping .pet-shadow,
  #${LAYER_ID} .pet-root.is-sitting .pet-shadow,
  #${LAYER_ID} .pet-root.is-spinning .pet-shadow,
  #${LAYER_ID} .pet-root.is-turning .pet-shadow,
  #${LAYER_ID} .pet-root.is-flipping .pet-shadow,
  #${LAYER_ID} .pet-root.is-stretching .pet-shadow,
  #${LAYER_ID} .pet-root.is-sliding .pet-shadow {
    animation: none !important;
  }
  /* 新动作退化成"静态姿态切换"：只留一帧轻微形变，不位移、不旋转（JS 也会内联同一组值） */
  #${LAYER_ID} .pet-rig.act-spin    { transform: scale(0.975, 1.015); }
  #${LAYER_ID} .pet-rig.act-turn    { transform: scale(1.005, 0.995); }
  #${LAYER_ID} .pet-rig.act-flip    { transform: scale(1.025, 0.975); }
  #${LAYER_ID} .pet-rig.act-stretch { transform: scale(0.955, 1.055); }
  #${LAYER_ID} .pet-rig.act-slide   { transform: scale(1.015, 0.985); }
  /* 干饭人设：只换静态姿势 + 气泡文字，不位移、不飘、不弹 */
  #${LAYER_ID} .pet-root.is-hungry .pet-look { transform: rotate(-3deg); }
  #${LAYER_ID} .pet-root.is-eating .pet-look { transform: rotate(1.2deg); }
  #${LAYER_ID} .pet-root.is-meal-nap .pet-look { transform: rotate(-1.5deg); }
  #${LAYER_ID} .pet-rig.act-eating { transform: scale(1.015, 0.985); }
  #${LAYER_ID} .pet-rig.act-full   { transform: scale(1.03, 0.97); }
  #${LAYER_ID} .pet-rig.act-fart   { transform: scale(1.012, 0.988); }
  #${LAYER_ID} .pet-rig.act-burp   { transform: none; }
  /* 打嗝/放屁的视觉在 reduced 下只留静态气团：关键帧全部停掉，不位移 */
  #${LAYER_ID} .pet-root.is-burping .pet-look,
  #${LAYER_ID} .pet-root.is-farting .pet-shadow,
  #${LAYER_ID} .pet-burp b,
  #${LAYER_ID} .pet-burp .pet-burp-wisp,
  #${LAYER_ID} .pet-puff i,
  #${LAYER_ID} .pet-puff b,
  #${LAYER_ID} .pet-puff .pet-fart-ring,
  #${LAYER_ID} .pet-puff-static b,
  #${LAYER_ID} .pet-food-chew,
  #${LAYER_ID} .pet-food-pop,
  #${LAYER_ID} .pet-poop-drop,
  #${LAYER_ID} .pet-poop-shadow {
    animation: none !important;
  }
  #${LAYER_ID} .pet-puff i { display: none !important; }
  #${LAYER_ID} .pet-look,
  #${LAYER_ID} .pet-art,
  #${LAYER_ID} .pet-art img,
  #${LAYER_ID} .pet-sign,
  #${LAYER_ID} .pet-bubble,
  #${LAYER_ID} .pet-blush,
  #${LAYER_ID} .pet-lid,
  #${LAYER_ID} .pet-shadow {
    transition: none !important;
  }
  #${LAYER_ID} .pet-fx i { animation: none !important; opacity: 0 !important; }
}
`

    /** 与 dsh-network-panel 相同的 base 解析：反代前缀下相对路径才对。 */
    function pageBaseUrl() {
      const base = new URL(document.baseURI)
      base.search = ''
      base.hash = ''
      if (!base.pathname.endsWith('/')) {
        const index = base.pathname.lastIndexOf('/')
        base.pathname = index >= 0 ? base.pathname.slice(0, index + 1) : '/'
      }
      return base
    }

    function assetUrl(file) {
      return new URL(`${ASSET_BASE}${file}`, pageBaseUrl()).href
    }

    function installStyles() {
      const existing = document.getElementById(STYLE_ID)
      if (existing !== null) return existing
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.append(style)
      return style
    }

    function readPosition() {
      try {
        const raw = window.localStorage.getItem(POS_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (typeof parsed?.left !== 'number' || typeof parsed?.top !== 'number') return null
        return parsed
      } catch {
        return null
      }
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max))
    }

    function pick(list) {
      return list[Math.floor(Math.random() * list.length)]
    }

    /**
     * 按 ACTION_WEIGHTS 加权抽一个动作（不是等概率）。exclude 用来排除上一个
     * 动作，保证不会连着抽中同一个；排除后按剩余权重重新归一。
     */
    function pickWeighted(exclude = null) {
      const keys = exclude === null ? ACTIONS : ACTIONS.filter((key) => key !== exclude)
      let total = 0
      for (const key of keys) total += ACTION_WEIGHTS[key] ?? 0
      let roll = Math.random() * total
      for (const key of keys) {
        roll -= ACTION_WEIGHTS[key] ?? 0
        if (roll < 0) return key
      }
      return keys[0]
    }

    function defaultPosition() {
      return {
        left: Math.max(MARGIN, window.innerWidth - PET_W - MARGIN - 6),
        top: Math.max(MARGIN, window.innerHeight - PET_H - MARGIN - 8),
      }
    }

    function currentWorkspaceId(service) {
      // startSession 省略 workspaceId 时会落在"当前/最近"工作区；只有在服务
      // 真的暴露了当前工作区 id 时才显式传，传错比不传更糟。
      try {
        if (typeof service.getCurrentWorkspaceId === 'function') {
          const id = service.getCurrentWorkspaceId()
          if (typeof id === 'string' && id.length > 0) return id
        }
        if (typeof service.currentWorkspaceId === 'string' && service.currentWorkspaceId.length > 0) {
          return service.currentWorkspaceId
        }
      } catch {
        // 服务实现变了也不该让点击失败
      }
      return undefined
    }

    function mount(ctx) {
      if (document.getElementById(LAYER_ID) !== null) return () => {}

      installStyles()

      const reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
      let reduced = reducedQuery?.matches === true

      // —— DOM ——
      const layer = document.createElement('div')
      layer.id = LAYER_ID

      const root = document.createElement('div')
      root.className = 'pet-root'
      root.setAttribute('role', 'button')
      root.setAttribute('tabindex', '0')
      root.setAttribute('aria-label', '桌面宠物：单击卖萌，右键有菜单')

      const rig = document.createElement('div')
      rig.className = 'pet-rig'
      const sway = document.createElement('div')
      sway.className = 'pet-sway'
      const bob = document.createElement('div')
      bob.className = 'pet-bob'
      const look = document.createElement('div')
      look.className = 'pet-look'
      const art = document.createElement('div')
      art.className = 'pet-art'

      const imgBody = document.createElement('img')
      imgBody.className = 'pet-img is-on'
      imgBody.alt = ''
      imgBody.draggable = false
      imgBody.decoding = 'async'
      imgBody.src = assetUrl(ART.body)

      const imgLid = document.createElement('img')
      imgLid.className = 'pet-lid'
      imgLid.alt = ''
      imgLid.draggable = false
      imgLid.decoding = 'async'
      imgLid.src = assetUrl(ART.eyesClosed)

      const blush = document.createElement('div')
      blush.className = 'pet-blush'

      /** 举牌：纯 DOM + CSS 的小牌子（平时 opacity:0 躺着，不占布局）。 */
      const sign = document.createElement('div')
      sign.className = 'pet-sign'
      sign.setAttribute('aria-hidden', 'true')

      /** 生气时头顶的「💢」。 */
      const anger = document.createElement('div')
      anger.className = 'pet-anger'
      anger.setAttribute('aria-hidden', 'true')
      anger.textContent = '💢'

      art.append(imgBody, imgLid, blush)
      look.append(art)

      /* —— 形象（现在跟网页里那只宠物走，不再写死真人照片） —— */
      let avatarKey = ''
      let petNick = ''

      /* 静态路由只放行 assets/ 下的「平铺文件名」（index.js:40 的 FILE_NAME 不允许斜杠），
         所以形象图统一叫 av-<key>.png，别塞进子目录。 */
      function avatarFile(key) {
        return assetUrl(`av-${key}.png`)
      }

      function petUid() {
        try {
          let uid = window.localStorage.getItem(PET_UID_KEY)
          if (uid === null || uid === '') {
            uid = 'u' + Math.random().toString(36).slice(2, 8)
            window.localStorage.setItem(PET_UID_KEY, uid)
          }
          return uid
        } catch {
          return 'local'
        }
      }

      const PET_AVATAR_MANUAL = 'dsh.pet.avatar.manual'

      function manualPicked() {
        try {
          return window.localStorage.getItem(PET_AVATAR_MANUAL) === '1'
        } catch {
          return false
        }
      }

      /** 网页里用户自己上传的那张图（IndexedDB 里的 blob，桥页转成 dataURL）。 */
      function applyAvatarData(dataUrl, nick) {
        if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) return false
        if (manualPicked()) return false
        if (nick) petNick = nick
        if (imgBody.getAttribute('src') === dataUrl) return true
        avatarKey = null
        imgBody.src = dataUrl
        imgLid.style.display = 'none'
        root.classList.add('is-avatar')
        root.setAttribute('aria-label',
          `桌面宠物：${petNick || '我的宠物'}（单击去比武台，右键有菜单）`)
        return true
      }

      const RIG_SRC = imgBody.getAttribute('src') || assetUrl('pet-head.png')
      function showRig(nick) {
        if (nick) petNick = nick
        avatarKey = null
        if (RIG_SRC) imgBody.setAttribute('src', RIG_SRC)
        imgLid.style.display = ''
        root.classList.remove('is-avatar')
        root.setAttribute('aria-label',
          `桌面宠物：${nick || '我的宠物'}（单击去比武台，右键有菜单）`)
        try { window.localStorage.removeItem(PET_AVATAR_KEY) } catch { /* 忽略 */ }
        return true
      }

      function applyAvatar(key, nick, fromPage) {
        if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(AVATARS, key)) return false
        // 用户在右键菜单里亲手选过形象，就不再被网页那边覆盖回去
        if (fromPage === true && manualPicked()) return false
        if (nick) petNick = nick
        if (key === avatarKey) return true
        avatarKey = key
        imgBody.src = avatarFile(key)
        // 形象自带眼睛，真人版那张闭眼蒙版要收起来，否则会盖一片灰
        imgLid.style.display = 'none'
        root.classList.add('is-avatar')
        root.setAttribute('aria-label',
          `桌面宠物：${petNick || AVATARS[key]}（单击去比武台，右键有菜单）`)
        try {
          window.localStorage.setItem(PET_AVATAR_KEY, key)
        } catch {
          // 隐私模式存不了就算了
        }
        return true
      }

      function openArena() {
        const url = `${PET_ARENA}?uid=${encodeURIComponent(petUid())}`
        let win = null
        try {
          win = window.open(url, '_blank', 'noopener,noreferrer')
        } catch {
          win = null
        }
        say(win ? '比武台见！' : `打不开就手动开 ${PET_ARENA}`, 2600)
      }

      /** 桥页拿不到图时，回退到本机 pet-hub 里存的那张（桌宠与网页可能不在同一个浏览器 profile）。 */
      let hostAvatarMisses = 0
      function fetchHostAvatar(nick, fallback) {
        if (manualPicked()) return
        let settled = false
        const giveUp = () => {
          if (settled) return
          settled = true
          if (typeof fallback === 'function') fallback()
        }
        try {
          fetch('/ds-pet/api/pet-avatar?uid=current', { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.blob() : null))
            .then((blob) => {
              if (!blob) {
                // 网页那边还没把图同步上来：一分钟后再试，最多 30 次
                hostAvatarMisses += 1
                if (hostAvatarMisses <= 30) {
                  window.setTimeout(() => fetchHostAvatar(nick, null), 60000)
                }
                return giveUp()
              }
              const fr = new FileReader()
              fr.onload = () => {
                const url = String(fr.result || '')
                settled = true
                if (!applyAvatarData(url, nick)) fallback()
              }
              fr.onerror = giveUp
              fr.readAsDataURL(blob)
            })
            .catch(giveUp)
        } catch {
          giveUp()
        }
        window.setTimeout(giveUp, 2500)
      }

      /** 问一句网页：你那只宠物是谁？拿到就换形象，拿不到保持 whale。 */
      function askPageForPet() {
        let done = false
        const onAnswer = (event) => {
          if (event.origin !== 'http://127.0.0.1:8917') return
          const data = event.data
          if (data === null || typeof data !== 'object' || data.type !== 'bo-pet') return
          done = true
          window.removeEventListener('message', onAnswer)
          if (!applyAvatarData(data.avatarData, data.nick)) {
            fetchHostAvatar(data.nick, () => applyAvatar(data.avatarKey, data.nick, true))
          }
          frame.remove()
        }
        const frame = document.createElement('iframe')
        frame.src = PET_BRIDGE
        frame.setAttribute('aria-hidden', 'true')
        frame.tabIndex = -1
        frame.style.cssText =
          'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
        frame.addEventListener('load', () => {
          const ask = () => {
            try {
              frame.contentWindow?.postMessage({ type: 'bo-pet-who' }, 'http://127.0.0.1:8917')
            } catch {
              // 桥页没起来就算了
            }
          }
          ask()
          window.setTimeout(ask, 350)
        })
        window.addEventListener('message', onAnswer)
        document.body.append(frame)
        // 桥页 3 秒还不回话（服务没开 / 被 CSP 挡）就收掉，一点不影响宠物本体
        window.setTimeout(() => {
          if (!done) {
            window.removeEventListener('message', onAnswer)
            frame.remove()
            fetchHostAvatar(null, () => { /* 两处都没有就保持原样 */ })
          }
        }, 3000)
      }

      function petLog(extra) {
        try {
          fetch('http://127.0.0.1:8925/api/boot-log', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(Object.assign({ at: Date.now() }, extra || {})),
          }).catch(() => {})
        } catch { /* 忽略 */ }
      }

      async function bootAvatar() {
        // 1) 直连本机中继（CORS *，不依赖插件路由鉴权）
        try {
          const idr = await fetch('http://127.0.0.1:8925/api/identity', { cache: 'no-store' })
          const idj = await idr.json()
          if (idj && idj.ok && idj.bound) {
            const pjr = await fetch('http://127.0.0.1:8925/api/pet-profile?uid=' + encodeURIComponent(idj.uid), { cache: 'no-store' })
            const pjj = await pjr.json()
            const pet = pjj && pjj.pet
            petLog({ via: 'relay', bound: true, pet: pet || null })
            if (pet) {
              if (pet.avatarKey === 'girl') { showRig(pet.nick); return }
              if (applyAvatar(pet.avatarKey, pet.nick, true)) return
            }
          } else {
            petLog({ via: 'relay', bound: false })
          }
        } catch (e) { petLog({ via: 'relay', err: String((e && e.message) || e) }) }
        // 2) 插件自己的接口
        for (const url of ['/ds-pet/api/my-pet', '/my-pet']) {
          try {
            const r = await fetch(url, { cache: 'no-store' })
            const j = await r.json()
            petLog({ url, status: r.status, ok: !!(j && j.ok), pet: (j && j.pet) || null })
            if (j && j.ok && j.pet) {
              const k = j.pet.avatarKey
              if (k === 'girl') { showRig(j.pet.nick); return }
              if (applyAvatar(k, j.pet.nick, true)) return
            }
          } catch (e) { petLog({ url, err: String(e && e.message || e) }) }
        }
        try {
          const remembered = window.localStorage.getItem(PET_AVATAR_KEY)
          if (remembered) applyAvatar(remembered)
        } catch { /* 忽略 */ }
      }
      bootAvatar()
      askPageForPet()
      // 牌子和怒气标记挂在 bob 上：跟着呼吸/摆动/动作一起动，但不跟视线偏移走
      bob.append(look, sign, anger)
      sway.append(bob)
      rig.append(sway)

      const shadow = document.createElement('div')
      shadow.className = 'pet-shadow'
      const fx = document.createElement('div')
      fx.className = 'pet-fx'
      const bubble = document.createElement('div')
      bubble.className = 'pet-bubble'

      root.append(shadow, rig, fx, bubble)
      layer.append(root)

      let imageBroken = false
      imgBody.addEventListener('error', () => {
        imageBroken = true
        say('宠物图没加载出来，重启一下 DSH 试试', 5200)
      })

      // 视线跟随的状态要先声明：applyPosition() 会清缓存（TDZ）。
      let rectCache = null
      let lookRaf = 0
      let lastPointer = null

      // —— 位置：用 transform 移动，不碰 left/top（不重排） ——
      const saved = readPosition()
      const start = saved === null ? defaultPosition() : saved
      let position = {
        left: clamp(start.left, 0, window.innerWidth - PET_W),
        top: clamp(start.top, 0, window.innerHeight - PET_H),
      }
      function applyPosition() {
        root.style.transform = `translate3d(${Math.round(position.left)}px, ${Math.round(position.top)}px, 0)`
        rectCache = null
      }
      applyPosition()

      // —— 气泡 ——
      let bubbleTimer = 0
      // 气泡贴着窗口边缘时会被裁掉：横向平移回来；纵向优先翻到宠物脚下，
      // 两边都放不下时用 --bub-dy 把气泡整体压回视口内（垂直 clamp）。
      function fitBubble() {
        const pad = 8
        const rect = root.getBoundingClientRect()
        const vw = window.innerWidth || 1280
        const vh = window.innerHeight || 800
        const bw = bubble.offsetWidth || 0
        const bh = bubble.offsetHeight || 0
        if (!bw || !bh) return
        const centerX = rect.left + rect.width / 2
        const left = centerX - bw / 2
        let dx = 0
        if (left < pad) dx = pad - left
        else if (left + bw > vw - pad) dx = vw - pad - (left + bw)

        const aboveTop = rect.top - bh - 6
        const belowTop = rect.bottom - 2
        const aboveRoom = aboveTop - pad
        const belowRoom = vh - pad - (belowTop + bh)
        const useBelow = aboveRoom < 0 && belowRoom > aboveRoom
        bubble.classList.toggle('is-below', useBelow)
        let dy = 0
        if (!useBelow && aboveRoom < 0) dy = -aboveRoom
        else if (useBelow && belowRoom < 0) dy = belowRoom

        bubble.style.setProperty('--bub-dx', `${Math.round(dx)}px`)
        bubble.style.setProperty('--bub-dy', `${Math.round(dy)}px`)
        bubble.style.setProperty('--bub-arrow', `${Math.round(clamp(centerX - (left + dx), 14, bw - 14))}px`)
      }
      function say(text, ms = BUBBLE_MS) {
        bubble.textContent = text
        bubble.classList.add('is-on')
        fitBubble()
        window.clearTimeout(bubbleTimer)
        bubbleTimer = window.setTimeout(() => bubble.classList.remove('is-on'), ms)
      }

      // —— 表情 ——
      let mood = 'normal'
      function setMood(next) {
        mood = next
        for (const name of MOODS) root.classList.toggle(`mood-${name}`, name === next)
        if (next === 'sleepy') sleepNow(true)
      }

      // —— 状态机 ——
      let sleeping = false
      let dragging = false
      let acting = false
      let actSeq = 0
      let actTimerId = 0
      let hidden = false

      let sleepTimer = 0
      let actionTimer = 0
      let actionTimerId = 0

      // —— 干饭人设：独立于 20 分钟自然睡的状态机 ——
      // 所有阶段都用 feedAfter() 排队，stopFeeding() 一次作废；这样拖动 / 播下一个动作 /
      // 隐藏 / 切到 reduced-motion 都会立刻把整条链停干净。
      let feeding = false
      let feedStage = ''
      let feedSeq = 0
      let feedTimers = []
      let feedHistory = []
      let feedStartedAt = 0
      let feedOptions = {}
      let fartCount = 0
      let puffEl = null
      let puffQuietTimer = 0
      let burpEl = null
      let burpBodyTimer = 0
      let burpCleanTimer = 0
      let fartFxTimer = 0
      let fartPuffTimer = 0
      // 真·食物 / 真·屎两个实体的 DOM 与计时器：各自独立，stopFeeding 一次收干净
      let foodEl = null
      let foodFile = ''
      let poopEl = null
      let poopDelayTimer = 0
      let poopFadeTimer = 0
      let poopCleanTimer = 0
      let hungerTimer = 0
      let hungerShowTimer = 0
      let hungerRounds = 0
      let mealNap = false
      let mealNapSeq = 0
      let napTimers = []
      let napZzzTimer = 0

      function clearFeedTimers() {
        for (const id of feedTimers) window.clearTimeout(id)
        feedTimers = []
      }

      function feedAfter(ms, fn) {
        const seq = feedSeq
        const id = window.setTimeout(() => {
          feedTimers = feedTimers.filter((item) => item !== id)
          if (seq !== feedSeq) return
          fn()
        }, ms)
        feedTimers.push(id)
        return id
      }

      function setFeedStage(stage) {
        feedStage = stage
        feedHistory.push({ stage, at: performance.now() })
      }

      function removePuff() {
        window.clearTimeout(puffQuietTimer)
        window.clearTimeout(fartPuffTimer)
        puffQuietTimer = 0
        fartPuffTimer = 0
        if (puffEl === null) return
        puffEl.remove()
        puffEl = null
      }

      /** 打嗝收口：DOM、身体/头部 class、两个定时器一次清完；可反复调用。 */
      function removeBurp() {
        window.clearTimeout(burpBodyTimer)
        window.clearTimeout(burpCleanTimer)
        burpBodyTimer = 0
        burpCleanTimer = 0
        if (burpEl !== null) {
          burpEl.remove()
          burpEl = null
        }
        root.classList.remove('is-burping')
        rig.classList.remove('act-burp')
      }

      const FEED_POSES = {
        eating: 'scale(1.015, 0.985)',
        full: 'scale(1.03, 0.97)',
        fart: 'scale(1.012, 0.988)',
        nap: 'scale(1, 1)',
      }

      /**
       * reduced-motion 下不挂关键帧，只留一个静态姿势。
       * 真实系统里媒体查询也会关掉动画；这里再加一层内联兜底，测试台模拟 reduced 时同样成立。
       */
      /** 清掉 reduced 降级时写在 rig/look 上的内联姿势与 animation:none。
       *  这套内联会压过 class 动画；切回 no-preference 或喂食链结束时不清，
       *  宠物会一直保持压扁且所有动作动画被抑制（验收 BUG-1）。 */
      function clearPoseInline() {
        rig.style.animation = ''
        rig.style.transform = ''
        look.style.animation = ''
        look.style.transform = ''
      }

      function applyFeedVisual(stage) {
        if (!reduced) {
          rig.style.animation = ''
          rig.style.transform = ''
          look.style.animation = ''
          return
        }
        rig.style.animation = 'none'
        rig.style.transform = FEED_POSES[stage] ?? ''
        look.style.animation = 'none'
        look.style.transform = stage === 'nap'
          ? 'translateY(2px) rotate(-1.5deg)'
          : stage === 'hungry'
            ? 'rotate(-3deg)'
            : stage === 'eating'
              ? 'rotate(1.2deg)'
              : ''
      }

      function clearEatClasses() {
        root.classList.remove('is-eating', 'is-full', 'is-farting', 'is-squinting')
        rig.classList.remove('act-eating', 'act-full', 'act-fart')
        if (reduced) applyFeedVisual('')
      }

      function stopFeeding() {
        clearFeedTimers()
        feedSeq += 1
        feeding = false
        feedStage = ''
        clearEatClasses()
        removePuff()
        // 食物/屎是进食链的实体表现，打断时一起收：不留半个鸡腿在嘴边、一坨屎在桌上
        removeFood()
        removePoop()
      }

      /**
       * 放屁气团（v2）：身后地面「喷气 → 扩散 → 上飘 → 淡出」。
       * - 3 个 i = 喷口（数量被既有测试断言锁定为 3，改数量要同步改 test.js）
       * - 5 个 b = 气团
       * - span.pet-fart-ring = 地面冲击环
       * 整个容器由 FART_PUFF_MS 的 feedAfter 删除，子元素不单独挂定时器。
       * reduced-motion：只生成 18px 静态气团（.pet-puff-static），200ms 后删，不落 .pet-puff。
       */
      function showFartPuff() {
        if (imageBroken) return
        removePuff()
        const el = document.createElement('div')
        el.setAttribute('aria-hidden', 'true')
        if (reduced) {
          el.className = 'pet-puff-static'
          el.append(document.createElement('b'))
          root.insertBefore(el, bubble)
          puffEl = el
          puffQuietTimer = window.setTimeout(() => {
            puffQuietTimer = 0
            if (puffEl === el) removePuff()
          }, QUIET_FX_MS)
          return
        }
        el.className = 'pet-puff'
        const ring = document.createElement('span')
        ring.className = 'pet-fart-ring'
        el.append(ring)
        for (let i = 0; i < 3; i += 1) {
          const jet = document.createElement('i')
          jet.style.setProperty('--jet-size', `${(7 + Math.random() * 4).toFixed(1)}px`)
          jet.style.setProperty('--jet-dx', `${(9 + Math.random() * 9).toFixed(1)}px`)
          jet.style.setProperty('--jet-dy', `${(-10 - Math.random() * 9).toFixed(1)}px`)
          jet.style.setProperty('--jet-delay', `${i * 55}ms`)
          jet.style.setProperty('--jet-dur', `${(360 + Math.random() * 90).toFixed(0)}ms`)
          el.append(jet)
        }
        for (let i = 0; i < 5; i += 1) {
          const cloud = document.createElement('b')
          // 五团气要「散开」而不是叠成一坨：横向漂移逐团加大，延迟也更紧凑。
          cloud.style.setProperty('--cloud-size', `${(12 + Math.random() * 8).toFixed(1)}px`)
          cloud.style.setProperty('--cloud-dx', `${(2 + i * 4 + Math.random() * 10).toFixed(1)}px`)
          cloud.style.setProperty('--cloud-dy', `${(-50 - Math.random() * 34).toFixed(1)}px`)
          cloud.style.setProperty('--cloud-delay', `${50 + i * 45}ms`)
          cloud.style.setProperty('--cloud-dur', `${(1450 + Math.random() * 350).toFixed(0)}ms`)
          el.append(cloud)
        }
        root.insertBefore(el, bubble)
        puffEl = el
      }

      /**
       * 真·食物实体：在嘴边「弹」出来，随咀嚼抖，最后 300ms 缩小消失（＝咽下去）。
       * 挂在 .pet-look 里（不是 root）：脑袋上下点的时候，嘴里那口吃的跟着一起动，
       * 不然会出现「头在嚼、食物悬在原地」的穿帮。DOM 由进食链在 EAT_MS 收口。
       */
      function showFood() {
        if (imageBroken) return false
        removeFood()
        const item = pick(FOOD_ASSETS)
        const el = document.createElement('div')
        el.className = reduced ? 'pet-food is-quiet' : 'pet-food'
        el.setAttribute('aria-hidden', 'true')
        el.style.setProperty('--food-w', `${item.w}px`)
        el.style.setProperty('--food-h', `${item.h}px`)
        el.style.setProperty('--food-left', `${item.left}px`)
        el.style.setProperty('--food-top', `${item.top}px`)
        el.style.setProperty('--food-rot', `${item.rot}deg`)
        const chew = document.createElement('div')
        chew.className = 'pet-food-chew'
        const pop = document.createElement('div')
        pop.className = 'pet-food-pop'
        const img = document.createElement('img')
        img.className = 'pet-food-img'
        img.alt = ''
        img.draggable = false
        img.decoding = 'async'
        img.src = assetUrl(item.file)
        // 单张食物素材挂了只收掉这一口，不能把整只宠物判成 imageBroken
        img.addEventListener('error', () => {
          if (foodEl === el) removeFood()
        })
        pop.append(img)
        chew.append(pop)
        el.append(chew)
        look.append(el)
        foodEl = el
        foodFile = item.file
        return true
      }

      function removeFood() {
        if (foodEl !== null) {
          foodEl.remove()
          foodEl = null
        }
        foodFile = ''
      }

      /** 最后一口：缩到 0 消失（"吃进去了"）。 */
      function gulpFood() {
        if (foodEl !== null) foodEl.classList.add('is-eaten')
      }

      /**
       * 真·屎实体：气团散去的尾段，从臀部落下 → 落地压扁 → 弹一下 → 停留 2–3s → 淡出。
       * - 坐标在 110×210 里（臀部外侧、y > 176），永远在脸以下，也永远不出 root
       * - 插在 rig 之前：宠物身体压在上面，看着像从背后掉出来的
       * - 三个计时器独立管，stopFeeding / stopExtras 一次收干净
       */
      function removePoop() {
        window.clearTimeout(poopDelayTimer)
        window.clearTimeout(poopFadeTimer)
        window.clearTimeout(poopCleanTimer)
        poopDelayTimer = 0
        poopFadeTimer = 0
        poopCleanTimer = 0
        if (poopEl !== null) {
          poopEl.remove()
          poopEl = null
        }
      }

      /** 放屁后隔 POOP_DELAY_MS 才掉：等气团先飘起来，接的是「气团散去的尾段」。 */
      function schedulePoop() {
        removePoop()
        poopDelayTimer = window.setTimeout(() => {
          poopDelayTimer = 0
          dropPoop()
        }, POOP_DELAY_MS)
      }

      function dropPoop() {
        if (hidden || dragging || imageBroken) return false
        const el = document.createElement('div')
        el.className = reduced ? 'pet-poop is-quiet' : 'pet-poop'
        el.setAttribute('aria-hidden', 'true')
        el.style.setProperty('--poop-w', `${POOP_ASSET.w}px`)
        el.style.setProperty('--poop-h', `${POOP_ASSET.h}px`)
        el.style.setProperty('--poop-left', `${POOP_ASSET.left}px`)
        el.style.setProperty('--poop-top', `${POOP_ASSET.top}px`)
        const shadow = document.createElement('div')
        shadow.className = 'pet-poop-shadow'
        const drop = document.createElement('div')
        drop.className = 'pet-poop-drop'
        const img = document.createElement('img')
        img.className = 'pet-poop-img'
        img.alt = ''
        img.draggable = false
        img.decoding = 'async'
        img.src = assetUrl(POOP_ASSET.file)
        img.addEventListener('error', () => {
          if (poopEl === el) removePoop()
        })
        drop.append(img)
        el.append(shadow, drop)
        root.insertBefore(el, rig)
        poopEl = el
        // reduced 下不做淡出（不加 is-fading），停留结束直接摘
        if (!reduced) {
          poopFadeTimer = window.setTimeout(() => {
            poopFadeTimer = 0
            if (poopEl === el) el.classList.add('is-fading')
          }, POOP_DROP_MS + POOP_STAY_MS)
        }
        poopCleanTimer = window.setTimeout(() => {
          poopCleanTimer = 0
          if (poopEl === el) removePoop()
        }, POOP_DROP_MS + POOP_STAY_MS + POOP_FADE_MS)
        return true
      }

      /**
       * 调试/自测用：把食物或屎实体的状态摊平——在不在 DOM、哪张素材、占多大一块、
       * 相对宠物盒子有没有出界（脸在 y≈45–95，屎必须落在下面）、当前不透明度。
       */
      function describeEntity(el) {
        if (el === null || !el.isConnected) return { on: false, box: null, opacity: 0 }
        const img = el.querySelector('img')
        const box = img === null ? el.getBoundingClientRect() : img.getBoundingClientRect()
        const rootBox = root.getBoundingClientRect()
        const wrapper = el.querySelector('.pet-food-pop, .pet-poop-drop')
        // 外层（.pet-poop.is-fading）与内层（.pet-food-pop 的 gulp）各有一段透明度，乘起来才是肉眼看到的
        const selfOpacity = Number(window.getComputedStyle(el).opacity)
        const innerOpacity = wrapper === null ? 1 : Number(window.getComputedStyle(wrapper).opacity)
        const opacity = selfOpacity * innerOpacity
        const round = (value) => Math.round(value * 100) / 100
        const scale = rootBox.height / PET_H
        return {
          on: true,
          file: img === null ? '' : img.getAttribute('src').split('/').pop(),
          className: el.className,
          box: {
            top: round(box.top),
            left: round(box.left),
            right: round(box.right),
            bottom: round(box.bottom),
            width: round(box.width),
            height: round(box.height),
          },
          opacity: round(Number.isFinite(opacity) ? opacity : 1),
          // y 换算回 110×210 坐标系，方便断言「在脸以下」
          topInPet: round((box.top - rootBox.top) / (scale === 0 ? 1 : scale)),
          insideRoot:
            box.left >= rootBox.left - 0.5 &&
            box.right <= rootBox.right + 0.5 &&
            box.top >= rootBox.top - 0.5 &&
            box.bottom <= rootBox.bottom + 0.5,
          insideViewport:
            box.left >= -0.5 && box.top >= -0.5 && box.right <= window.innerWidth + 0.5 && box.bottom <= window.innerHeight + 0.5,
        }
      }

      /** 只给截图：停掉实体自带的清理计时器；给 atMs 时再把各层动画冻结在这一刻。 */
      function holdEntity(el, atMs) {
        if (el === null) return false
        window.clearTimeout(poopFadeTimer)
        window.clearTimeout(poopCleanTimer)
        poopFadeTimer = 0
        poopCleanTimer = 0
        if (typeof atMs !== 'number') return true
        for (const node of [el, ...el.querySelectorAll('*')]) {
          for (const anim of node.getAnimations()) {
            anim.currentTime = atMs
            anim.pause()
          }
        }
        return true
      }

      /**
       * 打嗝（原子动作，可连播）：身体短促上顶 + 头部快速前倾 + 口部一小团气。
       * - body=false：进食链里调用（rig 上已经有 act-full 的首帧上顶，不叠第二个动画）
       * - say=false：保留调用方原有的气泡文案（进食链用「嗝～ 吃饱了」）
       * 660ms 后自动收干净；任何 stopExtras 都会立刻 removeBurp()。
       */
      function playBurp(options = {}) {
        if (hidden || dragging || imageBroken) return false
        if (sleeping) wake()
        removeBurp()
        updateActionClearance()
        const quiet = reduced === true
        const body = options.body !== false && !quiet && !feeding &&
          !rig.classList.contains('act-full') && !rig.classList.contains('act-eating')
        if (body) {
          rig.classList.add('act-burp')
          burpBodyTimer = window.setTimeout(() => {
            burpBodyTimer = 0
            rig.classList.remove('act-burp')
          }, BURP_MS + 40)
        }
        if (!quiet) root.classList.add('is-burping')
        const el = document.createElement('div')
        el.className = quiet ? 'pet-burp is-quiet' : 'pet-burp'
        el.setAttribute('aria-hidden', 'true')
        // 一团带描边的漫画式气团（SVG，跟着 110px 尺寸缩放，1x 下也能看清），
        // 嘴角为轴鼓出、向上飘；两缕短弧线补方向。
        const cloud = document.createElement('b')
        cloud.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>'
        el.append(cloud)
        if (!quiet) {
          const WISPS = [
            { x: 8, y: 62, d: 0 },
            { x: 20, y: 55, d: 70 },
          ]
          for (const wisp of WISPS) {
            const node = document.createElement('span')
            node.className = 'pet-burp-wisp'
            node.style.left = `${wisp.x}px`
            node.style.top = `${wisp.y}px`
            node.style.animationDelay = `${wisp.d}ms`
            node.innerHTML = '<svg viewBox="0 0 20 16" aria-hidden="true"><path d="M2 13C6 12 10 8 12 3"/></svg>'
            el.append(node)
          }
        }
        root.insertBefore(el, bubble)
        burpEl = el
        burpCleanTimer = window.setTimeout(() => {
          burpCleanTimer = 0
          if (burpEl === el) {
            el.remove()
            burpEl = null
          }
          root.classList.remove('is-burping')
        }, quiet ? QUIET_FX_MS : BURP_CLEAN_MS)
        if (options.say !== false) say(pick(['嗝…', '嗝～', '呃…']), 900)
        return true
      }

      /**
       * 放屁视觉（与进食链解耦，右键/调试也能单独播）：
       * act-fart（2–3px 横向抖）+ 影子扩散 + 气团；900ms 收身体类，气团由调用方按需清。
       */
      function playFartFx() {
        if (hidden || dragging || imageBroken) return false
        if (sleeping) wake()
        removeBurp()
        root.classList.add('is-farting', 'is-squinting')
        // 只有真动画（非 reduced）才让影子跟着扩散；reduced 下连影子动画都不挂
        root.classList.toggle('is-fx-motion', !reduced)
        rig.classList.add('act-fart')
        applyFeedVisual('fart')
        updateActionClearance()
        showFartPuff()
        // 真·屎：等气团先飘起来（POOP_DELAY_MS），在「气团散去的尾段」从臀部落下
        schedulePoop()
        // 气团也必须自己收：进食链里 feedAfter 会再兜一次，单独播（右键/调试）时靠这个计时器
        window.clearTimeout(fartPuffTimer)
        fartPuffTimer = window.setTimeout(() => {
          fartPuffTimer = 0
          removePuff()
        }, FART_PUFF_MS)
        window.clearTimeout(fartFxTimer)
        fartFxTimer = window.setTimeout(() => {
          fartFxTimer = 0
          root.classList.remove('is-farting', 'is-squinting', 'is-fx-motion')
          rig.classList.remove('act-fart')
          if (!feeding) clearPoseInline()
        }, FART_BOUNCE_MS)
        return true
      }

      function startFeeding(options = {}) {
        if (hidden || dragging) return false
        if (sleeping) wake()
        if (mealNap) stopMealNap(true)
        // 先把上一段动作/粒子/气团收干净；这里会顺手作废旧链，下面再重置序号
        stopExtras()
        feeding = true
        acting = false
        feedOptions = options
        feedHistory = []
        feedStartedAt = performance.now()
        fartCount = 0
        feedStage = ''
        hungerRounds = 0
        window.clearTimeout(hungerTimer)
        window.clearTimeout(hungerShowTimer)
        root.classList.remove('is-hungry')
        clearEatClasses()
        updateActionClearance()
        root.classList.add('is-eating')
        rig.classList.add('act-eating')
        applyFeedVisual('eating')
        setFeedStage('eating')
        say('🍖 开饭！', 1800)
        // 真·食物：嘴边弹出 → 随咀嚼抖 → 最后 300ms 缩没，与 EAT_MS 对齐，不新增状态
        showFood()
        feedAfter(EAT_MS - FOOD_GULP_MS, gulpFood)
        feedAfter(EAT_MS, beginFull)
        feedAfter(EAT_MS, removeFood)
        scheduleHunger()
        return true
      }

      function beginFull() {
        root.classList.remove('is-eating')
        rig.classList.remove('act-eating')
        root.classList.add('is-full')
        rig.classList.add('act-full')
        applyFeedVisual('full')
        setFeedStage('full')
        say('嗝～ 吃饱了', 1500)
        // 打嗝视觉：头部前倾 + 口部小气团；身体的短促上顶已写进 act-full 首帧
        playBurp({ body: false, say: false })
        feedAfter(FULL_MS, () => {
          root.classList.remove('is-full')
          rig.classList.remove('act-full')
        })
        // 「吃完 1–3s 内必放一次」：从吃完这一刻起算；随机只影响 1–1.5s 内的小抖动
        const delay = FART_DELAY_MIN_MS + Math.random() * (FART_DELAY_MAX_MS - FART_DELAY_MIN_MS)
        feedAfter(delay, beginFart)
      }

      function beginFart() {
        if (fartCount > 0 || !feeding) return
        fartCount += 1
        setFeedStage('fart')
        say('噗——', 1400)
        playFartFx()
        // 气团只负责淡出和清 DOM；小盹的决定放在下面，别在这里重复调用
        feedAfter(FART_PUFF_MS, removePuff)
        // 饭气攻心：等身体弹完就决定要不要眯一觉，不等气团淡完（气团继续自己淡出）
        feedAfter(FART_BOUNCE_MS + 200, maybeMealNap)
      }

      function maybeMealNap() {
        // 先结束「进食中」再决定小盹：startMealNap() 会拒绝 feeding 状态，
        // 顺序反了就会白等第二个定时器，甚至随机结果被吞掉。
        if (feedStage === 'fart') {
          feeding = false
          feedStage = ''
        }
        if (mealNap) return
        const want = feedOptions.forceNap === true
          ? true
          : feedOptions.forceNap === false
            ? false
            : Math.random() < MEAL_NAP_CHANCE
        if (want) {
          startMealNap(feedOptions)
        } else {
          // 不睡：喂食链到此结束，摘掉 reduced 内联姿势，别让压扁/停动画留到下一轮
          clearPoseInline()
        }
      }

      function napAfter(ms, fn) {
        const seq = mealNapSeq
        const id = window.setTimeout(() => {
          napTimers = napTimers.filter((item) => item !== id)
          if (seq !== mealNapSeq) return
          fn()
        }, ms)
        napTimers.push(id)
        return id
      }

      function spawnNapZzz(seq) {
        if (reduced || !mealNap || seq !== mealNapSeq) return
        burst('zzz', 2, { dur: 1900, spread: 26, lift: 20 })
        napZzzTimer = window.setTimeout(() => spawnNapZzz(seq), 1750)
      }

      function stopMealNap(quiet = true) {
        mealNapSeq += 1
        for (const id of napTimers) window.clearTimeout(id)
        napTimers = []
        window.clearTimeout(napZzzTimer)
        mealNap = false
        root.classList.remove('is-meal-nap', 'is-meal-yawn')
        if (reduced) applyFeedVisual('')
        // Zzz 粒子是临时 DOM：打断时立刻收掉，不留到下一个动作里
        if (quiet) fx.textContent = ''
      }

      /** 饭后小盹：哈欠 → 闭眼 → 头垂 → 呼噜气泡；与 20 分钟自然睡互不占用状态。 */
      function startMealNap(options = {}) {
        if (sleeping || dragging || hidden || feeding) return false
        stopMealNap(true)
        mealNap = true
        acting = false
        mealNapSeq += 1
        const seq = mealNapSeq
        root.classList.add('is-meal-nap', 'is-meal-yawn')
        look.style.transform = ''
        applyFeedVisual('nap')
        say('哈——欠…', 1600)
        napAfter(900, () => {
          root.classList.remove('is-meal-yawn')
          root.classList.add('is-meal-nap')
          say('呼…呼…', 1800)
          if (!reduced) spawnNapZzz(seq)
        })
        const napMs = options.napMs ?? (MEAL_NAP_MIN_MS + Math.random() * (MEAL_NAP_MAX_MS - MEAL_NAP_MIN_MS))
        napAfter(Math.max(1000, napMs), endMealNap)
        return true
      }

      function endMealNap() {
        if (!mealNap) return
        stopMealNap(true)
        say('睡饱了…', 1800)
        // 睡醒伸个懒腰（复用已有 stretch），然后回 idle
        playAction('stretch')
      }

      // —— 饿了：概率随轮次上升，只在不忙的时候张望一下 ——
      function hungerChance() {
        return Math.min(HUNGER_CHANCE_MAX, HUNGER_CHANCE_BASE + hungerRounds * HUNGER_CHANCE_STEP)
      }

      function showHunger() {
        if (hidden || dragging || sleeping || feeding || mealNap || acting) return false
        root.classList.add('is-hungry')
        applyFeedVisual('hungry')
        say('🍖 有点饿了…', 1800)
        window.clearTimeout(hungerShowTimer)
        hungerShowTimer = window.setTimeout(() => {
          root.classList.remove('is-hungry')
          if (reduced) applyFeedVisual('')
        }, HUNGER_SHOW_MS)
        return true
      }

      function scheduleHunger() {
        window.clearTimeout(hungerTimer)
        const delay = HUNGER_MIN_MS + Math.random() * (HUNGER_MAX_MS - HUNGER_MIN_MS)
        hungerTimer = window.setTimeout(() => {
          if (!hidden && !dragging && !sleeping && !feeding && !mealNap && !acting && Math.random() < hungerChance()) {
            showHunger()
          }
          hungerRounds += 1
          scheduleHunger()
        }, delay)
      }

      function scheduleSleep() {
        window.clearTimeout(sleepTimer)
        if (reduced) return
        sleepTimer = window.setTimeout(() => sleepNow(false), SLEEP_AFTER_MS)
      }

      function sleepNow(silent) {
        if (sleeping || dragging) return
        sleeping = true
        look.style.transform = ''
        root.classList.add('is-sleeping')
        root.classList.remove('is-hungry')
        window.clearTimeout(hungerShowTimer)
        window.clearTimeout(sleepTimer)
        window.clearTimeout(actionTimerId)
        // 走到一半/举着牌睡着会很怪：先收干净
        stopExtras()
        if (!silent) say('眯一会儿…', 2200)
        if (!reduced) {
          window.setTimeout(() => {
            if (sleeping) spawnZzz()
          }, 700)
        }
      }

      function wake() {
        if (!sleeping) {
          scheduleSleep()
          return
        }
        sleeping = false
        root.classList.remove('is-sleeping')
        root.classList.remove('is-yawn')
        scheduleSleep()
        scheduleAction()
        if (!reduced) burst('sparkle', 5)
      }

      // —— 粒子 ——
      const GLYPHS = {
        heart: ['💗', '💖', '❤️', '💕'],
        star: ['✨', '⭐️', '🌟'],
        sparkle: ['✨', '💫', '✧'],
        zzz: ['z', 'z', 'Z'],
        sweat: ['💦'],
      }
      function burst(kind, count = 7, opts = {}) {
        if (reduced || imageBroken) return
        const glyphs = GLYPHS[kind] ?? GLYPHS.sparkle
        for (let i = 0; i < count; i += 1) {
          const el = document.createElement('i')
          el.textContent = pick(glyphs)
          const spreadX = (Math.random() - 0.5) * (opts.spread ?? 74)
          const dx = spreadX + (Math.random() - 0.5) * 22
          const dy = -(58 + Math.random() * 62) - (opts.lift ?? 0)
          el.style.setProperty('--dx', `${dx.toFixed(1)}px`)
          el.style.setProperty('--dy', `${dy.toFixed(1)}px`)
          el.style.setProperty('--rot', `${((Math.random() - 0.5) * 90).toFixed(0)}deg`)
          el.style.setProperty('--dur', `${(opts.dur ?? 950) + Math.random() * 420}ms`)
          el.style.left = `${(50 + (Math.random() - 0.5) * 34).toFixed(1)}%`
          el.style.top = `${(34 + Math.random() * 26).toFixed(1)}%`
          el.style.fontSize = `${(11 + Math.random() * 7).toFixed(1)}px`
          if (kind === 'zzz') {
            // Zzz 从头顶斜着飘起来，颜色偏紫、带一圈浅色描边，深色背景上也看得清
            el.style.color = 'rgba(146, 136, 255, 0.96)'
            el.style.fontWeight = '800'
            el.style.fontSize = `${(14 + Math.random() * 8).toFixed(1)}px`
            el.style.textShadow = '0 1px 4px rgba(255,255,255,0.8), 0 0 2px rgba(40,32,90,0.45)'
            el.style.left = `${(58 + Math.random() * 24).toFixed(1)}%`
            el.style.top = `${(10 + Math.random() * 12).toFixed(1)}%`
          }
          el.addEventListener('animationend', () => el.remove(), { once: true })
          fx.append(el)
          window.setTimeout(() => el.remove(), (opts.dur ?? 950) + 900)
        }
      }

      function spawnZzz() {
        if (reduced || sleeping === false) return
        burst('zzz', 2, { dur: 1900, spread: 26, lift: 20 })
        if (sleeping) window.setTimeout(spawnZzz, 1750)
      }

      // —— 小动作 ——
      let lastAction = ''

      function clearActions() {
        for (const name of ACTIONS) rig.classList.remove(`act-${name}`)
      }

      /**
       * 位移给关键帧留出余量：贴顶时向上的 hop/stretch 收敛，贴底时向下的
       * sit/stomp 收敛，避免动作被窗口边缘裁掉。系数写进 CSS 变量。
       */
      function updateActionClearance() {
        const upRoom = position.top - 6
        const downRoom = window.innerHeight - (position.top + PET_H) - 6
        root.style.setProperty('--act-up', clamp(upRoom / 28, 0, 1).toFixed(3))
        root.style.setProperty('--act-down', clamp(downRoom / 12, 0, 1).toFixed(3))
      }

      /** durationMs 只给自测/拍照用（拉长关键帧，方便截静帧），正常播放不传。 */
      function playAction(name, durationMs) {
        if (hidden || dragging) return false
        if (sleeping) wake()
        // 加权抽签（不是等概率）：排除上一个动作，避免连续重复
        const key = name ?? pickWeighted(lastAction)
        const ms = durationMs ?? ACTION_MS[key]
        if (ms === undefined) return false
        acting = true
        // 先收掉上一段新增动作的副作用，免得走路走到一半被另一个动作接走
        stopExtras()
        clearActions()
        // 降级模式：不跑关键帧，只切一帧静态姿态（无位移、无旋转），到时收回
        if (reduced) {
          lastAction = key
          rig.style.animation = 'none'
          rig.style.transform = REDUCED_POSE[key] ?? ''
          rig.classList.add(`act-${key}`)
          window.clearTimeout(actTimerId)
          const seq = ++actSeq
          actTimerId = window.setTimeout(() => {
            if (seq !== actSeq) return
            rig.classList.remove(`act-${key}`)
            rig.style.animation = ''
            rig.style.transform = ''
            acting = false
          }, Math.min(ms, 900) + 40)
          return true
        }
        if (key === 'walk' && !beginWalk(ms)) {
          acting = false
          return false
        }
        lastAction = key
        updateActionClearance()
        // 滑步的方向/幅度先写好，关键帧第一帧就要读这两个变量
        if (key === 'slide') updateSlideDir()
        // 强制重启动画
        void rig.offsetWidth
        rig.classList.add(`act-${key}`)
        if (key === 'hop') {
          root.classList.add('is-jumping')
          window.setTimeout(() => root.classList.remove('is-jumping'), 900)
        }
        if (key === 'yawn') root.classList.add('is-yawn')
        if (key === 'sign') {
          root.classList.add('is-signing')
          showSign(ms)
        }
        if (key === 'stomp') root.classList.add('is-stomping')
        if (key === 'sit') root.classList.add('is-sitting')
        // 新动作：root 上的标记类只负责"影子跟着身体动"，收尾统一在 stopExtras/定时器里
        if (key === 'spin') root.classList.add('is-spinning')
        if (key === 'turn') root.classList.add('is-turning')
        if (key === 'flip') root.classList.add('is-flipping')
        if (key === 'stretch') root.classList.add('is-stretching')
        if (key === 'slide') root.classList.add('is-sliding')
        if (key === 'stretch' || key === 'wave' || key === 'spin') burst('sparkle', 3)
        if (key === 'flip') burst('star', 3, { dur: 760 })
        const line = ACTION_LINES[key]
        // 举牌时牌子上已经有字了，气泡就不抢戏；走路时少说话
        const lineChance = key === 'sign' ? 0 : key === 'walk' ? 0.22 : 0.55
        if (line !== undefined && lineChance > 0 && Math.random() < lineChance) {
          say(pick(line), 1800)
        }
        // 收尾定时器要能被后来的动作作废：否则上一段动作的定时器会在新动作播到一半时
        // 把 is-stomping / is-spinning 之类的标记摘掉（表现为动作没开始就被"收势"）。
        window.clearTimeout(actTimerId)
        const seq = ++actSeq
        actTimerId = window.setTimeout(() => {
          if (seq !== actSeq) return
          rig.classList.remove(`act-${key}`)
          root.classList.remove('is-yawn')
          root.classList.remove('is-signing', 'is-stomping', 'is-sitting')
          for (const flag of MOTION_FLAGS) root.classList.remove(flag)
          acting = false
        }, ms + 40)
        return true
      }

      function scheduleAction() {
        window.clearTimeout(actionTimerId)
        if (reduced) return
        const delay = ACTION_MIN_MS + Math.random() * (ACTION_MAX_MS - ACTION_MIN_MS)
        actionTimerId = window.setTimeout(() => {
          // 吃饭和小盹期间不插随机动作；真要打断只能靠点击/拖动/右键菜单
          if (!sleeping && !dragging && !hidden && !feeding && !mealNap) playAction()
          scheduleAction()
        }, delay)
      }

      // —— 新增动作：走路 / 招手举牌 / 生气跺脚 / 坐下伸腿 ——
      // 这四个除了 rig 上的关键帧，还有位置或 DOM 副作用，所以统一由这里收尾：
      // 拖动 / 睡着 / 隐藏 / 播下一个动作时立刻停掉，不会留下半截状态。
      let walk = null
      let walkRaf = 0
      let walkSeq = 0
      let extraTimers = []

      /** 只有新增动作在用的定时器，方便被 stopExtras() 一次性清干净。 */
      function extraAfter(ms, fn) {
        const id = window.setTimeout(() => {
          extraTimers = extraTimers.filter((item) => item !== id)
          fn()
        }, ms)
        extraTimers.push(id)
        return id
      }

      function persistPosition() {
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify({
            left: Math.round(position.left),
            top: Math.round(position.top),
          }))
        } catch {
          // 隐私模式下存不了就算了
        }
      }

      function smoothstep(value) {
        return value * value * (3 - 2 * value)
      }

      /** 朝向：整张照片镜像 = 转身；步态的前倾也一起翻到另一侧。 */
      function setWalkDir(dir) {
        root.classList.toggle('is-face-right', dir > 0)
        root.style.setProperty('--walk-lean', dir > 0 ? '2.2deg' : '-2.2deg')
        root.style.setProperty('--pet-face', dir > 0 ? '1' : '-1')
      }

      /**
       * 滑步的方向与幅度：往窗口里空的一侧滑；两侧都窄就把幅度收到最小 8px，
       * 保证半个身位也滑不出窗口。这两个变量只被 rig 的关键帧读取，
       * root 的窗口坐标（position）完全不动，所以不会漂。
       */
      function updateSlideDir() {
        const roomLeft = position.left - MARGIN
        const roomRight = window.innerWidth - (position.left + PET_W) - MARGIN
        root.style.setProperty('--slide-dir', roomRight >= roomLeft ? '1' : '-1')
        root.style.setProperty('--slide-dist', `${clamp(Math.max(roomLeft, roomRight), 8, 30).toFixed(1)}px`)
      }

      function stopWalk(persist = true) {
        walkSeq += 1
        if (walkRaf !== 0) {
          window.cancelAnimationFrame(walkRaf)
          walkRaf = 0
        }
        if (walk === null) return
        walk = null
        root.classList.remove('is-walking')
        rig.classList.remove('act-walk')
        if (persist) persistPosition()
      }

      /**
       * 走路：全局唯一逐帧的地方，且只在这 3.4s 里跑一个 rAF，走完立刻停。
       * 每帧只写一次 root.transform（applyPosition），步态（起伏/摇摆/压缩）全交给
       * CSS 关键帧在合成层跑 —— 所以既不会重排，也不会有一堆 rAF 抢主线程。
       * 碰到窗口左右边缘就折返：方向翻转 + 镜像转身。
       */
      function beginWalk(totalMs) {
        const minX = MARGIN
        const maxX = Math.max(minX, window.innerWidth - PET_W - MARGIN)
        if (imageBroken || maxX - minX < WALK_MIN_ROOM) return false
        // 朝空的一侧起步；已经贴着边就先往里走
        let dir = position.left + PET_W / 2 > window.innerWidth / 2 ? -1 : 1
        if (dir > 0 && maxX - position.left < 26) dir = -1
        else if (dir < 0 && position.left - minX < 26) dir = 1
        const started = performance.now()
        const seq = ++walkSeq
        walk = { dir, last: started }
        root.classList.add('is-walking')
        setWalkDir(dir)
        const step = (now) => {
          walkRaf = 0
          if (walk === null || seq !== walkSeq) return
          const t = clamp((now - started) / totalMs, 0, 1)
          // 切后台回来时 now 会跳很远：按 40ms 封顶，位置不会瞬移
          const dt = clamp(now - walk.last, 0, 40) / 1000
          walk.last = now
          // 起步加速、收步减速，真人不会瞬间匀速
          const ramp = smoothstep(clamp(Math.min(t / WALK_RAMP, (1 - t) / WALK_RAMP), 0, 1))
          let left = position.left + walk.dir * WALK_SPEED * ramp * dt
          if (left <= minX) {
            left = minX
            walk.dir = 1
            setWalkDir(1)
          } else if (left >= maxX) {
            left = maxX
            walk.dir = -1
            setWalkDir(-1)
          }
          position = { left, top: position.top }
          applyPosition()
          if (t >= 1) {
            stopWalk()
            return
          }
          walkRaf = window.requestAnimationFrame(step)
        }
        walkRaf = window.requestAnimationFrame(step)
        return true
      }

      /** 举牌：抬手动画走 CSS，牌子本身只用 opacity/transform 收放。 */
      function showSign(totalMs) {
        extraAfter(160, () => {
          const rect = root.getBoundingClientRect()
          sign.textContent = pick(SIGN_LINES)
          // 牌子伸向面朝的一侧（人不会把牌子举在背后）；那侧没地方就换到另一侧
          const vw = window.innerWidth || 1280
          let side = root.classList.contains('is-face-right') ? 1 : -1
          if (side > 0 && vw - rect.right < 92) side = -1
          else if (side < 0 && rect.left < 92) side = 1
          sign.classList.toggle('is-flip', side > 0)
          sign.classList.add('is-on')
        })
        extraAfter(totalMs - 240, () => sign.classList.remove('is-on'))
      }

      function stopExtras() {
        // 干饭链 / 饭后小盹 / 打嗝放屁也归这里收口：拖动、播下一个动作、隐藏、自然睡都会立刻打断，
        // 不会出现「动作停了但气团/哈欠还在」的半截状态。
        stopFeeding()
        stopMealNap(true)
        // 打嗝可以独立于进食链播放，所以单独收一次；放屁的 DOM 也在这里兜底（含单独播放的 fart）。
        removeBurp()
        removePuff()
        window.clearTimeout(fartFxTimer)
        window.clearTimeout(fartPuffTimer)
        fartFxTimer = 0
        fartPuffTimer = 0
        root.classList.remove('is-farting', 'is-squinting', 'is-fx-motion')
        rig.classList.remove('act-fart')
        // 打断时把还在排队的"动作收尾"一并作废，免得它稍后打到下一个动作身上
        actSeq += 1
        window.clearTimeout(actTimerId)
        for (const id of extraTimers) window.clearTimeout(id)
        extraTimers = []
        stopWalk()
        sign.classList.remove('is-on', 'is-flip')
        sign.textContent = ''
        root.classList.remove('is-stomping', 'is-sitting', 'is-hungry')
        window.clearTimeout(hungerShowTimer)
        for (const key of EXTRA_ACTIONS) {
          rig.classList.remove(`act-${key}`)
          const flag = EXTRA_FLAG[key]
          if (flag !== undefined) root.classList.remove(flag)
        }
        // 降级模式的静态姿态是内联的，被打断时也要摘掉，别留给下一个动作；
        // 非降级时也清一次，避免上一轮 reduced 留下的 animation:none 残留
        clearPoseInline()
        // 动作只动 rig 的变换，窗口位置始终以 position 为准；被打断时按当前坐标重画一次，
        // 保证 root 的 translate3d 和 persistPosition() 写的是同一份坐标（不漂）。
        applyPosition()
      }

      // —— 眨眼 ——
      let blinkTimer = 0
      function blink() {
        if (reduced || sleeping || hidden) return
        root.classList.add('is-blinking')
        window.setTimeout(() => root.classList.remove('is-blinking'), 110)
        if (Math.random() < 0.24) {
          // 偶尔连眨两下
          window.setTimeout(() => {
            if (sleeping || hidden) return
            root.classList.add('is-blinking')
            window.setTimeout(() => root.classList.remove('is-blinking'), 100)
          }, 190)
        }
      }
      function scheduleBlink() {
        window.clearTimeout(blinkTimer)
        blinkTimer = window.setTimeout(() => {
          blink()
          scheduleBlink()
        }, 2300 + Math.random() * 3600)
      }

      // —— 视线跟随 ——
      function petRect() {
        if (rectCache === null) rectCache = root.getBoundingClientRect()
        return rectCache
      }

      function updateLook() {
        lookRaf = 0
        // 吃饭/小盹时视线交给关键帧，别让跟鼠标的内联 transform 抢戏
        if (reduced || sleeping || dragging || feeding || mealNap || lastPointer === null) return
        const rect = petRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height * 0.36
        const dx = clamp((lastPointer.x - cx) / 190, -1, 1)
        const dy = clamp((lastPointer.y - cy) / 240, -1, 1)
        look.style.transform =
          `translate(${(dx * 2.6).toFixed(2)}px, ${(dy * 1.6).toFixed(2)}px) rotate(${(dx * 1.9).toFixed(2)}deg)`
      }

      function onGlobalPointerMove(event) {
        lastPointer = { x: event.clientX, y: event.clientY }
        if (lookRaf !== 0) return
        lookRaf = window.requestAnimationFrame(updateLook)
      }

      // —— 拖动 + 点击 ——
      let pointerId = -1
      let grabX = 0
      let grabY = 0
      let moved = 0
      let pressedAt = 0
      let tilt = 0
      let lastClientX = 0
      let lastClientY = 0
      let settleTimer = 0

      function applyTilt() {
        rig.style.transform = `rotate(${tilt.toFixed(2)}deg)`
      }

      function onPointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return
        dragging = true
        pointerId = event.pointerId
        grabX = event.clientX - position.left
        grabY = event.clientY - position.top
        moved = 0
        tilt = 0
        pressedAt = Date.now()
        lastClientX = event.clientX
        lastClientY = event.clientY
        window.clearTimeout(settleTimer)
        rig.classList.remove('is-settle')
        root.classList.add('is-dragging')
        wake()
        // 拖起来就停掉走路/举牌/跺脚/坐下，松手后由 scheduleAction 自然恢复
        stopExtras()
        look.style.transform = ''
        // 拖出宠物范围也要跟手：move/up 挂在 window 上，不依赖 pointer capture。
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerCancel)
        window.clearTimeout(menuTimer)
        closeMenu()
        event.preventDefault()
      }

      function onPointerMove(event) {
        if (!dragging || event.pointerId !== pointerId) return
        const left = event.clientX - grabX
        const top = event.clientY - grabY
        moved = Math.max(moved, Math.abs(left - position.left) + Math.abs(top - position.top))
        position = {
          left: clamp(left, 0, window.innerWidth - PET_W),
          top: clamp(top, 0, window.innerHeight - PET_H),
        }
        applyPosition()
        // 惯性：往右拖，身体向左拖尾
        const vx = event.clientX - lastClientX
        lastClientX = event.clientX
        lastClientY = event.clientY
        const target = clamp(-vx * 0.85, -14, 14)
        tilt = tilt * 0.7 + target * 0.3
        applyTilt()
        event.preventDefault()
      }

      function releaseDrag() {
        dragging = false
        pointerId = -1
        root.classList.remove('is-dragging')
        stopTracking()
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify({
            left: Math.round(position.left),
            top: Math.round(position.top),
          }))
        } catch {
          // 隐私模式下存不了就算了
        }
        // 松手回正 + 弹一下
        rig.classList.add('is-settle')
        tilt = 0
        applyTilt()
        settleTimer = window.setTimeout(() => {
          rig.classList.remove('is-settle')
          rig.style.transform = ''
        }, 560)
        scheduleSleep()
        // 拖动期间随机动作被暂停，松手后重新起算
        scheduleAction()
      }

      function onPointerUp(event) {
        if (!dragging || event.pointerId !== pointerId) return
        const wasClick = moved < 6 && Date.now() - pressedAt < 800
        releaseDrag()
        if (wasClick) {
          cheer()
          say(pick(CLICK_LINES), 2200)
          // 单击 = 带着这只宠物去比武台（新窗口，别把 DSH 自己导航走）
          openArena()
        }
      }

      function stopTracking() {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
      }

      function onPointerCancel() {
        if (!dragging) return
        releaseDrag()
      }

      /** 点一下的反馈：身体蹦一下 + 爱心星星 + 台词；只卖萌，不发消息。 */
      function cheer() {
        if (reduced) return
        updateActionClearance()
        root.classList.add('is-jumping')
        window.setTimeout(() => root.classList.remove('is-jumping'), 900)
        // is-jumping 只带动影子；再给 rig 挂一次 hop，身体真的跳一下
        rig.classList.remove('act-hop')
        void rig.offsetWidth
        rig.classList.add('act-hop')
        window.setTimeout(() => rig.classList.remove('act-hop'), 900)
        burst('heart', 8)
        burst('star', 3, { dur: 820 })
      }

      function onKeyDown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        // 键盘也是「点一下」：进食/小盹中先按打断处理，再卖萌
        if (feeding || mealNap || sleeping) stopExtras()
        cheer()
        say(pick(CLICK_LINES), 2200)
      }

      function sleep(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms))
      }

      // —— 内部群巡查：锁定会话 → 限定 composer → 写入 → 发送 → 校验 ——

      function centerCol() {
        const cols = document.querySelectorAll('[class*="_centerCol"]')
        let fallback = null
        for (const col of cols) {
          if (fallback === null) fallback = col
          if (typeof col.getClientRects === 'function' && col.getClientRects().length > 0) return col
        }
        return fallback
      }

      // 命中目标会话的两种情形：①容器里就是写死的 session id；②容器里有 session id，
      // 且会话头或输入框占位指向目标 Bot（ds-bot 的 HeaderPill 是
      // roster.byId[sessionId].name，所以只认「宇诚总管」这个名字，不认别的 bot）。
      function strongTarget(col) {
        if (col === null) return false
        let anyId = ''
        for (const node of col.querySelectorAll('[data-conversation-session]')) {
          const id = node.getAttribute('data-conversation-session') || ''
          if (!id) continue
          if (id === TARGET_SESSION_ID || id.includes(TARGET_SESSION_ID)) return true
          if (!anyId && id.startsWith('session-')) anyId = id
        }
        // 2026-11-10 修：宇诚总管每次新开会话都会换 session id，硬编码 id 会失准
        // （原 id 的会话停更在 11-01，当前会话已换成 11-10 的）。只要会话头写着
        // 目标 Bot、正文区已挂载，就认它是「这个 bot 当前打开的会话」。
        return anyId !== '' && (headerLooksLikeTarget(col) || composerLooksLikeTarget(col))
      }

      // 辅助判断：会话头确实写着目标 Bot。
      // 标题是 roster.byId[sessionId].name，同一个 Bot 的别的会话会重名 —— 但这里
      // 要的就是「这个 bot 的任意会话」，所以从 2026-11-10 起参与 strongTarget 放行，
      // 且只在会话 id 校验不中时作为兜底，避免写进别的 bot 的会话。
      function headerLooksLikeTarget(col) {
        if (col === null) return false
        const header = col.querySelector('header[data-window-drag], header')
        return header !== null && (header.textContent || '').includes(TARGET_BOT)
      }

      // 输入框占位文案「给 宇诚总管 发消息」是比会话头更稳的目标信号
      function composerLooksLikeTarget(col) {
        if (col === null) return false
        for (const el of col.querySelectorAll('[data-composer-card] textarea, [data-composer-card] [contenteditable], [data-composer-card] [role="textbox"]')) {
          const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || ''
          if (ph.includes(TARGET_BOT)) return true
        }
        return false
      }

      function weakTargetReady(col) {
        if (col === null) return false
        return col.querySelector('[data-conversation-scroll], [data-slot="conversation.chat.flow"]') !== null
      }

      function targetSessionReady() {
        const col = centerCol()
        return { col, ok: strongTarget(col) && weakTargetReady(col) }
      }

      async function waitForTargetSession(timeoutMs) {
        const deadline = performance.now() + timeoutMs
        while (performance.now() <= deadline) {
          const state = targetSessionReady()
          if (state.ok) return state
          await sleep(POLL_MS)
        }
        return targetSessionReady()
      }

      function getComposer(col) {
        if (col === null) return null
        const scoped = col.querySelector('[role="textbox"][contenteditable="true"]') ||
          col.querySelector('[data-lexical-editor="true"]')
        if (scoped !== null) return scoped
        // 全局兜底也只认 composer card，绝不碰页面里别的 textarea / 编辑器
        for (const node of document.querySelectorAll('[data-lexical-editor="true"]')) {
          if (node.closest('[data-composer-card]') !== null) return node
        }
        return null
      }

      function getSendButton(box) {
        const container = box.closest('[data-composer-card]') || box.closest('form') || box.parentElement
        if (container === null) return null
        return container.querySelector(
          'button[aria-label*="发送"],button[aria-label*="Send"],button[type="submit"]',
        )
      }

      async function waitForSendButton(box, timeoutMs) {
        const deadline = performance.now() + timeoutMs
        while (performance.now() <= deadline) {
          const btn = getSendButton(box)
          if (btn !== null && !btn.disabled) return btn
          await sleep(80)
        }
        return null
      }

      function composerText(box) {
        return ((box.innerText ?? box.textContent) || '').replace(/\u00a0/g, ' ').trim()
      }

      /**
       * 读 Lexical 内部 state 的文本。DOM 里 textContent 被改掉不代表 state 里有字，
       * 发送按钮也可能因为旧草稿本来就是启用的；这里直接读编辑器 state 才可靠。
       * Lexical 会把 editor 挂在根节点（含祖先）的 __lexicalEditor 上。
       * 读不到（非 Lexical 编辑器）返回 null，调用方再退回按钮/文本代理。
       */
      function editorStateText(box) {
        let node = box
        while (node !== null) {
          const editor = node.__lexicalEditor
          if (editor !== null && typeof editor === 'object') {
            try {
              const state = typeof editor.getEditorState === 'function' ? editor.getEditorState() : null
              const json = state !== null && typeof state.toJSON === 'function' ? state.toJSON() : null
              if (json !== null && typeof json === 'object') {
                const parts = []
                const walk = (value, depth) => {
                  if (value === null || typeof value !== 'object' || depth > 32) return
                  if (typeof value.text === 'string') parts.push(value.text)
                  if (Array.isArray(value.children)) for (const child of value.children) walk(child, depth + 1)
                  if (value.root !== undefined) walk(value.root, depth + 1)
                }
                walk(json, 0)
                return parts.join('')
              }
            } catch {
              // 编辑器版本不兼容：当作读不到 state
            }
          }
          node = node.parentElement
        }
        return null
      }

      function focusComposer(box) {
        try {
          box.focus({ preventScroll: true })
        } catch {
          box.focus()
        }
      }

      function selectAllInComposer(box) {
        focusComposer(box)
        try {
          document.execCommand('selectAll', false, null)
        } catch {
          // 老引擎没有也不影响后面的插入
        }
      }

      function execInsert(box, text) {
        focusComposer(box)
        try {
          return document.execCommand('insertText', false, text)
        } catch {
          return false
        }
      }

      function dispatchBeforeInput(box, text) {
        try {
          box.dispatchEvent(new InputEvent('beforeinput', {
            inputType: 'insertText', data: text, bubbles: true, cancelable: true, composed: true,
          }))
        } catch {
          // 不支持 InputEvent 的引擎后面还有 execCommand / textContent 兜底
        }
        try {
          box.dispatchEvent(new InputEvent('input', {
            inputType: 'insertText', data: text, bubbles: true, composed: true,
          }))
        } catch {
          // 同上
        }
      }

      function messageFlow(col) {
        if (col === null) return null
        return col.querySelector('[data-slot="conversation.chat.flow"]') ||
          col.querySelector('[data-conversation-scroll]')
      }

      /**
       * 写入 composer。先试 execCommand('insertText')（DOM 层最自然，但脚本触发的
       * execCommand 不一定派发 beforeinput，Lexical 可能只看到 DOM）；失败再合成
       * beforeinput/input，最后才碰 textContent。每级写完后都读回文本，有发送按钮
       * 时还要求它可用（Lexical state 非空的代理信号）。都失败就把原草稿放回去，
       * 绝不清空。
       */
      async function writeComposer(box, text) {
        const original = composerText(box)

        // 写入是否真的进了编辑器：优先读 Lexical state（读不到才退回按钮代理）。
        // 只检查 DOM 文本会误判 —— textContent 能糊出字，旧草稿还会让发送键一直是启用的。
        const accepts = async () => {
          const deadline = performance.now() + 260
          while (performance.now() <= deadline) {
            const domText = composerText(box)
            if (domText.includes(PROMPT_KEYWORD)) {
              const stateText = editorStateText(box)
              if (stateText !== null) {
                if (stateText.includes(PROMPT_KEYWORD)) return true
              } else {
                const btn = getSendButton(box)
                if (btn === null || !btn.disabled) return true
              }
            }
            await sleep(40)
          }
          return false
        }

        const attempts = [
          async () => {
            selectAllInComposer(box)
            execInsert(box, text)
          },
          async () => {
            selectAllInComposer(box)
            dispatchBeforeInput(box, text)
            if (!(await accepts())) execInsert(box, text)
          },
          async () => {
            focusComposer(box)
            box.textContent = text
            dispatchBeforeInput(box, text)
          },
        ]

        for (const attempt of attempts) {
          try {
            await attempt()
          } catch (error) {
            console.error('[desktop-pet] composer write attempt failed', error)
          }
          if (await accepts()) return true
        }

        // 写失败：恢复原草稿，让 Henry 能手动发。
        // 顺序：先用「全选 + 合成 beforeinput」把原草稿写回（Lexical 只认 beforeinput，
        // 这条路同时改 DOM 与 state）；引擎拒绝 beforeinput 时再退 execCommand（只改 DOM），
        // 最后才 textContent 兜底。恢复后回读 state/DOM 双校验，不留半截提示。
        const stateMatches = (value) => {
          const stateText = editorStateText(box)
          if (stateText === null) return null
          return value.length === 0 ? stateText.trim().length === 0 : stateText.includes(value)
        }
        const domMatches = (value) => {
          const domText = composerText(box)
          return value.length === 0 ? domText.trim().length === 0 : domText.includes(value)
        }
        const restoreDraft = async (value) => {
          try {
            focusComposer(box)
            selectAllInComposer(box)
            dispatchBeforeInput(box, value)
            await sleep(60)
            if (stateMatches(value) === true && domMatches(value)) return true
          } catch (error) {
            console.error('[desktop-pet] composer restore via beforeinput failed', error)
          }
          try {
            selectAllInComposer(box)
            if (value.length > 0) execInsert(box, value)
            else document.execCommand('delete', false, null)
            await sleep(50)
            if (domMatches(value)) return true
          } catch (error) {
            console.error('[desktop-pet] composer restore via execCommand failed', error)
          }
          try {
            box.textContent = value
            await sleep(20)
            return domMatches(value)
          } catch (error) {
            console.error('[desktop-pet] composer restore dom fallback failed', error)
            return false
          }
        }
        await restoreDraft(original)
        return false
      }

      /** 只在 composer 祖先容器里找发送键并点击，2s 内校验文本被清空或消息流入。 */
      async function sendComposer(col, box) {
        const flow = messageFlow(col)
        const before = flow === null ? '' : (flow.textContent || '')
        const btn = await waitForSendButton(box, 1200)
        if (btn === null) return { ok: false, reason: 'no-send' }
        try {
          btn.click()
        } catch (error) {
          console.error('[desktop-pet] send click failed', error)
          return { ok: false, reason: 'send-click' }
        }
        const deadline = performance.now() + SEND_VERIFY_MS
        while (performance.now() <= deadline) {
          const stillThere = composerText(box).includes(PROMPT_KEYWORD)
          if (!stillThere) return { ok: true }
          const after = flow === null ? '' : (flow.textContent || '')
          if (after !== before && after.includes(PROMPT_KEYWORD)) return { ok: true }
          await sleep(POLL_MS)
        }
        return { ok: false, reason: 'unverified' }
      }

      /**
       * 右键「内部群巡查」。只有校验到消息真的进入会话才说「发好了」；
       * 切不到目标会话就中止，不写不发；任何失败都不清草稿。
       */
      let chatBusy = false

      async function openChat() {
        if (chatBusy) return { ok: false, reason: 'busy' }
        chatBusy = true
        try {
          let state = targetSessionReady()
          if (!state.ok) {
            const lead = findBotLead(TARGET_BOT)
            if (lead === null) return openDraftFallback()
            say('正在切到宇诚总管的会话…', 2400)
            try {
              lead.click()
            } catch (error) {
              console.error('[desktop-pet] open bot chat failed', error)
            }
            state = await waitForTargetSession(SESSION_WAIT_MS)
            if (!state.ok) {
              say('没切到宇诚总管的会话，先不发了', 4600)
              return { ok: false, reason: 'session' }
            }
          }

          const col = state.col ?? centerCol()
          const box = getComposer(col)
          if (box === null) {
            say('没找到输入框，先不发了', 4200)
            return { ok: false, reason: 'no-composer' }
          }

          if (!(await writeComposer(box, PROMPT))) {
            say('写不进去，草稿还留着，你手动发一下', 5000)
            return { ok: false, reason: 'write' }
          }

          const sent = await sendComposer(col, box)
          if (!sent.ok) {
            say(
              sent.reason === 'no-send'
                ? '没找到发送按钮，草稿还在，你手动发一下'
                : '发送后没看到消息，草稿还在，你手动发一下',
              5200,
            )
            return { ok: false, reason: sent.reason }
          }

          say('发好了，宇诚总管去翻内部群了', 4600)
          return { ok: true }
        } finally {
          chatBusy = false
        }
      }

      /**
       * 找不到 Bot 入口时只开一个带指令的新会话草稿，不发送；文案也必须
       * 如实说「请确认发送」，不能冒充已发给宇诚总管。
       */
      async function openDraftFallback() {
        const service = getWorkspaceService(ctx)
        if (service === null || typeof service.startSession !== 'function') {
          say('没找到「宇诚总管」的入口，也没找到会话服务', 5000)
          return { ok: false, reason: 'no-service' }
        }
        try {
          const result = service.startSession(currentWorkspaceId(service), {
            prompt: PROMPT,
            whenDraftExists: 'append',
          })
          if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
            await result
          }
        } catch (error) {
          say('打开草稿失败了，看看控制台', 4200)
          console.error('[desktop-pet] startSession failed', error)
          return { ok: false, reason: 'draft-failed' }
        }
        say('已打开草稿，请确认发送', 4600)
        return { ok: false, reason: 'draft' }
      }

      /** 在侧栏 Bot 团队里找名字匹配的入口按钮。 */
      function findBotLead(name) {
        for (const row of document.querySelectorAll('button.bt-lead')) {
          const label = (row.getAttribute('aria-label') || '') + (row.textContent || '')
          if (label.includes(name)) return row
        }
        for (const el of document.querySelectorAll('[aria-label],[title]')) {
          const label = (el.getAttribute('aria-label') || '') + (el.getAttribute('title') || '')
          if (label.includes(name)) return el.closest('button,[role="button"]') || el
        }
        for (const el of document.querySelectorAll('button,[role="button"],li,span,div')) {
          if (el.childElementCount !== 0) continue
          if ((el.textContent || '').trim() !== name) continue
          return el.closest('button,[role="button"],[tabindex]') || el.parentElement || el
        }
        return null
      }

      // —— 悬停 ——
      function onPointerEnter() {
        if (dragging) return
        wake()
        spawnHoverLine()
      }
      function spawnHoverLine() {
        if (Math.random() < 0.45) return
        say(pick(BUBBLES))
      }
      const onPointerLeave = () => bubble.classList.remove('is-on')

      // —— 右键菜单 ——
      let menu = null
      let menuTimer = 0

      function closeMenu() {
        window.clearTimeout(menuTimer)
        if (menu !== null) {
          menu.remove()
          menu = null
        }
      }

      function openMenu(x, y) {
        closeMenu()
        menu = document.createElement('div')
        menu.className = 'pet-menu'
        menu.setAttribute('role', 'menu')

        const items = [
          ['⚔️ 去比武台', () => openArena()],
          [`🎨 换形象（现在是${AVATARS[avatarKey] || '鲸鱼'}）`, () => {
            const keys = Object.keys(AVATARS)
            const next = keys[(keys.indexOf(avatarKey) + 1) % keys.length]
            try {
              window.localStorage.setItem(PET_AVATAR_MANUAL, '1')
            } catch {
              // 存不了就算了，本次会话内照样生效
            }
            applyAvatar(next)
            say(`换成 ${AVATARS[next]} 啦`, 2000)
            burst('sparkle', 6)
          }],
          ['🐾 跟随网页里那只宠物', () => {
            try {
              window.localStorage.removeItem(PET_AVATAR_MANUAL)
            } catch {
              // 忽略
            }
            say('好，跟着网页那只走', 2000)
            askPageForPet()
          }],
          ['🔍 内部群巡查（发给「宇诚总管」）', () => {
            // 进度/结果提示都由 openChat 按实际阶段给出，这里不预先报「去发了」
            void openChat()
          }],
          ['🍖 喂她吃点东西', () => {
            if (!startFeeding()) say('现在不方便吃…')
          }],
          [`换个表情（现在是${MOOD_LABEL[mood]}）`, () => {
            const next = MOODS[(MOODS.indexOf(mood) + 1) % MOODS.length]
            setMood(next)
            say(`换好啦：${MOOD_LABEL[next]}`)
            if (next === 'sparkle') burst('sparkle', 6)
          }],
          ['让它动一下', () => {
            if (!playAction()) say('它现在不想动…')
          }],
          [desktopEnabled() ? '🖥️ 在桌面显示宠物：开（点此关闭）' : '🖥️ 在桌面显示宠物：关（点此打开）', () => {
            const on = desktopEnabled()
            setDesktopEnabled(!on)
            if (on) {
              say('桌面宠物关掉了，对战照常在面板里', 2600)
              window.setTimeout(() => { closeMenu(); hide() }, 60)
            } else {
              say('桌面宠物回来啦', 2000)
              window.setTimeout(() => window.location.reload(), 400)
            }
          }],
          ['重新加载', () => window.location.reload()],
          ['隐藏宠物（本会话）', () => {
            hide()
            say('藏好了，⌘⇧P 能叫回来', 2600)
          }],
        ]
        for (const [label, action] of items) {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = label
          button.setAttribute('role', 'menuitem')
          button.addEventListener('click', (event) => {
            event.stopPropagation()
            closeMenu()
            action()
          })
          menu.append(button)
        }
        const hint = document.createElement('div')
        hint.className = 'pet-menu-hint'
        hint.textContent = '闲置 20 分钟会睡着'
        menu.append(hint)

        layer.append(menu)
        const width = menu.offsetWidth || 168
        const height = menu.offsetHeight || 132
        menu.style.left = `${Math.round(clamp(x, 6, window.innerWidth - width - 6))}px`
        menu.style.top = `${Math.round(clamp(y, 6, window.innerHeight - height - 6))}px`
        menuTimer = window.setTimeout(closeMenu, 6000)
      }

      function onContextMenu(event) {
        event.preventDefault()
        event.stopPropagation()
        openMenu(event.clientX, event.clientY)
      }

      function hide() {
        hidden = true
        closeMenu()
        stopExtras()
        root.classList.remove('is-hungry')
        window.clearTimeout(hungerShowTimer)
        layer.style.display = 'none'
        try {
          window.sessionStorage.setItem(HIDDEN_KEY, '1')
        } catch {
          // 忽略
        }
      }

      function show() {
        hidden = false
        layer.style.display = ''
        try {
          window.sessionStorage.removeItem(HIDDEN_KEY)
        } catch {
          // 忽略
        }
        scheduleSleep()
        scheduleAction()
        scheduleHunger()
        burst('sparkle', 4)
      }

      // —— 全局监听 ——
      const onDocumentPointerDown = (event) => {
        if (menu !== null && !menu.contains(event.target)) closeMenu()
      }
      const onDocumentKeyDown = (event) => {
        if (event.key === 'Escape') closeMenu()
        // ⌘⇧P / Ctrl⇧P：把藏起来的宠物叫回来
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'p' || event.key === 'P')) {
          event.preventDefault()
          if (hidden) show()
          else wake()
        }
      }
      const onWindowResize = () => {
        position = {
          left: clamp(position.left, 0, window.innerWidth - PET_W),
          top: clamp(position.top, 0, window.innerHeight - PET_H),
        }
        applyPosition()
        rectCache = null
        closeMenu()
      }
      const onScroll = () => {
        rectCache = null
      }

      const onReducedMotionChange = (event) => {
        reduced = event.matches === true
        if (!reduced) {
          // 从 reduced 切回来：先摘掉内联 animation:none / transform，否则动作动画会被压住
          clearPoseInline()
          scheduleAction()
          scheduleSleep()
          scheduleHunger()
          return
        }
        // 切到 reduced：立刻停掉正在播的动作/粒子，别等它自己结束
        stopExtras()
        clearActions()
        root.classList.remove('is-jumping', 'is-yawn', 'is-hungry')
        window.clearTimeout(hungerShowTimer)
        acting = false
        window.clearTimeout(actionTimerId)
        bubble.classList.remove('is-on')
      }

      root.addEventListener('pointerdown', onPointerDown)
      root.addEventListener('pointerenter', onPointerEnter)
      root.addEventListener('pointerleave', onPointerLeave)
      root.addEventListener('contextmenu', onContextMenu)
      root.addEventListener('keydown', onKeyDown)
      document.addEventListener('pointerdown', onDocumentPointerDown, true)
      document.addEventListener('keydown', onDocumentKeyDown, true)
      window.addEventListener('resize', onWindowResize)
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('pointermove', onGlobalPointerMove, { passive: true })
      reducedQuery?.addEventListener?.('change', onReducedMotionChange)
      // 切换回来一眼看到的是闭着眼的宠物最出戏：页面重新可见时先叫醒它。
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) wake()
      })

      document.body.append(layer)

      // —— 自测钩子：只有页面显式打开 __DSH_PET_DEBUG__ 时才挂全局，正常使用不暴露 ——
      if (window.__DSH_PET_DEBUG__) {
        window.__dshPetTest = {
          play: (name, ms) => playAction(name, ms),
          stop: () => {
            stopExtras()
            clearActions()
            // 测试时连自动动作的排期一起停掉，避免随机台词盖住断言要读的气泡
            window.clearTimeout(actionTimerId)
            window.clearTimeout(hungerTimer)
            window.clearTimeout(hungerShowTimer)
            root.classList.remove('is-hungry', 'is-jumping', 'is-yawn')
            acting = false
          },
          // 只给测试用：把宠物摆到指定坐标（真实交互里只有拖动会改位置）
          place: (left, top) => {
            position = { left, top: top ?? position.top }
            applyPosition()
          },
          flags: () => ({
            root: Array.from(root.classList),
            rig: Array.from(rig.classList),
            walking: walk !== null,
            signOn: sign.classList.contains('is-on'),
            signText: sign.textContent,
            faceRight: root.classList.contains('is-face-right'),
            left: Math.round(position.left),
            top: Math.round(position.top),
            lastAction,
            actUp: root.style.getPropertyValue('--act-up'),
            actDown: root.style.getPropertyValue('--act-down'),
            bubble: bubble.textContent,
            bubbleOn: bubble.classList.contains('is-on'),
            reduced,
            feeding,
            feedStage,
            mealNap,
            fartCount,
            puffs: root.querySelectorAll('.pet-puff i').length,
            puff: puffEl !== null,
            burp: burpEl !== null,
            burpQuiet: burpEl !== null && burpEl.classList.contains('is-quiet'),
            wisps: root.querySelectorAll('.pet-burp-wisp').length,
            clouds: root.querySelectorAll('.pet-puff b').length,
            rings: root.querySelectorAll('.pet-fart-ring').length,
            staticPuffs: root.querySelectorAll('.pet-puff-static').length,
            // 真·食物 / 真·屎实体：在不在 DOM
            food: foodEl !== null,
            foodFile,
            poop: poopEl !== null,
            poopFading: poopEl !== null && poopEl.classList.contains('is-fading'),
          }),
          /** 只给测试：两个实体的几何/可见性（含是否出界、是否落在脸以下）。 */
          entities: () => ({ food: describeEntity(foodEl), poop: describeEntity(poopEl) }),
          /** 只给截图：把当前食物/屎冻结在某毫秒（配合 hold()，先停进食链再冻结）。 */
          holdFood: (atMs) => holdEntity(foodEl, atMs),
          holdPoop: (atMs) => holdEntity(poopEl, atMs),
          // 动作元数据给测试读：不把时长/权重写死在测试里
          actions: () => ({ ms: { ...ACTION_MS }, weights: { ...ACTION_WEIGHTS } }),
          // 只给测试用：模拟系统开启「减少动态效果」，走的是同一条 reduced 分支
          setReduced: (value) => onReducedMotionChange({ matches: value === true }),
          bubbleBox: () => {
            const rect = bubble.getBoundingClientRect()
            return {
              text: bubble.textContent,
              on: bubble.classList.contains('is-on'),
              below: bubble.classList.contains('is-below'),
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height,
              whiteSpace: window.getComputedStyle(bubble).whiteSpace,
            }
          },
          say: (text, ms) => say(text, ms),
          feed: (options) => startFeeding(options ?? {}),
          /** 只给调试/截图：单独播一次打嗝（默认带身体上顶与「嗝…」气泡）。 */
          burp: (options) => playBurp(options ?? {}),
          /** 只给调试/截图：单独播一次放屁视觉（不走进食链、不安排小盹）。 */
          fart: () => playFartFx(),
          /** 只给测试：切换朝向（与走路时 setWalkDir 同一条路径）。 */
          face: (dir) => setWalkDir(dir >= 0 ? 1 : -1),
          /** 只给测试：特效 DOM 计数（与 flags 重叠，但不要靠轮询 className 猜阶段）。 */
          fx: () => ({
            burp: burpEl !== null,
            burpQuiet: burpEl !== null && burpEl.classList.contains('is-quiet'),
            wisps: root.querySelectorAll('.pet-burp-wisp').length,
            puffs: root.querySelectorAll('.pet-puff i').length,
            clouds: root.querySelectorAll('.pet-puff b').length,
            rings: root.querySelectorAll('.pet-fart-ring').length,
            staticPuffs: root.querySelectorAll('.pet-puff-static').length,
          }),
          // 只给截图用：把喂食/小盹的计时器停掉，但保留当前姿势、气泡、气团 DOM。
          // 不这样的话截图工具调用的几秒里，链早就走到下一段、气泡也淡没了。
          hold: () => {
            const frozenStage = feedStage
            clearFeedTimers()
            feedSeq += 1
            feeding = false
            feedStage = ''
            mealNapSeq += 1
            for (const id of napTimers) window.clearTimeout(id)
            napTimers = []
            window.clearTimeout(napZzzTimer)
            window.clearTimeout(bubbleTimer)
            // 打嗝/放屁的清理计时器也停掉，否则截图前 DOM 就被删了
            window.clearTimeout(burpBodyTimer)
            window.clearTimeout(burpCleanTimer)
            burpBodyTimer = 0
            burpCleanTimer = 0
            window.clearTimeout(fartFxTimer)
            window.clearTimeout(fartPuffTimer)
            fartFxTimer = 0
            fartPuffTimer = 0
            // 粒子和气团自带的移除计时器不归 feedTimers 管，克隆一份无计时器的静态节点；
            // 克隆会从动画第 0 帧重新开始，要把原节点的动画进度一起搬过去，截图才停在当前帧。
            const keepProgress = (at, target) => {
              const to = target.getAnimations()[0]
              if (to === undefined || typeof at !== 'number') return
              to.currentTime = at
              to.pause()
            }
            if (puffEl !== null) {
              const puffTimes = Array.from(puffEl.children).map((child) => child.getAnimations()[0]?.currentTime ?? 0)
              const snapshot = puffEl.cloneNode(true)
              const snapshotChildren = Array.from(snapshot.children)
              puffEl.remove()
              puffEl = snapshot
              root.insertBefore(snapshot, bubble)
              snapshotChildren.forEach((child, index) => keepProgress(puffTimes[index], child))
            }
            if (burpEl !== null) {
              const burpTimes = Array.from(burpEl.children).map((child) => child.getAnimations()[0]?.currentTime ?? 0)
              const burpSnapshot = burpEl.cloneNode(true)
              const burpChildren = Array.from(burpSnapshot.children)
              burpEl.remove()
              burpEl = burpSnapshot
              root.insertBefore(burpSnapshot, bubble)
              burpChildren.forEach((child, index) => keepProgress(burpTimes[index], child))
            }
            const fxSources = Array.from(fx.children)
            const fxTimes = fxSources.map((child) => child.getAnimations()[0]?.currentTime ?? 0)
            const fxSnapshot = fxSources.map((child) => child.cloneNode(true))
            fx.textContent = ''
            fxSnapshot.forEach((child, index) => {
              fx.append(child)
              keepProgress(fxTimes[index], child)
            })
            return { stage: frozenStage, puff: puffEl !== null, bubble: bubble.textContent }
          },
          feedState: () => ({
            active: feeding,
            stage: feedStage,
            history: feedHistory.map((entry) => ({ ...entry })),
            startedAt: feedStartedAt,
            fartCount,
            puffs: root.querySelectorAll('.pet-puff i').length,
            puff: puffEl !== null,
            nap: mealNap,
            options: { ...feedOptions },
          }),
          hunger: () => showHunger(),
          hungerState: () => ({
            rounds: hungerRounds,
            chance: hungerChance(),
            scheduled: hungerTimer !== 0,
            showing: root.classList.contains('is-hungry'),
          }),
          behavior: () => ({
            eatMs: EAT_MS,
            fullMs: FULL_MS,
            fartDelayMinMs: FART_DELAY_MIN_MS,
            fartDelayMaxMs: FART_DELAY_MAX_MS,
            fartBounceMs: FART_BOUNCE_MS,
            fartPuffMs: FART_PUFF_MS,
            burpMs: BURP_MS,
            burpCleanMs: BURP_CLEAN_MS,
            quietFxMs: QUIET_FX_MS,
            foodGulpMs: FOOD_GULP_MS,
            poopDelayMs: POOP_DELAY_MS,
            poopDropMs: POOP_DROP_MS,
            poopStayMs: POOP_STAY_MS,
            poopFadeMs: POOP_FADE_MS,
            mealNapChance: MEAL_NAP_CHANCE,
            mealNapMinMs: MEAL_NAP_MIN_MS,
            mealNapMaxMs: MEAL_NAP_MAX_MS,
            hungerMinMs: HUNGER_MIN_MS,
            hungerMaxMs: HUNGER_MAX_MS,
            hungerShowMs: HUNGER_SHOW_MS,
          }),
          cheer: () => cheer(),
          openChat: () => openChat(),
          targetSession: () => {
            const col = centerCol()
            return {
              ok: strongTarget(col) && weakTargetReady(col),
              strong: strongTarget(col),
              weak: weakTargetReady(col),
            }
          },
          composer: () => {
            const col = centerCol()
            const box = getComposer(col)
            return {
              found: box !== null,
              text: box === null ? '' : composerText(box),
              stateText: box === null ? null : editorStateText(box),
              sendDisabled: box === null ? null : (() => {
                const btn = getSendButton(box)
                return btn === null ? null : btn.disabled
              })(),
            }
          },
          sample: (times) => {
            const counts = {}
            for (let i = 0; i < times; i += 1) {
              const key = pickWeighted()
              counts[key] = (counts[key] ?? 0) + 1
            }
            return counts
          },
          sequence: (times) => {
            const out = []
            let previous = ''
            for (let i = 0; i < times; i += 1) {
              previous = pickWeighted(previous)
              out.push(previous)
            }
            return out
          },
          constants: () => ({
            durations: { ...ACTION_MS },
            weights: { ...ACTION_WEIGHTS },
            targetBot: TARGET_BOT,
            targetSessionId: TARGET_SESSION_ID,
            promptKeyword: PROMPT_KEYWORD,
          }),
        }
      }

      // —— 启动 ——
      scheduleSleep()
      scheduleAction()
      scheduleBlink()
      scheduleHunger()
      if (!reduced) {
        window.setTimeout(() => {
          if (!hidden && !sleeping) say('我回来啦', 2400)
        }, 900)
      }

      let hiddenBefore = false
      try {
        hiddenBefore = window.sessionStorage.getItem(HIDDEN_KEY) === '1'
      } catch {
        hiddenBefore = false
      }
      if (hiddenBefore) hide()

      return () => {
        window.clearTimeout(sleepTimer)
        window.clearTimeout(actionTimerId)
        window.clearTimeout(blinkTimer)
        window.clearTimeout(bubbleTimer)
        window.clearTimeout(menuTimer)
        window.clearTimeout(settleTimer)
        window.clearTimeout(hungerTimer)
        window.clearTimeout(hungerShowTimer)
        stopExtras()
        if (lookRaf !== 0) window.cancelAnimationFrame(lookRaf)
        root.removeEventListener('pointerdown', onPointerDown)
        stopTracking()
        root.removeEventListener('pointerenter', onPointerEnter)
        root.removeEventListener('pointerleave', onPointerLeave)
        root.removeEventListener('contextmenu', onContextMenu)
        root.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('pointerdown', onDocumentPointerDown, true)
        document.removeEventListener('keydown', onDocumentKeyDown, true)
        window.removeEventListener('resize', onWindowResize)
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('pointermove', onGlobalPointerMove)
        reducedQuery?.removeEventListener?.('change', onReducedMotionChange)
        if (window.__DSH_PET_DEBUG__) delete window.__dshPetTest
        layer.remove()
      }
    }

    /** ctx.get 是可选的取用方式：服务不在时返回 null，宠物照样显示。 */
    function getWorkspaceService(ctx) {
      let fallback = null
      for (const key of ['uiWorkspace', 'workspace']) {
        try {
          const service = ctx.get?.(key)
          if (service === undefined || service === null) continue
          if (typeof service.startSession === 'function') return service
          fallback ??= service
        } catch {
          // 忽略，继续试下一个 key
        }
      }
      return fallback
    }

    return {
      name: 'desktop-pet',
      apply(ctx) {
        // 桌面展示是可选项：关掉时不 mount（不占位、不装监听、不进菜单），对战与面板不受影响
        ctx.effect(() => {
          let dispose = null
          const sync = () => {
            if (desktopEnabled()) {
              if (dispose === null) dispose = mount(ctx)
            } else if (dispose !== null) {
              dispose()
              dispose = null
            }
          }
          sync()
          const timer = window.setInterval(sync, 1000)
          return () => {
            window.clearInterval(timer)
            if (dispose !== null) dispose()
          }
        }, 'desktop-pet: 右下角宠物浮层（可在菜单里关闭桌面展示）')
      },
    }
    }

    const game = __gameModule()
    const pet = __petModule()

    return {
      name: 'darena',
      inject: Array.from(new Set([].concat(game.inject || [], pet.inject || []))),
      apply(ctx) {
        const stopGame = game.apply ? game.apply(ctx) : undefined
        const stopPet = pet.apply ? pet.apply(ctx) : undefined
        return () => {
          try { stopPet?.() } catch { /* 忽略 */ }
          try { stopGame?.() } catch { /* 忽略 */ }
        }
      },
    }
  },
})
