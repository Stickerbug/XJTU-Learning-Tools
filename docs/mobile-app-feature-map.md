# 移动交通大学功能与页面图谱

分析对象：`移动交通大学` Android APK `2.2.50 (131)`，包名 `com.supwisdom.xjtu`。APK SHA-256：`9b3d966ef4372cabc1beaadb5f6c3ec311f27708e6d79557ad55000493f4f82e5`。

分析来源包括 APK 的 `assets_extract/manifest.json`、`app-service.js`、Jadx 输出，以及公开的 XJTUToolBox 和 xjtu-toolbox-android 源码。结论来自静态代码和公开接口定义，实际可见服务会随学校门户配置、账号身份和当前会话变化。

## 主页面与子页面

### 首页

- 路由：`pages/tab/index/index`
- 顶部搜索：全局服务/资讯搜索，门户配置中打开时使用 `v1/search/globalSearch`。
- 首页栏目：轮播新闻、公告、推荐服务、常用服务、待办摘要、日程摘要和天气/网络入口。
- 服务卡片点击后通过 `appUrl` 或 `serviceUrl` 跳转；可进入应用 H5、外部网站、WebVPN/CAS 或门户内置页面。
- 首页的服务列表不是固定写死在 APK 中，而是由门户服务接口和配置动态返回，因此插件应优先同步当前门户菜单，并按用途重新分类。

### 服务

- 路由：`pages/tab/service/index`
- 子视图：我的服务、全部服务、最近使用、服务搜索、服务详情。
- 服务详情使用 `static/superappService.html`，参数包括服务名称、服务 ID、图标和 scheme URL。
- 公开的服务读取接口包括 `v1/service/getService`、`v1/service/getServiceInfo`、`v1/service/getAllServices`、`v1/service/getLastUsed` 和 `v1/service/search` 一类调用；服务的最终 URL 仍由门户配置返回。
- 可落地功能：常用服务收藏、用途搜索、当前页识别后直接跳转、把“空教室、课表、成绩、考试、图书馆座位”等服务固定到插件首页。

### 事务

- 路由：`pages/msgCenterTab/newtask/newtask`
- 一级列表：我的待办、我的已办、我发起的、我的待阅、我的草稿。
- 二级状态：进行中、已完成、挂起/中断、待阅等，具体标签由 `VUE_APP_TASK_SETTING` 配置控制。
- 只读接口集中在 `https://transaction.xjtu.edu.cn/ttc`，包括 `getToDoList`、`getHandleList`、`getInitiateList`、`getCirculatedList`、`getDrafts`、`getToDoListCount`、`getAppsCount` 和 `getNewsCount`。
- 可落地功能：未读事务摘要、按截止时间排序、将待办加入插件日程。办理、催办、审批等写操作暂不接入。

### 日程

- 路由：`pages/tab/schedule/schedule`
- 子视图：日视图、周视图、月视图、列表视图、日程详情、个人日历和公开日历。
- 日程接口位于门户日历服务，APK 中可见 `personal/list`、`getEventListByMobile`、`schedule/get`、`schedule/dic/list` 等调用。
- 一网通办还提供 `v1/calendar/share/schedule/getWeekOfTeaching`，可用于读取当前周课程。
- 可落地功能：今天/下一节课卡片、课表周视图、课程与教室联动、考试倒计时、ICS 导出。

### 我的

- 路由：`pages/tab/my/my`
- 子页面包含个人资料、账号与安全、绑定信息、隐私/协议、应用设置、帮助与关于。
- 只读用户接口：`api/v1/me/user`、`api/v1/me/portrait`、`api/v1/personal/app/user/completed/userCompletedStatus`。
- APK 还包含大量密码、短信、绑定和解绑接口，这些属于账号管理操作，不作为插件功能入口。

### 资讯与消息详情

- 资讯入口：`pages/msgCenterTab/news/news`，详情可以进入门户资讯详情或配置的外部新闻站点。
- APK 内置的跳转映射包含教务通知、研究生院通知、实践教学通知、科技在线、学术讲座和学生处通知等公开站点。
- 消息卡片可跳转事务详情、服务详情或日程详情；具体目标由消息类型和 `serviceUrl` 决定。

### 通用 H5 服务页

- 服务点击统一经过 `pages/webview/webview?url=...` 或服务跳转器。
- 跳转器会根据 `tokenAccept` 判断是否需要 CAS/一网通办会话，并处理外部站点、WebVPN 和门户内链接。
- 插件可读取当前页面的标题、主机名和链接，给出“打开对应校园工具/读取当前数据/复制链接”的快速操作。

## 已实现的第一批功能

插件新增“空教室”入口，直接使用当前浏览器中已经登录的教务系统会话：

- 动态读取校区和教学楼代码。
- 日期、校区、楼栋、开始/结束节次筛选。
- 查询全部楼栋，结果按楼栋分组。
- “空闲”模式读取所选时间段可用教室；“空闲和占用”模式用全楼教室名录计算占用情况。
- 最少座位数、教室类型筛选，显示教学座位和考试座位，支持复制教室名称。
- 查询入口同时出现在管理页和教务系统页面的插件弹窗。

接口路径来自公开工具源码并按正常学生会话调用：

- 校区代码：`POST /jwapp/code/83a986fc-e677-400e-99a4-c7bb39c2ca35.do`
- 教学楼代码：`POST /jwapp/code/551fbcc3-cf07-4566-af1e-fc7ce272ddc1.do`
- 空教室查询：`POST /jwapp/sys/kxjas/modules/kxjscx/cxkxjs.do`
- 查询参数：`XXXQDM`、`JXLDM`、`KXRQ`、`KSJC`、`JSJC`、`pageSize=500`、`pageNumber=1`

## 当前已实现的校园数据增强

管理页的校园数据面板已补充移动端图谱中优先级较高的只读能力：

- “今日中心”显示下一节课、今日课程、最近考试倒计时和 LMS 待办摘要。
- “今日中心”提供空教室、周课表、校园数据刷新和思源学堂快捷入口；待办按截止时间排序并标记临近/逾期项目。
- 课表支持列表与周视图，周视图可前后翻周，并可将当前选中周导出为 ICS 文件。
- 成绩面板提供按学分加权的平均分、平均绩点、未出成绩和低分课程统计，并展示成绩明细表。

这些入口沿用浏览器中已经登录的教务系统/一网通办会话；课表和成绩功能只读当前已获取的数据，不执行校园业务写操作。

## 后续优先级

1. “今天”首页：在现有今日中心上补充教室和空教室快捷按钮。
2. 成绩页：增加多学期切换，并保留现有加权平均分、绩点、未出成绩和低分课程标记。
3. 课表周视图：在现有周视图和 ICS 导出基础上，从课程直接打开 LMS 资料。
4. 事务摘要：扩展只读待办、待阅和截止时间提醒；当前今日中心仅汇总 LMS 待办。
5. 考勤摘要：沿用公开工具已验证的考勤读取接口，按课程显示出勤率和异常记录。
6. 全校课程检索：课程名、院系、校区、选修类别和时间冲突筛选。

这些功能均以当前账号已获得的正常会话和公开接口为基础，不使用密码代存、隐藏接口或权限绕过。
