<#
.SYNOPSIS
  Tests for publish-release.ps1 (REL-1). Windows PowerShell 5.1. Touches ONLY scratch repositories under %TEMP% and, with -RealRepoProbe,
  runs read-only / guaranteed-to-be-rejected commands against the real worktree (no staging, no commit, no push is possible there).

.DESCRIPTION
  Scratch scenario: a bare "remote" + a main repository + a LINKED worktree on the release branch, a base commit pushed to remote main, and three
  manifests that mimic the real layout (paths with "(dashboard)" and "[id]", an excluded `.next-*` folder and PNG, a tracked file that is modified).
  Every negative case asserts: exit code 1, the expected reason in the output, HEAD unchanged, index empty, nothing pushed.
  Fake-git cases prove that a non-zero exit code of ANY single git call (status, add, diff --check, commit, push) stops the run before the next step.
#>
[CmdletBinding()]
param([switch]$RealRepoProbe, [string]$Only = '')

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$Script = Join-Path $PSScriptRoot 'publish-release.ps1'
$Branch = 'codex/integracion-126-127-b2b'
$Fail = New-Object 'System.Collections.Generic.List[string]'
$Total = 0
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$RealGit = (Get-Command -Name 'git.exe' -CommandType Application | Select-Object -First 1).Source

function G([string]$Dir, [string[]]$GitArgs) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $RealGit
  $psi.Arguments = (@('-C', $Dir) + $GitArgs | ForEach-Object { if ($_ -match '[\s"]' -or $_ -eq '') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync(); $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw "scratch git failed ($($p.ExitCode)): $($GitArgs -join ' ') :: $($e.Result)" }
  return $o.Result.TrimEnd("`r", "`n")
}
function Put([string]$Root, [string]$Rel, [string]$Text) {
  $f = Join-Path $Root ($Rel -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $f) | Out-Null
  [System.IO.File]::WriteAllText($f, $Text, $Utf8)
}

