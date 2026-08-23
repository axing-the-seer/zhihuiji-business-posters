# 客户对账单数据契约

## 连续流程

固定执行“客户查找 → 客户唯一确认 → 对账明细 → 金额核对 → 官方 PDF → 安全下载”。客户名称、日期和输出位置只通过标准输入 JSON 进入脚本，不拼接 Shell 命令。

## 命令与已验证字段

```text
ailit report customer-check list --keyword <name> --hide-zero=false -s <start> -e <end> -p <page> -z 100 --format json
ailit report customer-check detail <company-id> -s <start> -e <end> -p <page> -z 100 --format json
ailit customer print pdf <company-id> -s <start> -e <end> --format json
```

- 客户列表：`company_id/company_name/begin_tamt/should_pay_tamt/real_pay_tamt/back_tamt/preferential_tamt/owe_tamt/arrears_tamt/terminal_tamt/trim_tamt`。
- 对账明细：分页 `total/list/is_last_page`，逐笔使用 `should_pay_amt/real_pay_amt`，汇总使用 `sum_should_pay_amt/sum_real_pay_amt/sum_all_terminal`。实测 `sum_owe_amt` 可能为 0，不用于核对。
- 客户列表与对账明细不是相同汇总口径：列表 `should_pay_tamt/real_pay_tamt` 表示应收账款的新增和收回，明细 `sum_should_pay_amt/sum_real_pay_amt` 表示本期单据总额和本期实际收款总额。全额付款、部分付款、含税销售或收回以前欠款时，两组值本来就可能不同，禁止直接逐项比较。
- 固定核对关系：逐笔 `should_pay_amt` 合计等于 `sum_should_pay_amt`；逐笔 `real_pay_amt` 合计等于 `sum_real_pay_amt`；`sum_should_pay_amt - sum_real_pay_amt` 等于列表 `arrears_tamt`；`begin_tamt + arrears_tamt` 等于 `terminal_tamt`；列表 `terminal_tamt` 等于明细 `sum_all_terminal`。各项误差不超过 1 分。
- `sum_bill_real_amt` 在含税销售中不包含税额，不能用它减实收推导待收；单据待收与客户账款变动不是同一概念。
- 客户名称精确匹配且结果唯一时自动继续；多个候选时返回有限的客户名称列表，由用户确认后用 `company_id` 重试。

## PDF 安全规则

- 只接受 HTTPS 且主机名为 `space.zhihuiji.cn` 或已通过官方 CLI 实测的 `space-1319132088.cos.ap-beijing.myqcloud.com` 下载地址。
- 不跟随重定向；文件最大 25 MiB，必须非空且以 `%PDF-` 开头。
- 先写入同目录临时文件，验证成功后再改为正式文件名。
- 目标文件已存在时停止，不覆盖用户文件。
- 任一客户、分页、金额、下载地址或文件检查失败都不得报告导出成功。
