一些需求备忘点

开发之前,系统要求提供

- PRD 文档, 由于 PRD 可能太长, 提供一份摘要添加到 CLAUDE.md, 持续存在
- CLAUDE.md 要有文档索引
  - 完整PRD 文档
  - 数据契约文档,特别是前后端API
  - 数据实体,数据库表结构
  - UE 交互逻辑状态机
  - 业务流程图 flowchart
  - 设计系统 DESIGN.md


- 用 agent browser 替代 playwright 做测试
- 要支持在多个 coding plan 账号间切换
- 提供一个 skills 库,由 agent 判断是否要取用,例如提供支付相关的 skill,如果 task 是要开发支付模块,则安装,不要一次将所有可能的skill 都安装
- 可选: tasks.json 和 progress.txt 用一个直观的方式展现,例如 linear 看板
- 后续改进: failure.md 收集开发过程中错误,失败的情况,添加到 CLAUDE.md,保证后期不再犯同样错误,并给出收集报告