function New-Scratch([string]$Tag) {
  $base = Join-Path ([System.IO.Path]::GetTempPath()) ("rel1-" + $Tag + "-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $remote = Join-Path $base 'remote.git'; $main = Join-Path $base 'main'; $wt = Join-Path $base 'wt'
  New-Item -ItemType Directory -Force -Path $base | Out-Null
  [void](G $base @('init', '--bare', '-b', 'main', $remote))
  [void](G $base @('init', '-b', 'main', $main))
  foreach ($kv in @(@('user.name', 'Scratch Tester'), @('user.email', 'scratch@example.invalid'), @('core.autocrlf', 'false'))) { [void](G $main @('config', $kv[0], $kv[1])) }
  Put $main 'dspacios-travel/README.md' "base`n"
  Put $main 'dspacios-travel/lib/existing.ts' "export const a = 1;`n"
  [void](G $main @('add', '-A')); [void](G $main @('commit', '-q', '-m', 'base'))
  $sha = G $main @('rev-parse', 'HEAD')
  [void](G $main @('remote', 'add', 'origin', $remote)); [void](G $main @('push', '-q', 'origin', 'main'))
  [void](G $main @('fetch', '-q', 'origin'))
  [void](G $main @('worktree', 'add', '-q', '-b', $Branch, $wt, 'HEAD'))
  $dir = 'dspacios-travel/docs/tecnico/release-126-127-b2b'
  # releasable content
  Put $wt 'dspacios-travel/supabase/migrations/20260601000312_x.sql' "select 1;`n"
  Put $wt 'dspacios-travel/supabase/migrations/20260601000313_y.sql' "select 2;`n"
  Put $wt 'dspacios-travel/app/(dashboard)/dashboard/[id]/page.ts' "export const p = 1;`n"
  Put $wt 'dspacios-travel/lib/existing.ts' "export const a = 2;`n"                          # tracked, modified
  Put $wt 'dspacios-travel/docs/tecnico/note-a.md' "# a`n"
  Put $wt 'dspacios-travel/docs/tecnico/note-b.md' "# b`n"
  # excluded content that must stay out
  Put $wt 'dspacios-travel/.next-old/build.js' "x`n"
  Put $wt 'dspacios-travel/docs/tecnico/evidence-326/shot.png' "png`n"
  $m1 = @('dspacios-travel/supabase/migrations/20260601000312_x.sql', 'dspacios-travel/supabase/migrations/20260601000313_y.sql')
  $m2 = @('dspacios-travel/app/(dashboard)/dashboard/[id]/page.ts', 'dspacios-travel/lib/existing.ts')
  $m3 = @('dspacios-travel/docs/tecnico/note-a.md', 'dspacios-travel/docs/tecnico/note-b.md', "$dir/commit-1-database.txt", "$dir/commit-2-application-and-tests.txt", "$dir/commit-3-documentation-and-tooling.txt")
  Put $wt "$dir/commit-1-database.txt" (($m1 -join "`n") + "`n")
  Put $wt "$dir/commit-2-application-and-tests.txt" (($m2 -join "`n") + "`n")
  Put $wt "$dir/commit-3-documentation-and-tooling.txt" (($m3 -join "`n") + "`n")
  return [pscustomobject]@{ Base = $base; Remote = $remote; Main = $main; Wt = $wt; Sha = $sha; ManDir = (Join-Path $wt ($dir -replace '/', '\')) }
}

function Invoke-Raw([string[]]$A) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command powershell.exe).Source
  $psi.Arguments = ((@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script) + $A) | ForEach-Object { if ($_ -match '[\s"(]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync(); $p.WaitForExit()
  return [pscustomobject]@{ Code = $p.ExitCode; Text = ($o.Result + "`n" + $e.Result) }
}
function Invoke-Release($S, [string[]]$Extra, [hashtable]$Env = @{}) {
  $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script, '-RepoRoot', $S.Wt, '-ManifestDir', $S.ManDir, '-BaseSha', $S.Sha) + $(if ($Extra -contains '-ExpectedCounts') { @() } else { @('-ExpectedCounts', '2,2,5') }) + $Extra
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command powershell.exe).Source
  $psi.Arguments = ($args2 | ForEach-Object { if ($_ -match '[\s"(]' ) { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
  foreach ($k in $Env.Keys) { $psi.EnvironmentVariables[$k] = $Env[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync(); $p.WaitForExit()
  return [pscustomobject]@{ Code = $p.ExitCode; Text = ($o.Result + "`n" + $e.Result) }
}

function Check([bool]$Cond, [string]$Msg) { $script:Total++; if (-not $Cond) { $script:Fail.Add($Msg); Write-Host "    FAIL: $Msg" -ForegroundColor Red } }
function Head($S) { return (G $S.Wt @('rev-parse', 'HEAD')) }
function Staged($S) { return (G $S.Wt @('diff', '--cached', '--name-only')) }

# A rejected run must: exit 1, mention the reason, leave HEAD where it was, leave the index empty and push nothing.
function Reject([string]$Name, $S, [string[]]$Extra, [string]$Reason, [hashtable]$Env = @{}) {
  if ($Only -and $Name -notlike "*$Only*") { return }
  $h = Head $S
  $r = Invoke-Release $S $Extra $Env
  $ok = ($r.Code -eq 1) -and ($r.Text -match $Reason) -and ((Head $S) -eq $h) -and ((Staged $S) -eq '')
  Write-Host ("  {0,-4} {1}" -f $(if ($ok) { 'ok' } else { 'FAIL' }), $Name)
  Check $ok "$Name (exit=$($r.Code); wanted /$Reason/; output: $(($r.Text -split "`n" | Where-Object { $_ -match 'STOP' } | Select-Object -First 1)))"
  $remoteBranch = G $S.Base @('--git-dir', $S.Remote, 'branch', '--list', $Branch)
  Check ($remoteBranch -eq '') "$Name left nothing on the remote"
}

function Section([string]$T) { Write-Host "`n== $T" }
$tmpRoots = New-Object 'System.Collections.Generic.List[string]'
function Fresh([string]$Tag) { $s = New-Scratch $Tag; $tmpRoots.Add($s.Base); return $s }

try {
  Section 'Rejections that must happen BEFORE anything is staged'
  $s = Fresh 'branch'; [void](G $s.Wt @('checkout', '-q', '-b', 'other-branch')); Reject 'wrong branch' $s @('-Mode', 'Check') "expected 'codex/integracion"
  $s = Fresh 'detached'; [void](G $s.Wt @('checkout', '-q', '--detach')); Reject 'detached HEAD' $s @('-Mode', 'Commit', '-Number', '1') 'detached HEAD'
  $s = Fresh 'maincheckout'; $r0 = $null
  if (-not $Only -or 'main checkout (not the linked worktree)' -like "*$Only*") {
    $h = G $s.Main @('rev-parse', 'HEAD'); $rr = Invoke-Raw @('-Mode', 'Check', '-RepoRoot', $s.Main, '-ManifestDir', $s.ManDir, '-BaseSha', $s.Sha)
    $o = $rr.Text; $code = $rr.Code
    Check (($code -eq 1) -and ($o -match 'main checkout') -and ((G $s.Main @('rev-parse', 'HEAD')) -eq $h)) "main checkout rejected (exit=$code)"; Write-Host ("  {0,-4} main checkout (not the linked worktree)" -f $(if ($code -eq 1 -and $o -match 'main checkout') { 'ok' } else { 'FAIL' }))
  }
  $s = Fresh 'upstream'; [void](G $s.Wt @('branch', '--set-upstream-to=origin/main')); Reject 'upstream already configured' $s @('-Mode', 'Commit', '-Number', '1') 'already has an upstream'
  $s = Fresh 'headmoved'; [void](G $s.Wt @('config', 'user.name', 'T')); [void](G $s.Wt @('config', 'user.email', 't@example.invalid')); [void](G $s.Wt @('commit', '-q', '--allow-empty', '-m', 'stray')); Reject 'HEAD is not the base' $s @('-Mode', 'Commit', '-Number', '1') 'expected the base'
  $s = Fresh 'staged'; [void](G $s.Wt @('add', '--', 'dspacios-travel/docs/tecnico/note-a.md')); $h = Head $s
  if (-not $Only -or 'index not empty' -like "*$Only*") { $r = Invoke-Release $s @('-Mode', 'Commit', '-Number', '1'); $ok = ($r.Code -eq 1) -and ($r.Text -match 'index is not empty') -and ((Head $s) -eq $h) -and ((Staged $s) -eq 'dspacios-travel/docs/tecnico/note-a.md'); Write-Host ("  {0,-4} index not empty at start (pre-existing staging is left untouched)" -f $(if ($ok) { 'ok' } else { 'FAIL' })); Check $ok 'index not empty at start' }
  $s = Fresh 'extra'; Put $s.Wt 'dspacios-travel/lib/unlisted.ts' "x`n"; Reject 'unexpected untracked file' $s @('-Mode', 'Commit', '-Number', '1') 'unexpected path'
  $s = Fresh 'missingfile'; Remove-Item -LiteralPath (Join-Path $s.Wt 'dspacios-travel\docs\tecnico\note-b.md'); Reject 'manifest path missing on disk' $s @('-Mode', 'Check') 'does not exist'
  $s = Fresh 'excludedman'; Put $s.Wt 'dspacios-travel/docs/tecnico/release-126-127-b2b/commit-1-database.txt' "dspacios-travel/supabase/migrations/20260601000312_x.sql`ndspacios-travel/.next-old/build.js`n"; Reject 'manifest lists an excluded .next-* path' $s @('-Mode', 'Check') 'forbidden path'
  $s = Fresh 'pngman'; Put $s.Wt 'dspacios-travel/docs/tecnico/release-126-127-b2b/commit-1-database.txt' "dspacios-travel/supabase/migrations/20260601000312_x.sql`ndspacios-travel/docs/tecnico/evidence-326/shot.png`n"; Reject 'manifest lists a PNG' $s @('-Mode', 'Check') 'forbidden path'
  $s = Fresh 'dup'; Put $s.Wt 'dspacios-travel/docs/tecnico/release-126-127-b2b/commit-1-database.txt' "dspacios-travel/supabase/migrations/20260601000312_x.sql`ndspacios-travel/supabase/migrations/20260601000312_x.sql`n"; Reject 'manifest has a duplicate line' $s @('-Mode', 'Check') 'duplicate path'
  $s = Fresh 'blank'; Put $s.Wt 'dspacios-travel/docs/tecnico/release-126-127-b2b/commit-1-database.txt' "dspacios-travel/supabase/migrations/20260601000312_x.sql`n`ndspacios-travel/supabase/migrations/20260601000313_y.sql`n"; Reject 'manifest has a blank line' $s @('-Mode', 'Check') 'empty line'
  $s = Fresh 'overlap'; Put $s.Wt 'dspacios-travel/docs/tecnico/release-126-127-b2b/commit-2-application-and-tests.txt' "dspacios-travel/supabase/migrations/20260601000312_x.sql`ndspacios-travel/lib/existing.ts`n"; Reject 'a path appears in two manifests' $s @('-Mode', 'Check') 'appears in manifests'
  $s = Fresh 'traversal'; Put $s.Wt 'dspacios-travel/docs/tecnico/release-126-127-b2b/commit-1-database.txt' "dspacios-travel/supabase/migrations/20260601000312_x.sql`ndspacios-travel/../outside.txt`n"; Reject 'manifest has a parent-directory segment' $s @('-Mode', 'Check') 'forbidden path'
  $s = Fresh 'count'; Reject 'manifest size differs from the expected count' $s @('-Mode', 'Check', '-ExpectedCounts', '9,9,9') 'expected 9'
  $s = Fresh 'deleted'; Remove-Item -LiteralPath (Join-Path $s.Wt 'dspacios-travel\README.md'); Reject 'tracked file deleted in the working tree' $s @('-Mode', 'Check') 'not plain modified'
  $s = Fresh 'untrackedmod'; Put $s.Wt 'dspacios-travel/README.md' "changed outside the manifests`n"; Reject 'modified tracked file outside the manifests' $s @('-Mode', 'Check') 'unexpected path'
  $s = Fresh 'commitnum'; Reject 'Commit without -Number' $s @('-Mode', 'Commit') 'requires -Number'
  $s = Fresh 'skip2'; Reject 'Commit 2 before commit 1' $s @('-Mode', 'Commit', '-Number', '2') 'ahead of the base'
  $s = Fresh 'pushearly'; Reject 'Push without the migrations confirmation' $s @('-Mode', 'Push') 'ConfirmMigrationsApplied'
  $s = Fresh 'pushnocommits'; Reject 'Push with -ConfirmMigrationsApplied but no commits' $s @('-Mode', 'Push', '-ConfirmMigrationsApplied') 'ahead of the base|expected 3'
  $s = Fresh 'wsgate'; Put $s.Wt 'dspacios-travel/supabase/migrations/20260601000313_y.sql' "select 2;   `n"
  Reject 'Check -Whitespace sees trailing whitespace (read-only)' $s @('-Mode', 'Check', '-Whitespace') 'whitespace gate'

  Section 'Staged-then-rejected: the helper restores the empty index and does not commit'
  $s = Fresh 'wscommit'; Put $s.Wt 'dspacios-travel/supabase/migrations/20260601000313_y.sql' "select 2;   `n"
  Reject 'diff --cached --check finding after staging' $s @('-Mode', 'Commit', '-Number', '1') 'diff --cached --check reported problems'

  Section 'A non-zero exit code of ANY single git call stops the run (fake git forwards everything else)'
  $fakeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("fakegit-" + [guid]::NewGuid().ToString('N').Substring(0, 8)); New-Item -ItemType Directory -Force -Path $fakeDir | Out-Null; $tmpRoots.Add($fakeDir)
  $fake = Join-Path $fakeDir 'git.cmd'
  [System.IO.File]::WriteAllText($fake, "@echo off`r`nif not defined FAKE_GIT_FAIL goto run`r`necho %* | findstr /C:`"%FAKE_GIT_FAIL%`" >nul && (echo fake failure of git %FAKE_GIT_FAIL% 1>&2 & exit /b 7)`r`n:run`r`n`"$RealGit`" %*`r`nexit /b %ERRORLEVEL%`r`n", [System.Text.Encoding]::ASCII)
  foreach ($case in @(
      @{ N = 'status'; Key = ' status '; Why = 'git status failed with exit code 7' },
      @{ N = 'rev-parse --show-toplevel'; Key = '--show-toplevel'; Why = 'failed with exit code 7' },
      @{ N = 'add'; Key = ' add '; Why = 'git add .* failed with exit code 7' },
      @{ N = 'diff --cached --name-status'; Key = '--name-status'; Why = 'failed with exit code 7' },
      @{ N = 'diff --cached --check'; Key = '--check'; Why = 'failed with exit code 7' },
      @{ N = 'commit'; Key = ' commit '; Why = 'git commit #1 failed with exit code 7' })) {
    $s = Fresh ('fake' + ($case.N -replace '\W', ''))
    Reject "fake git: '$($case.N)' exits 7" $s @('-Mode', 'Commit', '-Number', '1', '-GitPath', $fake) $case.Why @{ FAKE_GIT_FAIL = $case.Key }
  }

  Section 'Happy path on the scratch repository (real add/commit/push there; the real repository is never touched)'
  if (-not $Only -or 'happy path' -like "*$Only*") {
    $s = Fresh 'happy'
    $r = Invoke-Release $s @('-Mode', 'Check', '-Whitespace'); Check ($r.Code -eq 0 -and $r.Text -match 'CHECK PASSED') "Check passes (exit=$($r.Code)) $($r.Text)"
    Check ((Staged $s) -eq '' -and (Head $s) -eq $s.Sha) 'Check changed nothing'
    $expect = @{ 1 = 2; 2 = 2; 3 = 5 }
    foreach ($n in 1, 2, 3) {
      $r = Invoke-Release $s @('-Mode', 'Commit', '-Number', "$n"); Check ($r.Code -eq 0 -and $r.Text -match "COMMIT $n DONE") "Commit $n passes (exit=$($r.Code)) $($r.Text)"
      $files = @((G $s.Wt @('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')) -split "`n").Count
      Check ($files -eq $expect[$n]) "commit $n has $($expect[$n]) files (got $files)"
    }
    $log = (G $s.Wt @('log', '--format=%s', "$($s.Sha)..HEAD")) -split "`n"
    Check ($log.Count -eq 3) 'exactly three commits above the base'
    Check ((G $s.Wt @('log', '-1', '--format=%B')) -match 'Co-Authored-By: Claude Sonnet 5.5') 'commit message carries the attribution line'
    Check ((G $s.Wt @('ls-files', '--', 'dspacios-travel/.next-old', 'dspacios-travel/docs/tecnico/evidence-326')) -eq '') 'excluded folders are not tracked'
    Check ((G $s.Wt @('status', '--porcelain', '-uall')) -match '\.next-old' -and (G $s.Wt @('status', '--porcelain', '-uall')) -match 'shot\.png') 'excluded files are still on disk, untracked'
    $r = Invoke-Release $s @('-Mode', 'Commit', '-Number', '1'); Check ($r.Code -eq 1) 'Commit 1 a second time is rejected'
    $r = Invoke-Release $s @('-Mode', 'Push'); Check ($r.Code -eq 1 -and $r.Text -match 'ConfirmMigrationsApplied') 'Push without confirmation is rejected'
    Check ((G $s.Base @('--git-dir', $s.Remote, 'branch', '--list', $Branch)) -eq '') 'nothing pushed yet'
    $r = Invoke-Release $s @('-Mode', 'Push', '-ConfirmMigrationsApplied'); Check ($r.Code -eq 0 -and $r.Text -match 'PUSH DONE') "Push passes (exit=$($r.Code)) $($r.Text)"
    Check ((G $s.Base @('--git-dir', $s.Remote, 'rev-parse', "refs/heads/$Branch")) -eq (Head $s)) 'remote branch == local HEAD'
    Check ((G $s.Wt @('rev-parse', '--abbrev-ref', '@{u}')) -eq "origin/$Branch") 'upstream is set'
    $r = Invoke-Release $s @('-Mode', 'Push', '-ConfirmMigrationsApplied'); Check ($r.Code -eq 1) 'a second Push is rejected (upstream exists)'
  }

  Section 'Push guards that need three commits first'
  if (-not $Only -or 'main moved' -like "*$Only*") {
    $s = Fresh 'mainmoved'
    foreach ($n in 1, 2, 3) { $r = Invoke-Release $s @('-Mode', 'Commit', '-Number', "$n"); Check ($r.Code -eq 0) "setup commit $n" }
    $other = Join-Path $s.Base 'other'; [void](G $s.Base @('clone', '-q', $s.Remote, $other)); [void](G $other @('config', 'user.name', 'O')); [void](G $other @('config', 'user.email', 'o@example.invalid'))
    [void](G $other @('commit', '-q', '--allow-empty', '-m', 'main moved')); [void](G $other @('push', '-q', 'origin', 'main'))
    $h = Head $s
    $r = Invoke-Release $s @('-Mode', 'Push', '-ConfirmMigrationsApplied'); Check ($r.Code -eq 1 -and $r.Text -match 'main moved') "Push stops when remote main moved (exit=$($r.Code))"
    Check ((G $s.Base @('--git-dir', $s.Remote, 'branch', '--list', $Branch)) -eq '' -and (Head $s) -eq $h) 'nothing pushed after the divergence'
    Write-Host ("  {0,-4} Push stops when remote main moved" -f $(if ($r.Code -eq 1 -and $r.Text -match 'main moved') { 'ok' } else { 'FAIL' }))
  }
  if (-not $Only -or 'dirty before push' -like "*$Only*") {
    $s = Fresh 'dirtypush'
    foreach ($n in 1, 2, 3) { $r = Invoke-Release $s @('-Mode', 'Commit', '-Number', "$n"); Check ($r.Code -eq 0) "setup commit $n" }
    Put $s.Wt 'dspacios-travel/lib/late.ts' "x`n"
    $r = Invoke-Release $s @('-Mode', 'Push', '-ConfirmMigrationsApplied'); Check ($r.Code -eq 1 -and $r.Text -match 'not committed') "Push stops with an uncommitted releasable file (exit=$($r.Code))"
    Write-Host ("  {0,-4} Push stops with an uncommitted releasable file" -f $(if ($r.Code -eq 1 -and $r.Text -match 'not committed') { 'ok' } else { 'FAIL' }))
  }

  if ($RealRepoProbe) {
    Section 'REAL worktree: read-only check and guaranteed rejections (no staging, no commit, no push possible)'
    $real = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
    $before = (G $real @('rev-parse', 'HEAD')); $idxBefore = (G $real @('diff', '--cached', '--name-only'))
    function Real([string[]]$A) { return (Invoke-Raw $A) }
    $r = Real @('-Mode', 'Check', '-Whitespace'); Write-Host $r.Text; Check ($r.Code -eq 0) "real Check passes (exit=$($r.Code))"
    $r = Real @('-Mode', 'Commit'); Check ($r.Code -eq 1 -and $r.Text -match 'requires -Number') 'real: Commit without -Number is rejected'
    $r = Real @('-Mode', 'Commit', '-Number', '2'); Check ($r.Code -eq 1 -and $r.Text -match 'ahead of the base') 'real: Commit 2 first is rejected before staging'
    $r = Real @('-Mode', 'Push'); Check ($r.Code -eq 1 -and $r.Text -match 'ConfirmMigrationsApplied') 'real: Push without confirmation is rejected'
    $r = Real @('-Mode', 'Push', '-ConfirmMigrationsApplied', '-Remote', 'no-such-remote'); Check ($r.Code -eq 1 -and $r.Text -match 'ahead of the base') 'real: Push with no commits is rejected at the HEAD guard (remote name is bogus as a second lock)'
    Check ((G $real @('rev-parse', 'HEAD')) -eq $before -and (G $real @('diff', '--cached', '--name-only')) -eq $idxBefore) 'real: HEAD and index unchanged after all probes'
  }
}
finally {
  foreach ($d in $tmpRoots) { try { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction Stop } catch { try { cmd.exe /c "rmdir /s /q `"$d`"" 2>$null } catch { } } }
}

Write-Host ''
Write-Host "checks: $Total, failures: $($Fail.Count)"
if ($Fail.Count -gt 0) { $Fail | ForEach-Object { Write-Host " - $_" }; exit 1 }
Write-Host 'ALL TESTS PASSED'
exit 0
