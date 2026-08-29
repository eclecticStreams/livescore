$node = 'C:\Users\HPG\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  Write-Error "Bundled Node.js runtime was not found at $node"
  exit 1
}
& $node (Join-Path $PSScriptRoot 'server.js')
