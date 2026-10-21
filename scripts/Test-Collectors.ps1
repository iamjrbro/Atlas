$ErrorActionPreference='Stop'
$errorsFound=@()
foreach($file in (Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1')) {
    $tokens=$null
    $parseErrors=$null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$parseErrors) | Out-Null
    $errorsFound+=@($parseErrors)
}
if($errorsFound.Count) { $errorsFound | ForEach-Object { Write-Error $_.Message }; exit 1 }
Write-Output 'Coletores PowerShell: sintaxe válida. Nenhum comando Microsoft foi executado.'
