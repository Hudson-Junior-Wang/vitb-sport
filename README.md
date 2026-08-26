# VITB Sport

VITB Sport 是一个适配电脑和手机的健身与运动记录网站。界面仍由 GitHub Pages 静态托管；记录先保存在当前浏览器，并可在登录后通过 Supabase 在手机和电脑之间同步。

## 第一阶段功能

- Dashboard：今日计划、本周训练次数、运动时长、完成率、最近记录，以及可刷新恢复的实时组数计数器
- 实时计数组：开始时即建立“进行中”训练记录，每完成或撤销一组都即时同步；自动休息倒计时，结束后同一记录转为完成状态
- 力量训练：动作、部位、重量、组数、次数、休息、RPE、时长和备注
- 运动记录：跑步、游泳、跳绳、拳击、散打、骑行、徒步、球类和自定义运动；表单会随运动类型变化
- 周计划：训练日和运动日通过关联记录自动完成，删除记录会恢复为未完成；休息日可手动完成
- 饮食记录：热量、三大营养素、饮水和四类餐食
- 身体数据：体重、腰围、臀围等记录和趋势
- 数据分析：训练次数、运动时间、运动占比、力量、跑步、游泳和身体趋势
- Betty 与 Stephen 两个固定、互相独立的个人界面
- 训练、运动、计划、饮食和身体数据的独立权限设置
- JSON 数据导入、导出和本地清除
- 邮箱密码登录、离线本机缓存、旧数据合并和多设备自动同步

## 文件

- `index.html`：静态应用入口
- `styles.css`：响应式界面和打印样式
- `app.js`：本地数据模型、业务逻辑、表单和图表
- `cloud-config.js`：可公开的 Supabase Project URL 与 Publishable key
- `cloud.js`：登录、会话刷新、云端读写、轮询同步和离线恢复
- `supabase-setup.sql`：云端数据表与 Row Level Security 初始化脚本
- `CNAME`：GitHub Pages 自定义域名，必须保留为 `vitb-sport.com`

## 本地运行

推荐通过任意静态文件服务器预览，以获得与 GitHub Pages 一致的路径和网络请求行为。首次打开可登录同步账号，也可选择暂时仅在当前设备使用。

## Supabase 初始化

1. 在 Supabase Dashboard 打开 SQL Editor。
2. 新建查询，粘贴并运行 `supabase-setup.sql` 的全部内容。
3. 保持邮箱密码登录开启。网站使用同一个登录账号承载 Betty 与 Stephen 两个固定界面。
4. `cloud-config.js` 只能使用 Publishable key，禁止提交 Secret key、service_role key 或数据库密码。

数据表使用 `auth.uid()` 的 RLS 策略，匿名访问无表权限。每个登录账号只有一行完整应用状态，服务端更新时间用于检测其他设备的新版本。

## GitHub Pages

现有部署方式保持不变：

1. Settings → Pages → **Deploy from a branch**
2. 分支：`main`
3. 目录：`/ (root)`
4. 自定义域名由根目录 `CNAME` 提供，不需要修改 Porkbun DNS

开发应先在独立分支完成并验证；确认后通过 Pull Request 合并到 `main`，合并后 GitHub Pages 会发布静态文件。

## 数据与隐私

未登录时，记录只保存在当前浏览器。登录后，记录会同步到当前 Supabase 用户专属的数据行；RLS 阻止其他账号访问。浏览器缓存可支持短暂离线使用，恢复网络后会自动推送。仍建议定期在“隐私与数据”中导出 JSON 备份。
