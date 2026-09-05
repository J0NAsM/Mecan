<#
.SYNOPSIS
  Crea (o actualiza) el acceso directo de Mecan Cloud en el escritorio.

.DESCRIPTION
  El acceso directo abre una ventana que prepara la base, levanta el servidor y abre el navegador.
  Cerrar esa ventana detiene el sistema. No instala servicios ni modifica el arranque de Windows.

.PARAMETER Name
  Nombre visible del acceso directo. Por omisión "Mecan Cloud".

.PARAMETER Remove
  Elimina el acceso directo en lugar de crearlo.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\desktop-shortcut.ps1
#>
[CmdletBinding()]
param(
  [string]$Name = 'Mecan Cloud',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "$Name.lnk"

if ($Remove) {
  if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Host "Acceso directo eliminado: $shortcutPath"
  }
  else {
    Write-Host "No habia un acceso directo llamado '$Name' en el escritorio."
  }
  return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw 'No se encontro node en el PATH. Instala Node.js 24 o superior y vuelve a ejecutar este script.'
}

$launcher = Join-Path $projectRoot 'scripts\start-desktop.js'
if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Falta el lanzador: $launcher"
}

# El icono se genera por codigo; si aun no existe, se crea aqui para que el acceso quede completo.
$icon = Join-Path $projectRoot 'public\mecan.ico'
if (-not (Test-Path -LiteralPath $icon)) {
  & $node (Join-Path $projectRoot 'scripts\generate-icon.js') | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $node
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Inicia Mecan Cloud y abre el sistema en el navegador.'
if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = "$icon,0" }
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "Acceso directo creado: $shortcutPath"
Write-Host "  Destino     : $node"
Write-Host "  Argumentos  : $($shortcut.Arguments)"
Write-Host "  Carpeta     : $projectRoot"
Write-Host ''
Write-Host 'Al abrirlo se prepara la base, arranca el servidor y se abre el navegador.'
Write-Host 'Cerrar la ventana negra detiene el sistema.'
