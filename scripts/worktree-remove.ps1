# Removes a worktree under .worktrees/ safely. Its node_modules is a junction to the main checkout's:
# `git worktree remove` (and `gh pr merge --delete-branch`) recurse into the junction and delete the shared packages.
# Usage (from the repo root): powershell -File scripts/worktree-remove.ps1 m7
param([Parameter(Mandatory = $true)][string]$Name)
$ErrorActionPreference = "Stop"
$wt = Join-Path (Join-Path $PSScriptRoot "..\.worktrees") $Name
if (-not (Test-Path $wt)) { throw "No worktree at $wt" }
$nm = Join-Path $wt "node_modules"
if (Test-Path $nm) {
  $item = Get-Item $nm -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $item.Delete() } else { throw "$nm is a real folder, not a junction: remove it by hand" }
}
git worktree remove $wt
git worktree prune
