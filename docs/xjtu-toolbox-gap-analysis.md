# XJTUToolBox 对照分析

分析对象：`/workspace/work/xjtu_repos/XJTUToolBox` 当前源码与文档。对照对象：本扩展 `0.4.13`。ToolBox 的登录实现是正常的统一认证流程，源码明确没有绕过验证码、二次认证或权限检查。

## 登录与会话

ToolBox 的核心优势不是某个单独接口，而是把登录过程做成了一个完整的会话层：

- `auth/new_login.py` 处理 CAS 表单、RSA 密码加密、验证码状态、MFA 手机验证、身份选择和登录结果。
- `app/utils/session_manager.py` 为普通网络和 WebVPN 维护共享 Session，避免不同模块重复登录或互相踢出。
- `app/utils/session_persistence.py` 使用 AES-256-GCM 加密 Cookie 和站点令牌，密钥放在操作系统 keyring 中，应用重启后可以恢复会话。
- `app/utils/account.py` 支持多个账号、账号切换和账号资料加密保存。
- `app/threads/LoginThreads.py` 和 `app/sub_interfaces/LoginInterface.py` 把 MFA、验证码和本科/研究生身份选择交给界面继续处理。

本扩展以前只复用浏览器已有 Cookie，后台临时页遇到未登录会直接失败。`0.4.13` 增加了“校园登录”页和统一认证桥接：扩展后台打开教务或一网通办入口，在 CAS 页填充用户主动输入的凭据并点击学校原生登录按钮，成功后的 Cookie 留在浏览器配置中，后续教务、考勤、一网通办和图书馆后台页可以复用。验证码、二次验证和身份选择会停在认证页，并提供“打开认证页”按钮继续处理。

密码默认只在当前登录流程的内存中使用；勾选“保存密码（加密）”后，密码以 AES-GCM 密文保存在浏览器本机，界面不回显，可随时清除。扩展不保存明文密码，也不读取 ToolBox 的账号文件或会话文件。

## 功能差距

| 领域 | XJTUToolBox 已实现 | 本扩展现状 | 后续优先级 |
| --- | --- | --- | --- |
| 认证 | 多账号、Cookie/令牌持久化、MFA/验证码/身份选择 | 浏览器 Cookie 复用；`0.4.13` 增加一键 CAS 登录和加密密码保存 | 高 |
| 课表 | 本科/研究生整学期课表、课程考勤详情 | 当前学期课表、周视图、ICS 导出 | 高：增加学期切换和课程详情 |
| 成绩 | 多学期成绩、平均分、绩点、课程自选 GPA、成绩分析 | 当前会话成绩汇总、加权平均和低分统计 | 高：多学期与自定义 GPA |
| 空教室 | 任意校区、全天节次查询、图片导出 | 兴庆默认、可切换校区/楼栋/节次、空闲/占用、分组压缩 | 中：全天模式和图片导出 |
| 考勤 | 整学期流水、按课程查看考勤详情 | 学期列表切换、整学期记录和缺勤/迟到筛选 | 中：课程明细 |
| 全校课程 | 学期、院系、校区、选修类别、时间筛选 | 已加入查询页，支持课程名、学期、院系、校区、选修类别、星期和节次筛选 | 已覆盖 |
| 评教 | 一键评教模板，可提交教务问卷 | 未接入 | 低：需要显式预览和确认 |
| 思源学堂 | 课程、回放、附件和批量下载 | 课程扫描、回放/课件/作业/批注/学辅下载 | 已覆盖并扩展 |
| 图书馆 | 座位、座位布局图片、我的预约 | 楼层/区域空位和座位号读取 | 中：布局、收藏、预约入口 |
| 校园卡 | 余额、消费流水 | 余额、状态、近 30 天流水 | 已覆盖 |
| 体育 | 体测学年和成绩 | 未接入 | 中 |
| 场馆 | 场馆、可用时段、订单 | 只有场馆入口 | 中 |
| 通知 | 教务处/学院订阅、去重、定时推送 | 一网通办消息和事务快照 | 中：订阅与通知中心 |
| 校历/学籍 | 校历图片、个人学籍档案 | 未接入 | 中 |
| WebVPN | 自动识别直连/WebVPN并缓存访问模式 | 使用浏览器 WebVPN 标签页读取 | 中：统一入口和状态检测 |
| 多平台 | Windows/macOS/Linux 桌面端、托盘和后台任务 | Chrome/Edge 扩展、浏览器后台页 | 产品形态不同 |

