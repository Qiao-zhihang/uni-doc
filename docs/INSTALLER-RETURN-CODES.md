# UniDoc 安装程序返回码文档 / UniDoc Installer Return Code Documentation

> 生效日期 / Effective Date: 2026-08-20
>
> 版本 / Version: 1.0

本页面记录了 UniDoc 安装程序（MSI / NSIS）可能返回的退出代码（Return Code / Exit Code）。这些代码用于微软商店安装验证与故障排查。

This page documents the return codes (exit codes) that the UniDoc installer (MSI / NSIS) may return. These codes are used by the Microsoft Store for install validation and troubleshooting.

## 通用返回值 / General Return Values

| 返回码 / Return Code | 含义 / Meaning |
| :--- | :--- |
| 0 | 安装成功 / Installation succeeded |
| 非 0 / Non-zero | 安装失败或已取消 / Installation failed or was cancelled |

## MSI 安装程序 / MSI Installer

UniDoc 提供 MSI 安装包。MSI 安装程序遵循 Windows Installer 标准返回码（Windows Installer 错误代码），常见值如下：

UniDoc provides an MSI package. The MSI installer follows the standard Windows Installer return codes. Common values:

| 返回码 / Return Code | 含义 / Meaning |
| :--- | :--- |
| 0 | 安装成功 / Installation succeeded |
| 1601 | 无法访问 Windows Installer 服务 / Cannot access the Windows Installer service |
| 1602 | 用户取消安装 / Installation was cancelled by the user |
| 1603 | 安装过程中发生致命错误 / Fatal error during installation |
| 1605 | 该产品未安装 / This product is not installed |
| 1612 | 安装源不可用 / The installation source is not available |
| 1618 | 另一个安装正在进行 / Another installation is already in progress |
| 1619 | 无法打开安装日志文件 / Could not open the installation log file |
| 1638 | 该产品的另一版本已安装 / Another version of this product is already installed |
| 1641 | 安装被挂起，要求重启以完成 / Installation suspended, restart required to complete |
| 3010 | 安装成功但要求重启以完成 / Installation succeeded, but a restart is required to complete |

完整的 Windows Installer 错误代码列表请参阅微软官方文档：

For the complete list of Windows Installer error codes, see the official Microsoft documentation:

- https://learn.microsoft.com/windows/win32/msi/error-codes
- https://learn.microsoft.com/windows/win32/msi/windows-installer-error-messages

## NSIS 安装程序 / NSIS Installer

UniDoc 同时提供基于 NSIS 的安装包。NSIS 安装程序遵循 NSIS 约定（`SetErrorLevel` / `Abort`），返回码如下：

UniDoc also provides an NSIS-based installer. It follows the NSIS conventions (`SetErrorLevel` / `Abort`). Its return codes are as follows:

| 返回码 / Return Code | 含义 / Meaning |
| :--- | :--- |
| 0 | 安装成功 / Installation succeeded |
| 1 | 安装过程中发生错误（如权限不足、文件被占用等） / An error occurred during installation (e.g., insufficient permissions, file in use) |
| 2 | 用户取消安装或安装被中止 / Installation was cancelled by the user or aborted |

> 说明 / Note: NSIS 安装程序仅在发生错误或用户主动取消时返回非 0 值。任何非 0 返回码均表示安装未成功完成，建议重新运行安装程序或检查系统权限。NSIS 未定义独立的"需要重启"返回码，需要重启时安装程序在完成相关处理后正常返回 0。
>
> NSIS installers only return a non-zero value on error or when the user actively cancels. Any non-zero return code means the installation did not complete successfully; we recommend re-running the installer or checking system permissions. NSIS does not define a separate "reboot required" return code; when a reboot is required the installer performs the necessary handling and returns 0 on normal completion.

## 联系我们 / Contact Us

如有关于返回码的疑问，请联系：/ For questions about return codes, please contact:

- https://github.com/Qiao-zhihang/uni-doc