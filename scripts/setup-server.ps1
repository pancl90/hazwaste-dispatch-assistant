param([ValidateSet('init','user')][string]$Mode = 'init')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
  $env:SETUP_USERNAME = Read-Host '请输入业务员账号（英文或数字，至少3位）'
  $env:SETUP_ORG = Read-Host '请输入组织ID（英文或数字，至少4位，例如 company-a）'
  $securePassword = Read-Host '请输入登录密码（至少12位）' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try { $env:SETUP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  & node scripts/admin.js $Mode
  if ($LASTEXITCODE -ne 0) { throw '初始化失败，请按上方提示处理。' }
  Write-Host '初始化完成。双击“启动同步工作台.cmd”即可使用。'
} catch { Write-Host $_.Exception.Message -ForegroundColor Red } finally {
  Remove-Item Env:SETUP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:SETUP_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:SETUP_ORG -ErrorAction SilentlyContinue
}
Read-Host '按回车关闭'