## 可复用接口清单

ToolBox 已经把部分高频接口封装成独立模块，适合迁移到扩展的内容脚本或后台标签页：

- 空教室：`POST /jwapp/code/83a986fc-e677-400e-99a4-c7bb39c2ca35.do`、`POST /jwapp/code/551fbcc3-cf07-4566-af1e-fc7ce272ddc1.do`、`POST /jwapp/sys/kxjas/modules/kxjscx/cxkxjs.do`。
- 全校课程：`/jwapp/sys/kcbcx/modules/bjkcb/dqxnxq.do`、`xnxqcx.do`、`/jwapp/code/44e02e19-e31b-4916-91b2-0a04380cbd3a.do`、`/jwapp/sys/kcbcx/modules/qxkcb/qxfbkccx.do`。
- 课表/考试：`/jwapp/sys/wdkb/modules/xskcb/xskcb.do`、`/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do` 及考试安排接口。
- 成绩：`/jwapp/sys/cjcx/modules/cjcx/xscjcx.do`；移动教务还提供 `jwapp.xjtu.edu.cn/api/biz/v410/score/*`。
- 评教：`/jwapp/sys/wspjyyapp/modules/xspj/*`、`/jwapp/sys/wspjyyapp/modules/wj/*` 和提交接口。
- 一网通办：`/portal-api/v1/calendar/share/schedule/getWeekOfTeaching`，用户信息位于 `authx-service.xjtu.edu.cn/personal/api/v1/personal/me/user`。
- 图书馆：`http://rg.lib.xjtu.edu.cn:8086` 下的 `qspace`、`qseat`、区域统计和座位布局接口。
- 体测：`https://tyxylp.xjtu.edu.cn/bdlp_h5_fitness_test/public/index.php/index` 的学年和成绩接口。
- 场馆：`app/venues/venue.py` 中的场馆、时段和订单接口。

这些接口都依赖正常账号会话，扩展只应在页面会话中读取，并对写操作保留明确的确认步骤。

## 目前已经补上的关键缺口

`0.4.13` 的新增文件和入口：

- `content/auth.js`：识别 CAS 登录页、填充密码登录表单、触发原生登录按钮并上报验证码/MFA/身份选择状态。
- `background.js`：管理登录流程、认证页标签、会话级凭据、成功后的 Cookie 复用和状态广播。
- `manager/manager.html`：新增“校园登录”页，支持教务系统/一网通办目标和认证页继续处理。
- `popup/popup.html`：增加“校园登录”快捷入口。

验证：`npm run check`、`npm test` 全部通过。实际首次登录仍需要用户在扩展页输入账号密码；若学校要求验证码或二次验证，完成一次后浏览器会话即可继续复用。

本版本进一步加入全校课程检索和考勤学期切换：课程目录支持学期、课程名、院系、校区、选修类别、星期和节次筛选；考勤可以在已读取的学期列表中切换并重新读取整学期记录。

## 推荐的下一批实现顺序

1. 全校课程检索：直接迁移 `jwxt/school_course.py` 的条件构造和分页，做成课程名、院系、校区、选修类别、节次筛选。
2. 多学期成绩与 GPA：增加学期列表、自定义 GPA 规则和成绩分析。
3. 整学期考勤：补足学期日期范围、课程汇总、异常记录定位。
4. 空教室全天模式：一次查询 1–11 节，按“整段空闲时长”排序，并保留当前的校区/楼栋折叠。
5. 图书馆座位布局：接入区域布局图片和收藏区域，保留只读查询作为默认入口。
6. 通知订阅与校历：把教务处、学院通知和校历合并到今日中心，提供可关闭的定时刷新。

