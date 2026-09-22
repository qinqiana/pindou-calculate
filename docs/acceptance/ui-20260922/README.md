# 豆仓首页：库存优先与分组浏览

用户指出标题重复、221 色长列表难以浏览，随后明确选择“已录入的库存优先；全部色号按组展开”，并要求参考 Apple 设计规范。

最终实现：默认查看已录入库存，已录入的零余额继续保留；库存与全部色卡均按色系分组，每次展开一组。搜索始终查询全部 221 色，包含未录入色号，支持一键清除和空结果。顶部保留应用名与录入入口，盘点、补货和变动记录收在更多菜单；底栏保留三个稳定入口，配本项目绘制的图标。

参考 [Apple 分组列表](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[搜索](https://developer.apple.com/design/human-interface-guidelines/searching)、[字体层级](https://developer.apple.com/design/human-interface-guidelines/typography)和[底部导航](https://developer.apple.com/design/human-interface-guidelines/tab-bars)。库存优先和色系展开是用户确认的项目选择，不是 Apple 的强制规定。使用平台系统字体和自绘图标。

2026-09-22 在小米 14 Ultra / Android 15 官方标准基座上重新编译并运行。真机确认：全部色号初始为 9 组、0 条展开明细；展开 B 为 32 色，随后展开 C 为 29 色且 B 关闭；在“我的库存”中搜索 `c012` 找到未录入的 C12；错误查询显示空结果，清除后回到库存视图。412 CSS px 宽度无横向溢出，底栏六个图标文件实际同步并显示。首次命令行构建漏拷贝静态图标，改用绝对输入/输出路径后修正。

80 项应用测试通过，新增检查覆盖 221 色分组及已录入零余额；最终视图保护调整后又通过 2 项针对性检查及 Android 资源构建。本次手机交互只改变浏览状态，没有录入或修改账本数据。持久化与业务数据合同未改。

- [原首页](stock-before.png)
- [早期紧凑列表草稿，已被分组方案替代](stock-after.png)
- [当前默认库存首页](hig-owned.png)
- [当前全部色系浏览](hig-groups.png)

主会话已亲自检查真机截图；自行复核，未做独立 QA。视觉方案待用户验收；该记录不代表全部功能、正式 APK 或升级验收通过。
