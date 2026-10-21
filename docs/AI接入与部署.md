# 千问 AI 接入与部署

## 已预设

- 服务：阿里云百炼普通 API，北京地域。
- 模型：`qwen3.8-flash`；关闭思考，使用严格 JSON Schema 输出。
- 默认接口：`https://dashscope.aliyuncs.com/compatible-mode/v1`。
- 浏览器只请求同一网站的 `/api/ai`，百炼密钥只由 Cloudflare Pages Functions 使用。
- 通知识别保留原话。模型只提取原文片段，本地程序根据通知参考时间、当前班级课表、冬夏作息换算日期、小节与课间。结果先展示，点击应用后才写入表单。
- “下次某课前”需要唯一课程匹配。“下周”仅得到周范围，不猜具体截止日。旧消息的相对日期以用户设置的原消息时间为准。
- 活动可存为候选日程，再使用既有冲突检查决定是否参加；课程变更通知不会自动覆盖课表。
- 每日一句每天自动尝试一次，可手动换句。记录变化后旧事实的句子不再显示，可手动重新生成；失败显示本地内容。

## 在 Cloudflare 配置

在 Pages 项目的生产环境配置以下内容，然后重新部署：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `DASHSCOPE_API_KEY` | 北京地域百炼普通 API Key |
| Secret | `AI_ACCESS_TOKEN` | 自己生成的随机访问口令，24至512位，不能使用百炼 Key |
| D1 binding | `AI_DB` | 新建专用 D1 数据库并以此名称绑定 |
| 可选变量 | `AI_DAILY_LIMIT` | 每个访问口令每日调用上限，默认20，范围1至200 |
| 可选变量 | `DASHSCOPE_BASE_URL` | 百炼北京工作空间的新式接口地址；不填时使用上述默认地址 |

数据库首次使用会自动建立 `ai_quota` 表。只保存口令摘要、北京日期和调用计数，不保存通知、课表或 AI 输出。数据库是调用限额用途，个人事项的云同步尚未实现。为预览环境配置时，建议使用独立的口令与数据库，避免共享生产额度。

打开网站 → 更多 → API 与服务连接：

1. 填写网站访问口令，选择需要的 AI 功能并保存。
2. “验证配置与口令”只检查配置及授权，不调用百炼。
3. “测试模型连接”实际调用一次；成功才说明百炼密钥和模型权限有效。

浏览器中不填写百炼 Key。网站访问口令仅存于本次浏览会话；重新打开浏览器可能需要重填。密钥不应写进源码、GitHub、URL、日志或普通 JSON 备份。不要在聊天中发送真实密钥。

## 限额与失败处理

- 通知识别、每日一句和模型测试共用每分钟2次、每天默认20次的服务端额度。
- 分钟按服务端自然分钟计数；浏览器额外按滚动60秒限制。每日按北京时间午夜重置。
- 预留调用次数后才请求模型。上游失败仍计一次，避免错误重试持续产生开销。
- 访问口令缺失/错误、用量数据库不可用时不会请求百炼。关闭浏览器开关停止自动请求。
- 一次通知最多识别6项，不自动批量创建提醒。无日期的随手记不视为信息不足；有实际歧义时才标为待确认。
- 通知超时、字段缺少原文依据、日期冲突、结果被截断时不自动写入；原话仍可直接保存。
- 结构化输出只保证格式，不保证语义正确。重要时间仍可以在预览与表单中修改。

## 本地开发

`local_preview.py` 是静态预览，不运行 Pages Functions；此时仍能保存个人记录、使用本地每日一句。要测试真实 AI，使用已配置的在线网站，或使用 Wrangler Pages 开发模式，并在未提交的 `.dev.vars` 和本地 D1 binding 中配置。`.dev.vars` 已被忽略。

验证命令：

```text
node tests/notice-model.test.mjs
node tests/ai-service.test.mjs
node tests/daily-assistant.test.mjs
node tests/personal-items.test.mjs
node tests/agenda.test.mjs
```

网关测试使用模拟的模型响应与真实内存 SQLite 验证配额，不会消耗真实百炼额度；实际模型连通性需要在配置真实密钥后验证。

## 官方资料

- [百炼 OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)
- [结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)
- [文本生成模型](https://help.aliyun.com/zh/model-studio/text-generation-model)
- [Pages Functions 路由](https://developers.cloudflare.com/pages/functions/routing/)
