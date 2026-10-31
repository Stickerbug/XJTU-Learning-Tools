# 仙交学习工具 · 开发与交接说明

## 1. 项目身份与目标目录

- 中文名称：仙交学习工具
- 英文名称：XJTU Learning Tools
- 当前版本：0.4.6
- 目标 GitHub 仓库：https://github.com/Stickerbug/XJTU-Learning-Tools
- 目标工作目录（由后续对话执行）：`D:\XJTU Learning Tools`
- 项目形态：Chrome / Edge Manifest V3 浏览器扩展，无业务后端。
- 原名称“仙交下载助手 / XJTU Download Helper”已在当前源码中清理。

本仓库由旧项目 `xjtu-download-helper` 迁移而来，目标不是重新制作完整 LMS，而是以课程资源发现、搜索、预览和批量下载为主，并保留少量官方与专用工具入口。

## 2. 本次工作环境限制与转移方式

本次 Agent 只能直接写当前任务工作区，不能直接写 `D:\XJTU Learning Tools`。按用户最新决定，**本轮不推送 GitHub**，改用本地 Git 提交和 bundle 转移：

1. 在当前工作区创建并修改 `XJTU-Learning-Tools`。
2. 完成本地 Git 提交，保留版本历史。
3. 生成 `XJTU-Learning-Tools.bundle`，后续对话从该文件克隆到 D 盘。
4. GitHub 仓库仅作为以后需要时的远程地址，本轮没有推送要求。

本次 shell 中的 `gh` 位于 `C:\Program Files\GitHub CLI\gh.exe`，没有可用登录态；GitHub 集成写入也返回 404，因此不再尝试远程操作。

目标 GitHub 仓库在尝试提交前为空，本轮没有需要合并的已有代码。

## 3. 后续对话首先执行

bundle 位于：

`C:\Users\PC\Documents\kimi\tasks\2026-10-29\16-40-30-3b283518\XJTU-Learning-Tools.bundle`

在 PowerShell 中执行：

```powershell
git clone "C:\Users\PC\Documents\kimi\tasks\2026-10-29\16-40-30-3b283518\XJTU-Learning-Tools.bundle" "D:\XJTU Learning Tools"
Set-Location "D:\XJTU Learning Tools"
git remote set-url origin https://github.com/Stickerbug/XJTU-Learning-Tools.git
npm test
npm run check
```

如果 bundle 已被复制到其他位置，替换第一条命令中的路径即可。

如果已经通过 bundle 克隆并需要接收新的 bundle：

```powershell
git -C "D:\XJTU Learning Tools" pull "C:\Users\PC\Documents\kimi\tasks\2026-10-29\16-40-30-3b283518\XJTU-Learning-Tools.bundle" main
```

以后若决定推送，先完成 `gh auth login`，再使用正常 Git 工作流。

生成安装包：

```powershell
python scripts/package.py
```

安装包输出到项目父目录，文件名按 `manifest.json` 版本生成，例如 `xjtu-learning-tools-0.4.2.zip`。

## 4. 当前架构

### 核心文件

- `manifest.json`：扩展名称、版本、权限和入口。
- `background.js`：RMS 授权、下载地址解析、预检、队列、暂停/继续/取消/重试、本地任务状态。
- `content/lms.js`：在当前登录态中调用 LMS 同域接口，扫描课程、活动、公告、提交和待办。
- `content/campus.js`：在教务系统/一网通办登录页读取校园数据、门户菜单和空教室状态。
- `shared/core.js`：纯函数，包含资源模型、URL 解析、文件命名、扫描结果整理、搜索和脱敏。
- `popup/`：当前回放双轨与当前 PDF 的轻量弹窗。
- `manager/`：批量下载、课程分类、任务和设置四页。
- `tests/core.test.mjs`：Node 内置测试。
- `scripts/extension_smoke.mjs`：在隔离 Edge 配置中实际加载 MV3 扩展并验证后台通信。
- `scripts/ui_smoke.mjs`：渲染弹窗、任务页和课程页截图；临时 HTTP 服务和浏览器会关闭。
- `scripts/package.py`：打包生产文件并校验 ZIP。
- `scripts/generate_icons.py`：可选的蓝红 PNG 图标生成器。

### 数据流

1. 内容脚本获取课程与活动数据。
2. 后台把结果整理为统一资源：课程、活动、来源、稳定 ID、文件密钥、大小。
3. 下载时重新获取临时地址，不把 LMS/RMS 令牌、预览令牌或签名 URL 持久化。
4. 下载前检查 HTTP 状态、Content-Type 和首段内容，拦截 HTML 登录页或挑战页。
5. 使用 `chrome.downloads` 落盘，本地只保存任务元数据和进度。

## 5. 已实现功能

### 原有功能（0.2.0 基础上保留）

