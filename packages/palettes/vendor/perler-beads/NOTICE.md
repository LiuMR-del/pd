# 来源说明（vendor/perler-beads）

本目录文件**原样复制**自 perler-beads，未做任何修改，仅用于追溯和校验。

| 文件 | 原路径 | SHA-256 |
|---|---|---|
| `colorSystemMapping.json` | `src/app/colorSystemMapping.json` | `eb24997c62073e68f5c821a86f2f4ec75cc19825bec90b812f4dca4a61c75047` |
| `色号对应表.csv` | `色号对应表.csv`（仓库根目录） | `a6f648ef693d22de301107a7c7314140b77355fdea482fa0d776c0f24f57423b` |

- 来源仓库：<https://github.com/Zippland/perler-beads>
- Commit：`2efee730f73dd4eb472ebde443a022d11f98bc21`（2026-05-14）
- 协议：AGPL-3.0（原作者声明：请勿将其代码包装为闭源商业产品）
- 修改说明：本目录不修改。转换后的数据见 `../../data/palettes.json`，由 `scripts/build.ts` 生成。转换内容：改为按颜色列出的数组结构，加入 `altCodes`（取自 CSV 中「a/b」形式的备选色号），并生成色数档 `tiers`。

数据为 MARD 291 色的 HEX 值，以及 MARD / COCO / 漫漫 / 盼盼 / 咪小窝 五个品牌的色号对照。除 MARD 外，其他品牌按 MARD 色值映射，**不是实测色值**。
