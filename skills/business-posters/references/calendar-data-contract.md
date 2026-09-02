# 经营日历数据契约

## 口径

页面主指标为“到账净收款”：

```text
有效销售单即时实收 + 独立客户收款单实际收款 - 销售退货实际退款
```

金额逐条转换为整数分后累计，模板不接触 CLI 原始明细。

## 只读命令

```text
ailit doctor --format json
ailit auth status --format json
ailit sale list -s <start> -e <end> -p <page> -z 100 --format json
ailit receipt list -s <start> -e <end> -p <page> -z 100 --format json
ailit receipt get <id> --format json
ailit sale return-list -s <start> -e <end> -p <page> -z 100 --format json
ailit report all --format json
```

`sale list` 使用 `bill_date` 与 `bill_pay_amt`，只计 `status=NORMAL` 且 `is_invalid=false` 的记录。`bill_pay_amt` 是开销售单当时的即时实收；`total_pay_amt` 是销售单当前累计已收快照，不能按原销售日期充当现金流，也不能与 `receipt list` 相加。`ailit v0.8.0–v0.8.1` 实测分页外层为 `total/list`，销售单已实测包含 `id/bill_date/total_amt/total_pay_amt/bill_pay_amt/owe_amt/settlement_status/acct_name/status/is_invalid`。

2026-08-22 已取得真实非空收款单并用同一稳定 `id` 对照 `receipt list/get`：收款日期为 `bill_date`，实际收款为 `total_amt`，状态为数值 `status=1`；账户拆分只在 `receipt get.items[]` 中提供，字段为 `acct_id/acct_name/acct_type/amt`。日历与月报都必须逐张执行列表/详情金额、日期、账户合计以及优惠和预存款检查。仅接受数值 `status=1`；出现其他状态时停止。当前样本 `preferential_amt/prepaid_amt` 均为 0；首次遇到非零值时停止。退货单仍缺非空样本，本期或对比期出现任何退货记录时直接停止生成，取得真实样本并完成 `return-list/get` 审计后才能启用退款计算。

## 收款意图边界

- “销售单本次实收/开单时收款”：只取 `sale list.bill_pay_amt`。
- “销售单当前已收/未收”：取 `total_pay_amt/owe_amt/settlement_status`，这是单据状态快照，不是期间到账。
- “后续回款/收款单”：只取 `receipt list` 经审计后的字段。
- “经营日历/某日到账/某月收款”：取 `bill_pay_amt + 独立收款单实际收款 - 实际退款`。
- 禁止用 `total_pay_amt + receipt list` 计算到账；这会重复计算后续回款。

## 分页与交叉校验

- 列表页必须同时包含 `total` 与 `list`。
- 固定页长 100；累计条数达到 `total` 才算完整。
- 跨页出现相同稳定 `id` 视为分页异常并停止。
- 生成“今天”的当前月且没有独立收款/退款时，月累计即时实收必须与 `report all.month.total_pay` 相符；差异超过 1 分时停止生成。自定义历史 `as-of` 不与包含更新数据的当前综合报表强行比较。

2026-08-22 的测试账套已验证：销售单即时实收使用 `sale list.bill_pay_amt`；独立收款单使用 `receipt list.total_amt`，并以 `receipt get.items[].amt` 对账和拆分渠道。`report sale-stat bill` 不含收款字段，不用于此模板。退货单采用严格失败策略：本期或对比期只要非空就停止生成，不读取候选金额字段。

## 日期与对比

- 当前月读取月初至今天；未来日期只显示日期。
- 历史月读取整月。
- 当前月与上月相同进度比较；历史月与上一个完整月比较。
- 上月同期为 0 时百分比为 `null`，页面百分比显示“—”，保留增加或减少的金额差。

## 派生指标

- 收款天数：每日到账净收款大于 0 的天数。
- 营业占比：收款天数 ÷ 当月已过日期数，保留一位小数。
- 营业日均收款：月累计到账净收款 ÷ 有收款天数；分母为 0 时为 `null`。
- 最高单日：按每日到账净收款取最大值；全月为 0 时金额为 0、日期为空。
- 经营提示：只保留无收款、连续无收款、今日最高、连续有收款、最高单日五类固定文案，不调用模型，不引用页面外数据。
- 单日到账净收款小于 0 时标记为“净退款”，趋势线画在零线以下。经营提示只使用上述五类已确认文案。
