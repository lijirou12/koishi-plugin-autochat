var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  reusable: () => reusable
});
module.exports = __toCommonJS(src_exports);
var import_koishi = require("koishi");
var import_koishi_plugin_chatluna = require("koishi-plugin-chatluna");
var import_chains = require("koishi-plugin-chatluna/chains");
var name = "autochat";
var reusable = true;
var inject = ["chatluna", "database"];
var Config = import_koishi.Schema.object({
  interval: import_koishi.Schema.number().description("定时任务的间隔时间（分钟）").default(60),
  prompt: import_koishi.Schema.string().description("发送给 AI 的内容模板，`{time}` 将被替换为当前时间。").default("现在是北京时间 {time}，请记录下来。"),
  channelId: import_koishi.Schema.string().description("要把回复发送到的频道 ID（QQ 号或群号）").required(),
  channelType: import_koishi.Schema.union(["group", "private"]).description("发送到群聊还是私聊").default("group"),
  botSelfId: import_koishi.Schema.string().description("（可选）指定用于发送消息的机器人 selfId，如果留空则使用第一个可用机器人。").default("")
  // name: Schema.string()
  //   .description('替换 ChatLuna 预设中的 {name} 变量')
  //   .default(''),
});
function buildSession(ctx, bot, config, content) {
  const s = bot.session();
  if (config.channelType === "group") {
    s.guildId = config.channelId;
    s.channelId = config.channelId;
    s.userId = "autochat";
  } else {
    s.guildId = "0";
    s.channelId = config.channelId;
    s.userId = config.channelId;
  }
  s.content = content;
  return s;
}
__name(buildSession, "buildSession");
function apply(ctx, config) {
  let intervalHandle = null;
  const loadedPlatforms = /* @__PURE__ */ new Set();
  const events = {
    "llm-queue-waiting": /* @__PURE__ */ __name(async () => {
    }, "llm-queue-waiting"),
    "llm-used-token-count": /* @__PURE__ */ __name(async () => {
    }, "llm-used-token-count")
  };
  async function sendOnce(customPrompt, sessionSource) {
    const bot = ctx.bots.find((b) => !config.botSelfId || b.selfId === config.botSelfId);
    if (!bot) {
      ctx.logger.warn("[autochat] 没有找到可用的 bot，取消发送。");
      return;
    }
    const timeStr = (/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const message = customPrompt && customPrompt.length > 0 ? customPrompt : config.prompt.replace("{time}", timeStr);
    const vSession = sessionSource ?? buildSession(ctx, bot, config, message);
    let room;
    if (config.channelType === "private") {
      room = await (0, import_chains.queryJoinedConversationRoom)(ctx, vSession);
    } else {
      room = await (0, import_chains.queryPublicConversationRoom)(ctx, vSession);
    }
    if (!room) {
      ctx.logger.warn("[autochat] 找不到对应房间，已跳过。");
      return;
    }
    try {
      const platform = room.model.split("/")[0];
      if (!loadedPlatforms.has(platform)) {
        ctx.logger.info(`[autochat] 等待平台 ${platform} 加载...`);
        await ctx.chatluna.awaitLoadPlatform(platform, 6e4);
        loadedPlatforms.add(platform);
        ctx.logger.info(`[autochat] 平台 ${platform} 已就绪。`);
      }
    } catch {
    }
    try {
      ctx.logger.info(`[autochat] 向房间发送: ${message}`);
      const replyMsg = await ctx.chatluna.chat(
        vSession,
        room,
        { role: "user", content: message },
        events,
        false
      );
      const reply = replyMsg?.content ?? "";
      if (!reply) return;
      ctx.logger.info(`[autochat] ChatLuna 回复: ${reply}`);
      const targetId = (config.channelType === "private" ? "private:" : "group:") + config.channelId;
      await bot.sendMessage(targetId, reply);
    } catch (err) {
      ctx.logger.error("[autochat] 调用 ChatLuna 失败", err);
    }
  }
  __name(sendOnce, "sendOnce");
  const startInterval = /* @__PURE__ */ __name(() => {
    if (intervalHandle) return;
    intervalHandle = ctx.setInterval(() => sendOnce(), config.interval * 60 * 1e3);
  }, "startInterval");
  startInterval();
  ctx.on("dispose", () => {
    intervalHandle?.();
    intervalHandle = null;
  });
  ctx.command("autochat [prompt:text]", "立即触发一次自动聊天", { authority: 1 }).usage("示例: /autochat 现在几点？").action(async ({ session }, prompt) => {
    await sendOnce(prompt, session);
  });
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name,
  reusable
});