- 当前回放页 LMS → player-url → RMS embed-token → captures 的授权链。
- 教师与课件双轨分别下载。
- PDF 与通用上传附件保存。
- 全课程扫描、混合文件批量下载。
- 媒体直链即时添加。
- 课程列表与按来源分类页。
- 队列、暂停、继续、取消、失败重试和任务记录。
- 西交蓝红、少圆角、无装饰性动画的界面。

### 本次新增（0.4.0）

- 全项目重命名为“仙交学习工具 / XJTU Learning Tools”。
- `lecture_live` 回放：
  - `external_live_detail.replay_id` 走 RMS；
  - `external_live_detail.replay_videos` 支持直接视频列表。
- 课程公告及公告附件：`/api/courses/{courseId}/bulletins`。
- 作业提交资源：
  - 个人与小组 `submission_list`；
  - 我的提交附件；
  - `submission_correct.uploads` 批阅附件；
  - `/api/submissions/{submissionId}/marked_attachments` 批注附件。
- 待办：`/api/todos?no-intercept=true`，管理页折叠显示。
- 附件预览：`/api/uploads/reference/document/{referenceId}/url?preview=true`。
- 富文本媒体：
  - `media.xjtu.edu.cn/download/file/...`；
  - `/api/uploads/{id}/in-rich-content`。
- 搜索：前缀、子串和紧凑汉字子序列，按相关度排序。
- 下载前首段预检，避免 HTML 被保存成课程附件。
- 下载任务摘要：进行中、已完成和累计下载大小。
- 设置页官方服务与专用工具链接。
- 校园门户：管理页集中展示常用教学、服务、信息和工具站点，支持分类筛选与关键词搜索。
- 校园门户同步同时读取一网通办动态服务目录 `POST /portal-api/v1/service/list`，补足首页菜单中未展示的服务入口。
- 当前页快捷识别：弹窗根据当前 LMS、教务、一网通办、学辅、新闻网和网络中心页面提供快捷入口。
- 空教室：按日期、校区、楼栋、节次读取教务系统空闲教室，可显示空闲/占用、座位数和教室类型并按楼栋汇总。
- 移动交通大学页面图谱：见 [`docs/mobile-app-feature-map.md`](docs/mobile-app-feature-map.md)。
- 管理页与弹窗的字号、间距、导航换行和窄屏布局优化。
- 课程资源总览统计、课程清单 JSON 导出和下载任务搜索/状态筛选。
- `/api/my-courses` GET 失败时 POST 回退。
- 作业截止时间优先使用列表中的 `deadline`。

### 本轮校园数据增强（0.4.1）

- 管理页新增“今日中心”：显示下一节课、今日课程数量与课程名、最近考试倒计时和 LMS 待办摘要。
- 今日中心提供“查空教室、打开周课表、刷新校园数据、打开思源学堂”快捷操作。
- 课表支持列表/周视图切换、周导航和“导出本周 ICS”；周视图按星期与节次排列课程，ICS 使用当前选中周生成日历事件。
- 成绩支持按学分计算加权平均分和平均绩点，并统计未出成绩、低分课程；明细表显示课程、成绩、学分、绩点、学期和状态。
- 待办按截止时间排序，并对今天、近 7 天和已逾期项目提供醒目标记。
- 新增考勤摘要：在本科/研究生考勤系统已登录页面中读取当前学期课程考勤，按课程和状态筛选缺勤、迟到、请假和待考勤记录。
- 新增图书馆座位空位查询：在图书馆页面会话中按楼层、区域读取实时空位和座位号。
- 新增校园卡摘要：读取余额、未结算金额和近 30 天消费流水，使用校园卡页面当前会话。
- 新增事务消息摘要：读取一网通办待办、校园消息、待使用预约和校车预约数量。
- 课程页支持本地课程、课程代码、学期和资源名称搜索；成绩支持按已返回的学期筛选统计。
- 上述校园面板继续使用当前浏览器会话读取到的校园数据，不新增写入操作或凭据持久化。

### 教务系统实测修复（0.4.2）

- 云端真实 Chromium 会话已完成统一认证并进入教务系统首页。
- 课表按教务系统真实字段读取教师、星期和节次，周视图与 ICS 导出可使用实际数据。
- 空教室查询在用户当前停留在教务首页时自动切换到空教室功能页，避免代码字典接口因页面上下文不匹配返回 404。
- 空教室楼栋按校区过滤，查询结果支持后端分页，避免楼栋教室超过单页数量时被截断。
- 实测空教室接口：兴庆校区、主楼 A、2026-11-02、第 1–2 节返回 13 间可用教室；实测课表接口返回当前学期课程数据。

### 图书馆入口修复（0.4.3）

- 图书馆座位页默认使用 WebVPN 入口，避免校外访问非标准 `8086` 端口返回 400。
- 保留校内直连入口；在 WebVPN 座位页中也支持同源读取 `qspace` 和 `qseat`。

### 页面快捷入口（0.4.4）

