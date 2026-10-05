# 发布指南

发布由维护者手动执行。CI 检查、打包和上传构建附件，不自动发布新版本，也不持有写仓库的发布权限。

1. 更新 manifest.json、package.json、锁定文件根版本、src/numeric.ts 的引擎版本、相关 Skill 文档和 CHANGELOG.md；在 versions.json 中加入最低宿主 API 版本。
2. 运行 npm ci、npm run typecheck、npm test、npm run build，完成改动所需的真实宿主验收。
3. 运行 `python3 tools/package_release.py`，检查 release/版本号/ 的插件与内核 ZIP、许可和 SHA256SUMS.txt。打包器使用显式文件清单，拒绝版本或许可不一致。
4. 提交、推送并等待 CI 通过。创建并推送与 manifest.version 完全相同的标签，例如 `0.3.2`，不加 v 前缀。
5. 创建 GitHub Release，上传 release/版本号/ 内的文件，Beta 标记为 prerelease。
6. 用匿名访问核对仓库、Release 和下载内容。

```sh
npm run package
# 标签已创建并推送、CI 已通过后：
gh release create 0.3.2 release/0.3.2/* --verify-tag --prerelease --title "NoteCalc 0.3.2 Beta" --notes-file /路径/发布说明.md
```

命令版本必须替换成实际版本。发布附件包括 main.js、manifest.json、styles.css、LICENSE、THIRD-PARTY-NOTICES.txt、两个 ZIP 和 SHA256SUMS.txt，不加入凭据、原始宿主截图、会话记录或备份。

GitHub 开源发布不等于已上架 Obsidian 社区目录，社区提交另需遵循[官方流程](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)及宿主审查要求。
