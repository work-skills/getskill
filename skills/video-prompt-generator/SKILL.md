---
name: video-prompt-generator
description: 视频提示词生成技能：为 Sora、Veo、Runway、可灵、即梦等主流视频生成模型编写高质量提示词。当用户需要生成 AI 视频提示词、优化视频描述、编写分镜脚本时使用。
---

# 视频提示词生成器

将用户的创意想法转化为专业级视频生成提示词，适配主流文生视频/图生视频模型。

## 适用模型

| 模型 | 提示词风格 | 时长 |
|------|-----------|------|
| OpenAI Sora 2 | 自然语言长描述，注重物理真实感 | 4-20s |
| Google Veo 3 | 结构化描述 + 原生音频提示 | 8s |
| Runway Gen-4 | 电影术语 + 镜头语言 | 5-10s |
| 快手可灵 2.x | 中文自然语言，主体+运动+氛围 | 5-10s |
| 字节即梦 | 中文短句堆叠，风格词前置 | 3-12s |

## 提示词结构（六要素）

按以下顺序组织提示词，缺失要素会导致模型自由发挥、结果不可控：

1. **主体（Subject）**：谁/什么，外观细节（年龄、服装、材质、颜色）
2. **动作（Action）**：正在做什么，动作的幅度与速度
3. **场景（Scene）**：环境、时间、天气、背景元素
4. **镜头（Camera）**：景别（特写/中景/全景）、运镜（推拉摇移/环绕/手持）、焦段
5. **光线（Lighting）**：光源方向、色温、氛围（黄金时刻/霓虹/逆光）
6. **风格（Style）**：写实/动画/胶片质感/导演风格参考、画质词（4K、35mm）

## 工作流程

1. **理解意图**：确认用户想要的画面、用途（广告/短片/社交媒体）、目标模型
2. **补全细节**：对缺失的六要素进行合理补全或向用户确认
3. **生成提示词**：输出目标模型对应的提示词（英文模型用英文，国产模型可用中文）
4. **给出负向提示**：列出常见缺陷词（deformed hands, extra limbs, blurry, watermark, text artifacts）
5. **提供变体**：给出 2-3 个不同风格/镜头方案的变体

## 示例

**用户输入**：一只猫在窗台上

**输出（Sora/Veo，英文）**：
> A fluffy orange tabby cat sitting on a sunlit wooden windowsill, slowly turning its head toward the camera with curious wide eyes, dust particles floating in warm afternoon light, rain-soaked city street blurred in the background, medium close-up shot with a slow subtle push-in, 35mm film look, shallow depth of field, golden hour lighting, photorealistic, 4K

**输出（可灵，中文）**：
> 一只橘色长毛猫坐在洒满阳光的木质窗台上，缓缓转头看向镜头，眼睛好奇地睁大，午后暖光中漂浮着微尘，背景是雨后模糊的城市街道，中近景，缓慢推镜头，胶片质感，浅景深，4K 超清

**负向提示词**：
> deformed paws, extra tails, blurry face, watermark, subtitles, jittery motion, morphing background

## 镜头语言速查

- 景别：extreme close-up / close-up / medium shot / wide shot / aerial view
- 运镜：dolly in/out、tracking shot、crane shot、orbit shot、handheld、FPV drone
- 速度：slow motion、time-lapse、real-time

## 注意事项

- 一个提示词只描述**一个连续镜头**，多场景请拆分为多段生成再剪辑
- 避免否定句式（"no people" 常失效），改用负向提示词参数
- 人物对话/口型优先选择支持音频的模型（Veo 3、Sora 2）
- 涉及真实人物肖像、品牌 Logo、影视 IP 的内容会被多数模型拒绝，需提前规避
- 物理交互复杂场景（倒水、系鞋带）易穿帮，提示词中明确物理细节可提高成功率
- 图生视频时提示词应聚焦"运动"而非重复描述静态外观

## 来源说明

本技能为 GetSkill 站内原创整理，方法论综合各视频模型官方提示词指南的公开资料。
