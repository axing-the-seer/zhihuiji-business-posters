# 经营月报数据契约

## 输出与页面

固定生成三张 `1080×1620` PNG：

1. 经营概览：销售额、上期对比、经营结论、经营利润、总收入、总支出、实收、销售单数、累计销售趋势。
2. 商品与库存：进货总金额、进货次数、进货商品种数、商品销量 Top 5、商品利润 Top 5、低库存与缺货商品。
3. 资金与客户：收款渠道、回款率、当前待收、客户欠款、客户贡献。

金额进入标准化模型前逐项转换为整数分；模板不直接接触 CLI 原始明细。

## 只读命令

```text
ailit doctor --format json
ailit auth status --format json
ailit report sale-stat bill -s <start> -e <end> -p <page> -z 100 --format json
ailit sale list -s <start> -e <end> -p <page> -z 100 --format json
ailit receipt list -s <start> -e <end> -p <page> -z 100 --format json
ailit receipt get <id> --format json
ailit sale return-list -s <start> -e <end> -p <page> -z 100 --format json
ailit report fund-profit -s <start> -e <end> --format json
ailit purchase list -s <start> -e <end> -p <page> -z 100 --format json
ailit report purchase-stat -s <start> -e <end> -p 1 -z 100 --format json
ailit report sale-stat product -s <start> -e <end> -p <page> -z 100 --format json
ailit report sale-stat customer -s <start> -e <end> -p <page> -z 100 --format json
ailit report operator-achieve -s <start> -e <end> -p <page> -z 100 --format json
ailit customer debt -p <page> -z 100 --format json
ailit stock low --threshold 5 --format json
ailit stock out --format json
ailit report all --format json
```

## 已验证字段

基于 `ailit 0.8.0`、2026-08-22 的已登录测试店铺实测。

- 销售趋势：`report sale-stat bill.list[].bill_date`、`total_amt`。
- 销售单：`sale list.list[].id`、`bill_date`、`total_amt`、`total_pay_amt`、`bill_pay_amt`、`owe_amt`、`settlement_status`、`acct_name`、`status`、`is_invalid`。其中 `bill_pay_amt` 是开单即时实收，`total_pay_amt` 是销售单当前累计已收；后者不用于期间到账聚合。
- 经营利润：`fund-profit.sum_in_v2`、`sum_out_v2`、`sum_profit_v2`、`sale_in`。必须满足 `sum_profit_v2 = sum_in_v2 - sum_out_v2`，并用 `sale_in` 交叉校验销售额。
- 进货单：`purchase list.id`、`status`、`total_amt`。有效进货单数量用于“进货次数”，并用有效单金额合计交叉校验进货统计。
- 进货汇总：`purchase-stat.total`、`list`、`sum_total_amt`、`sum_product_count`、`sum_purs`。`total` 用作进货商品种数，`sum_total_amt` 用作进货金额；`sum_purs` 实测可能为 0，不再用作进货次数。
- 商品：`product_id`、`product_name`、`main_unit_name`、`product_count`、`total_amt`、`cost_amt`、`profit_amt`、`profit_rate`。
- 客户销售：`company_id`、`company_name`、`sales`、`total_amt`、`profit_amt`。展示层按后端系统客户名精确匹配：`零售散客` 为零售散客图标，`批发散客` 为批发散客图标，其余为其他客户图标。
- 员工业绩：`operator_id`、`operator_name`、`sales`、`total_tamt`、`profit_tamt`、`cost_profit_ratio`。
- 客户欠款：`name`、`cur_amt`、`last_bill_date`；欠款为生成时命名客户的当前快照，系统默认客户 `零售散客/批发散客` 即使存在未收销售单也不出现在此接口。`cur_amt` 可包含期初余额、历史单据或人工调账，不能冒充报告月末欠款，也不能与报告期 `sale list.owe_amt` 强行对平；当前样本 `last_bill_date` 为空，不能据此推导账龄。
- 独立收款单：`receipt list` 使用 `id/bill_date/total_amt/status/company_name`；`receipt get.base.company_id` 才是可信客户 ID，列表 `company_id` 实测为 0；渠道来自 `receipt get.items[].acct_name/amt`。当前只覆盖 `preferential_amt=0` 且 `prepaid_amt=0` 的真实样本。
- 库存：`name`、`cur_stock`、`unit_name`、`cost_prc`；低库存和缺货均为生成时当前快照。进入标准化模型时按商品 ID 去重（缺少 ID 时按商品名），再按库存值重新归类：`cur_stock > 0` 进入 `risks.low_stock`，`cur_stock <= 0` 进入 `risks.out_of_stock`，并把报告视图中的库存统一标准化为 `0`，避免负库存穿帮。若同一商品同时出现正数与非正数快照，以非正数/缺货状态优先；两个集合互斥。因此渲染与后续问答都直接使用标准化后的风险集合，不得读取或推断原始重复行。

## 收款与渠道口径

实收沿用经营日历口径：

```text
有效销售单即时实收 + 独立客户收款单实际收款 - 销售退货实际退款
```

渠道由有效销售单 `bill_pay_amt/acct_name` 与独立收款单 `receipt get.items[].amt/acct_name` 合并。收款单列表与详情的日期、金额或账户合计不一致时停止生成。销售退货仍缺真实非空账户契约，首次出现时必须用 list/get 同一稳定 ID 样本审计；完成前不得把未知渠道计入“其他”。

收款类问题按意图拆分：

- 开单即时实收：`sale list.bill_pay_amt`。
- 销售单当前已收/待收：`total_pay_amt/owe_amt/settlement_status`，只作为单据状态快照。
- 后续客户回款：`receipt list.total_amt`，并用 `receipt get.items[].amt` 对账及拆分渠道。
- 月度到账：即时实收 + 后续回款 − 实际退款。
- 禁止把 `total_pay_amt` 与 `receipt list` 相加，避免后续回款重复计算。

## 分页与交叉校验

- 列表命令必须同时返回 `total/list`；固定页长 100，完整读取到 `total`。
- 跨页稳定 ID 重复、总数变化、提前空页或条数不符时停止。
- 当前月今天生成且独立收款/退货为空时，用 `report all.month.total_amount/total_sales/total_pay` 校验销售额、销售单数和实收；金额差异超过 1 分或单数不一致时停止。
- 当前与上期的经营利润都必须满足总收入减总支出关系。

## 日期与状态

- 当前月读取月初至生成日，并与上月相同进度比较；历史月读取完整自然月并与上一个完整月比较。
- 未来月份不生成。
- 真实汇总值为 0 时显示“本月无记录”或明确的 `0`，不能只留下空白图形。
- CLI 失败、字段缺失、分页不完整或交叉校验失败属于“数据获取失败”，必须停止生成，不能渲染成 0。

## 派生指标

- 销售额：按 `report sale-stat bill.total_amt` 逐日累计。
- 回款率：实收 ÷ 销售额；销售额为 0 时为 `null`。
- 经营利润率：经营利润 ÷ 销售额；销售额为 0 时为 `null`。
- 报告期单据当前待收：报告日期范围内有效销售单 `owe_amt` 合计，包含系统默认散客名下的未收单；它不是全部命名客户当前欠款。
- 上期对比：`(本期 - 上期) ÷ 上期`；上期为 0 时百分比为 `null`。
- 进货对比：进货金额、有效进货单数和进货商品种数分别与上月同期比较；模板可选择显示或隐藏，数据口径不变。
- 经营结论和行动建议：只使用标准化模型内的数据，由少量固定规则生成，不调用自由模型，不引入页面外信息。
