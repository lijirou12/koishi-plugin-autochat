var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
  interval: import_koishi.Schema.number().description("\u5B9A\u65F6\u4EFB\u52A1\u7684\u95F4\u9694\u65F6\u95F4\uFF08\u5206\u949F\uFF09").default(60),
  prompt: import_koishi.Schema.string().description("\u53D1\u9001\u7ED9 AI \u7684\u5185\u5BB9\u6A21\u677F\uFF0C`{time}` \u5C06\u88AB\u66FF\u6362\u4E3A\u5F53\u524D\u65F6\u95F4\u3002").default("\u73B0\u5728\u662F\u5317\u4EAC\u65F6\u95F4 {time}\uFF0C\u8BF7\u8BB0\u5F55\u4E0B\u6765\u3002"),
  channelId: import_koishi.Schema.string().description("\u8981\u628A\u56DE\u590D\u53D1\u9001\u5230\u7684\u9891\u9053 ID\uFF08QQ \u53F7\u6216\u7FA4\u53F7\uFF09").required(),
  channelType: import_koishi.Schema.union(["group", "private"]).description("\u53D1\u9001\u5230\u7FA4\u804A\u8FD8\u662F\u79C1\u804A").default("group"),
  botSelfId: import_koishi.Schema.string().description("\uFF08\u53EF\u9009\uFF09\u6307\u5B9A\u7528\u4E8E\u53D1\u9001\u6D88\u606F\u7684\u673A\u5668\u4EBA selfId\uFF0C\u5982\u679C\u7559\u7A7A\u5219\u4F7F\u7528\u7B2C\u4E00\u4E2A\u53EF\u7528\u673A\u5668\u4EBA\u3002").default("")
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
function apply(ctx, config) {
  let intervalHandle = null;
  const loadedPlatforms = /* @__PURE__ */ new Set();
  const events = {
    "llm-queue-waiting": async () => {
    },
    "llm-used-token-count": async () => {
    }
  };
  async function sendOnce(customPrompt, sessionSource) {
    const bot = ctx.bots.find((b) => !config.botSelfId || b.selfId === config.botSelfId);
    if (!bot)
      return;
    const timeStr = (/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const message = customPrompt?.length ? customPrompt : config.prompt.replace("{time}", timeStr);
    const vSession = sessionSource ?? buildSession(ctx, bot, config, message);
    const room = config.channelType === "private" ? await (0, import_chains.queryJoinedConversationRoom)(ctx, vSession) : await (0, import_chains.queryPublicConversationRoom)(ctx, vSession);
    if (!room)
      return;
    const [platform] = room.model.split("/");
    if (!loadedPlatforms.has(platform)) {
      await ctx.chatluna.awaitLoadPlatform(platform, 6e4);
      loadedPlatforms.add(platform);
    }
    const replyMsg = await ctx.chatluna.chat(
      vSession,
      room,
      { role: "user", content: message },
      events,
      false
    );
    const reply = replyMsg?.content;
    if (!reply)
      return;
    const targetId = (config.channelType === "private" ? "private:" : "group:") + config.channelId;
    await bot.sendMessage(targetId, reply);
  }
  const start = () => {
    if (intervalHandle)
      return;
    intervalHandle = ctx.setInterval(() => sendOnce(), config.interval * 60 * 1e3);
  };
  start();
  ctx.on("dispose", () => intervalHandle?.());
  ctx.command("autochat [prompt:text]", "\u7ACB\u5373\u89E6\u53D1\u81EA\u52A8\u804A\u5929").action(({ session }, prompt) => sendOnce(prompt, session));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name,
  reusable
});