- 考勤摘要提供本科和研究生考勤系统直达按钮。
- 校园数据提供教务系统和一网通办直达按钮。
- 空教室提供功能页直达按钮。
- 当前考勤、教务、校园卡、事务消息、个人摘要和图书馆页面均可从管理页直接进入所需站点。

### 后台会话读取（0.4.5）

- 管理页没有对应校园标签页时，后台会创建非活动临时标签页，复用浏览器已有登录 Cookie 读取校园数据，完成后自动关闭。
- 覆盖教务课表/成绩/空教室、考勤、图书馆座位、校园卡、一网通办事务和个人摘要。
- 不保存账号密码；完全没有登录会话时，提示先完成一次统一认证，之后可继续使用后台读取。

### 空教室后台标签页修复（0.4.6）

- 等待后台标签页真正导航到目标站点后再发送消息，避免临时 `about:blank` 状态触发无效 URL 错误。
- 对临时标签页和现有标签页的地址解析增加明确错误提示。

## 6. 验证状态

已完成：

- 17 个 Node 单元测试全部通过。
- `npm run check` 语法检查通过。
- 本轮校园数据增强通过 `git diff --check`。
- Edge 中实际加载 MV3 扩展成功，后台启动与页面通信成功。
- 弹窗、任务页、课程页 UI 渲染通过。
- 课程页名称和“预览／打开”链接已检查。
- ZIP 打包及完整性校验通过。

界面渲染曾出现一次临时 Edge 超时，单独复测通过；未发现页面脚本错误。

尚未做 LMS 资源的真实账号全量扫描与下载；教务系统课表和空教室已完成真实会话只读验证。

## 7. 后续真实验证顺序

1. 加载扩展后刷新 LMS 页面，执行一次完整扫描，记录每门课程及来源的文件数。
2. 对照实际页面检查：
   - 一个 `lecture_live` 回放；
   - 一个公告附件；
   - 一个有提交和批阅附件的作业；
   - 一个待办测试。
3. 先下载小型 PNG/PDF，验证 `/blob` 与预检，不要一开始就下载大型双轨回放。
4. 再测试一个小型回放轨道，确认 RMS 授权、Range 预检和最终文件。
5. 测试暂停、继续、取消、失败重试和扩展重载后的队列恢复。
6. 若真实数据与模型不一致，先保存脱敏响应结构，不要把令牌或签名 URL 写入日志或 issue。

## 8. 已知边界与后续工作

- 全量扫描会对直播活动和作业详情发起更多请求，速度比 0.2.0 慢；应观察是否需按课程增量扫描或缓存。
- 当前用户 ID 通过 `/user/index` 的 `globalData.user` 结构解析；失败时提交资源会被跳过，其他资源不受影响。可后续改为更稳定的用户接口。
- `marked_attachments` 当前主要处理 `rules` 响应形态；其他历史形态仍可补充。
- 预检会多发一次 Range 请求；若学校服务对 Range 支持不一致，需要按真实失败样本调整。
- 直链只保存在内存，扩展重载后需重新添加。
- 考勤业务令牌只在当前考勤页面内存中使用；若页面不是统一认证回调后的会话，需要重新打开本科或研究生考勤登录入口。
- 图书馆座位接口使用 HTTP 移动端页面和当前校区会话，后续应由图书馆页面同源读取，不在管理页跨域请求，也不接入预约/换座写操作。
- 仲英学辅已加入链接和地址白名单，但“同时搜索学辅”尚未实现，属于后续功能。
- 拼音搜索、学辅下载、离线课程包、单课程刷新和可选隐藏提交/批阅分组尚未实现。
- 不要加入自动抢课、自动评教、校园卡或完整教务模块；这些保持官方或专用工具入口。

## 9. 图标说明

当前 GitHub 集成只可靠提交文本文件。为避免二进制 PNG 被损坏，源码的 manifest 暂不声明 PNG 图标，克隆后可直接加载，浏览器显示默认扩展图标。

`assets/` 和 `scripts/generate_icons.py` 保留了本地图标生成能力。后续使用正常 Git 工作流时可以：

1. 执行 `python scripts/generate_icons.py`；
2. 将 PNG 加入 Git；
3. 恢复 manifest 中的 `icons` 与 `action.default_icon` 字段；
4. 再提交二进制文件。

这项差异不影响功能，只影响工具栏图标外观。

## 10. 安全与维护约定

- 不持久化 Cookie、密码、RMS token、previewToken、签名 URL。
- 错误信息必须脱敏，禁止把签名参数写入诊断、issue 或交接文档。
- 资源地址只允许学校与学辅白名单域名。
- 默认只读扫描；不要自动提交作业、选课或评教。
- 修改代码后至少运行 `npm test`、`npm run check`；涉及 manifest 或后台时再运行 `node scripts/extension_smoke.mjs`。
- 后续 AI 应先阅读本文件和当前源码，不要回到旧的 `xjtu-download-helper` 目录继续修改。
