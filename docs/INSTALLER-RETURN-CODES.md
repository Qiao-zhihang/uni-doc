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

UniDoc 同时提供基于 NSIS 的安装包。为确保返回码唯一、便于微软商店验证与排查，UniDoc 的 NSIS 安装程序定义并使用以下自定义返回码（基于 NSIS 的 `SetErrorLevel` / `Abort` 机制）：

UniDoc also provides an NSIS-based installer. To keep return codes unique and easy to validate and troubleshoot in the Microsoft Store, the UniDoc NSIS installer defines and uses the following custom return codes (built on NSIS `SetErrorLevel` / `Abort` mechanisms):

| 返回码 / Return Code | 含义 / Meaning |
| :--- | :--- |
| 0 | 安装成功 / Installation succeeded |
| 1 | 其他一般安装错误（权限不足、文件被占用等） / Other general installation error (e.g., insufficient permissions, file in use) |
| 2 | 用户取消安装或安装被中止 / Installation was cancelled by the user or aborted |
| 3 | 安装需要重启才能完成 / Installation requires a system restart to complete |
| 4 | 应用程序已存在于设备上 / The application already exists on the device |
| 5 | 另一个安装已在进行，需先完成才能继续 / Another installation is already in progress; it must be completed before continuing |
| 6 | 磁盘空间不足 / Insufficient disk space |
| 7 | 网络故障 / Network failure |
| 8 | 由于设备上启用了安全策略，安装期间拒绝了包 / The package was rejected during installation because a security policy is enabled on the device |

> 说明 / Note: 返回码 0、1、2 遵循 NSIS 原生约定（`SetErrorLevel` / `Abort`）；返回码 3–8 为 UniDoc 为微软商店故障排查定义的自定义值。所有返回码值均唯一。任何非 0 返回码均表示安装未成功完成，建议重新运行安装程序或检查系统权限。
>
> Note: Return codes 0, 1 and 2 follow the native NSIS conventions (`SetErrorLevel` / `Abort`); return codes 3–8 are custom values defined by UniDoc for Microsoft Store troubleshooting. All return code values are unique. Any non-zero return code means the installation did not complete successfully; we recommend re-running the installer or checking system permissions.

## 联系我们 / Contact Us

如有关于返回码的疑问，请联系：/ For questions about return codes, please contact:

- https://github.com/Qiao-zhihang/uni-doc