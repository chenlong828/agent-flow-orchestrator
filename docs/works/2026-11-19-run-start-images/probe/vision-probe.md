# 视觉能力探针记录（2026-11-19）

## 目的

判断当前部署的模型路由是否真的接收图片，从而区分两件事：

1. 模型/网关不支持图片（功能无法成立）；
2. 模型/网关支持图片，但 client 的 pi-ai 模型条目没有声明 `input: ["text","image"]`，导致 ACP 报 `promptCapabilities.image=false`、`read_image` 在路由能力检查处被拒。

## 方法

用 Pillow 生成一张 320×120 PNG（深蓝底、黄框、白字 `IMAGE PROBE 42`、红色椭圆），保存为本目录 [`vision-probe.png`](vision-probe.png)，然后在本会话调用 `read_image` 读取。

复现命令：

```sh
/Users/chenlong/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 - <<'PY'
from PIL import Image, ImageDraw
img = Image.new("RGB", (320, 120), (18, 32, 64))
d = ImageDraw.Draw(img)
d.rectangle([10,10,310,110], outline=(240,200,60), width=3)
d.text((30, 40), "IMAGE PROBE 42", fill=(255,255,255))
d.text((30, 72), "red circle ->", fill=(255,120,120))
d.ellipse([220, 60, 290, 100], fill=(220,40,40))
img.save("/tmp/dsh-image-probe.png")
PY
```

## 结果

`read_image` 返回 `image/png image, 320x120 px, 2541 bytes`，并把图片作为图像内容块送入模型；模型能读出图中的 `IMAGE PROBE 42` 文本与红色椭圆。说明**本会话使用的模型路由接受图片输入**。

- 本会话模型：`hs-deepseek-flash-latest`（与 client 的 `S0_MODEL.model` 同名，见 `agent-flow-client/src/components/runtime/profile.ts`）。
- 图像 SHA-256：`b08fd772acc0cf6ab44cc9ceb0e4270712846b32383c8971941bd20f68f2921b`。

## 不能由此直接推出的结论

- 本会话的 provider 路由与 client 的 `hundsun-public` 路由**可能不是同一条**；client 侧仍需把模型条目的 `input` 声明为 `["text","image"]` 后，用一次真实 `read_image` 复验。
- 该探针只能证明「路由/模型可接收图片」，不能证明 `read_image` 工具已出现在 `--profile acp` 会话的工具目录里；后者需在 client 侧会话实测（预期在：`dsh-base` 挂载 `attachment-local` 与 `tool-fs`）。
