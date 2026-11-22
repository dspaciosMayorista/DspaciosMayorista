<#
.SYNOPSIS
  Fail-closed publication helper for the integrated #126 / #127 / B2B block (REL-1). Windows PowerShell 5.1.

.DESCRIPTION
  Replaces the bare command list of the handoff. Every Git call goes through ONE verified git.exe, runs with
  `--literal-pathspecs -c core.quotepath=off -C <root>`, and its exit code is checked; any unexpected code, any
  failed guard or any difference between a path set and its manifest throws and the script exits 1 BEFORE the
  next step (stage -> verify -> commit -> verify), so nothing downstream can run after a failure.

  Modes
    Check   read-only: all guards + manifest/dirty-set comparison (+ optional -Fetch / -Whitespace).
    Commit  -Number 1|2|3 : guards -> stage exactly manifest N -> verify the staged path set and `diff --cached --check`
            -> commit -> verify the commit's path set, clean index and the remaining dirty set. One commit per run.
    Push    -ConfirmMigrationsApplied : guards (3 commits, nothing releasable left, remote main still the base,
            branch not on the remote) -> `git push -u origin HEAD:refs/heads/<branch>` -> verify upstream and remote tip.

  Run (owner), from any directory:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File <this file> -Mode Check -Fetch
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File <this file> -Mode Commit -Number 1
  The process exit code is 0 only when every step passed (`$LASTEXITCODE`).

  Parameters other than -Mode/-Number/-Fetch/-Whitespace/-ConfirmMigrationsApplied exist only so the test script can point
  the helper at a scratch repository; the defaults are the real release.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Check', 'Commit', 'Push')][string]$Mode,
  [ValidateSet(1, 2, 3)][int]$Number = 0,
  [switch]$Fetch,
  [switch]$Whitespace,
  [switch]$ConfirmMigrationsApplied,
  [string]$RepoRoot,
  [string]$ManifestDir,
  [string]$ExpectedBranch = 'codex/integracion-126-127-b2b',
  [string]$BaseSha = '312608a5922d4424ac912153394f4aee99357cb2',
  [string]$Remote = 'origin',
  [string]$GitPath,
  [switch]$SkipWorktreeCheck,
  [string]$ExpectedCounts = ''
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

# ----------------------------------------------------------------------------------------------------------------------
# Release constants
# ----------------------------------------------------------------------------------------------------------------------
$AppDir = 'dspacios-travel'
$ManifestFiles = @{ 1 = 'commit-1-database.txt'; 2 = 'commit-2-application-and-tests.txt'; 3 = 'commit-3-documentation-and-tooling.txt' }
$CoAuthor = 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'
$Messages = @{
  1 = @('Add migrations 312-319 and 322-326 with preflight, postcheck, rollback and SQL tests', '',
        'Database side of the integrated #126/#127/B2B block. Each migration has one integral',
        'read-only preflight and postcheck; none is applied by this commit. Order: 312, 313,',
        '314, 315, 316, 317, 318, 319, 322, 323, 324, 325, 326 (320/321 unused).', '', $CoAuthor)
  2 = @('Integrate #126/#127 follow-ups and the B2B portal block (application and tests)', '',
        'Payments and USD (#126), general hotel closure (#127), B2B portal (#25, #32, #35, #48,',
        '#62, #76/#77, #78, #84, #98), owner-feedback rounds O-1..O-4 and the four accepted',
        'corrections (quotation origin, compact passengers, add-passenger capacity, tariff',
        'attribution). Requires migrations 312-326 in Production before this code runs.', '', $CoAuthor)
  3 = @('Document the integrated block and add its local verification tooling', '',
        'Evidence, runbook and release inventory for the #126/#127/B2B block, plus the local',
        'review rigs it used. No product code.', '', $CoAuthor)
}
# Expected size of each list (the owner-visible numbers in the handoff). Overridable only for the scratch-repo tests.
$DefaultCounts = @{ 1 = 70; 2 = 283; 3 = 106 }
if ($ExpectedCounts -ne '') {
  $c = @($ExpectedCounts -split ',' | ForEach-Object { [int]$_.Trim() })
  if ($c.Count -ne 3) { throw 'ExpectedCounts must be three comma-separated integers' }
  $DefaultCounts = @{ 1 = $c[0]; 2 = $c[1]; 3 = $c[2] }
}

# Paths that must NEVER be staged (they exist in the working tree on purpose): a path matching one is "excluded", and a manifest containing one is rejected.
$ExcludedRules = @(
  @{ Re = '^dspacios-travel/\.next-'; Why = 'old Next.js build folder' },
  @{ Re = '^dspacios-travel/integrar-lote-local\.mjs$'; Why = 'local composer script' },
  @{ Re = '^dspacios-travel/docs/tecnico/evidence-326/.*\.png$'; Why = 'evidence screenshot / synthetic upload fixture' },
  @{ Re = '^dspacios-travel/docs/tecnico/evidence-326/no-es-imagen\.txt$'; Why = 'synthetic upload fixture' },
  @{ Re = '^dspacios-travel/supabase/scripts/localreview_integrado/(preparar_navegador_revision\.mjs|navegador_revision\.ps1)$'; Why = 'browser credential-store tool' }
)
# Never acceptable inside ANY manifest or commit, whatever the folder.
$ForbiddenRules = @(
  @{ Re = '(^|/)node_modules/'; Why = 'node_modules' },
  @{ Re = '(^|/)\.next(-[^/]*)?(/|$)'; Why = 'Next.js build output' },
  @{ Re = '(^|/)\.env($|[./])'; Why = 'environment file' },
  @{ Re = '\.dump$'; Why = 'database dump' },
  @{ Re = '\.png$'; Why = 'PNG (screenshots/fixtures are excluded from this release)' },
  @{ Re = '\.tsbuildinfo$'; Why = 'TypeScript build info' },
  @{ Re = '(^|/)\.\.(/|$)'; Why = 'parent-directory segment' },
  @{ Re = '^/|^[A-Za-z]:'; Why = 'absolute path' },
  @{ Re = '\\'; Why = 'backslash in a repository path' }
)

class ReleaseStop : System.Exception { ReleaseStop([string]$m) : base($m) { } }
function Stop-Release([string]$Message) { throw [ReleaseStop]::new($Message) }
function Say([string]$Text) { Write-Host $Text }
function Pass([string]$Text) { Write-Host ('  OK   ' + $Text) }

# ----------------------------------------------------------------------------------------------------------------------
# One verified git executable; every call returns {Code, Out, Err} and is checked against the allowed exit codes.
# ----------------------------------------------------------------------------------------------------------------------
$script:GitExe = $null
$script:Root = $null

function Resolve-GitExecutable {
  $candidate = $GitPath
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $cmd = @(Get-Command -Name 'git.exe' -CommandType Application -ErrorAction SilentlyContinue)
    if ($cmd.Count -lt 1) { Stop-Release 'git.exe was not found on PATH.' }
    $candidate = $cmd[0].Source
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { Stop-Release "git executable not found: $candidate" }
  $script:GitExe = (Resolve-Path -LiteralPath $candidate).Path
}

function ConvertTo-ProcessArgument([string]$Arg) {
  if ($Arg -eq '') { return '""' }
  if ($Arg -notmatch '[\s"]') { return $Arg }
  $q = $Arg -replace '(\\*)"', '$1$1\"'
  $q = $q -replace '(\\+)$', '$1$1'
  return '"' + $q + '"'
}

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string[]]$GitArgs, [int[]]$OkCodes = @(0), [switch]$NoRoot, [string]$What)
  $all = @('--literal-pathspecs', '-c', 'core.quotepath=off')
  if (-not $NoRoot) { $all += @('-C', $script:Root) }
  $all += $GitArgs
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:GitExe
  $psi.Arguments = (($all | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  if (-not $p.Start()) { Stop-Release "could not start git for: $($GitArgs -join ' ')" }
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  $p.WaitForExit()
  $res = [pscustomobject]@{ Code = $p.ExitCode; Out = $outTask.Result; Err = $errTask.Result }
  $p.Dispose()
  if ($OkCodes -notcontains $res.Code) {
    $label = if ($What) { $What } else { 'git ' + ($GitArgs[0..([Math]::Min(2, $GitArgs.Count - 1))] -join ' ') }
    $detail = ($res.Err.Trim() -split "`n" | Select-Object -First 4) -join ' | '
    Stop-Release "$label failed with exit code $($res.Code): $detail"
  }
  return $res
}

function Split-Nul([string]$Text) { return @($Text -split "`0" | Where-Object { $_ -ne '' }) }
function Get-Rev([string]$Ref) {
  $sha = (Invoke-Git -GitArgs @('rev-parse', '--verify', '--quiet', $Ref) -What "rev-parse $Ref").Out.Trim()
  $type = (Invoke-Git -GitArgs @('cat-file', '-t', $sha) -What "cat-file -t $Ref").Out.Trim()
  if ($type -ne 'commit') { Stop-Release "$Ref is a $type, not a commit." }
  return $sha
}

# ----------------------------------------------------------------------------------------------------------------------
# Path-set helpers
# ----------------------------------------------------------------------------------------------------------------------
function Test-Excluded([string]$Path) { foreach ($r in $ExcludedRules) { if ($Path -match $r.Re) { return $r.Why } }; return $null }
function Test-Forbidden([string]$Path) { foreach ($r in $ForbiddenRules) { if ($Path -match $r.Re) { return $r.Why } }; $e = Test-Excluded $Path; if ($e) { return "excluded: $e" }; return $null }

function Compare-PathSets([string[]]$Expected, [string[]]$Actual, [string]$Label) {
  $e = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
  $a = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
  foreach ($x in $Expected) { [void]$e.Add($x) }
  foreach ($x in $Actual) { [void]$a.Add($x) }
  $missing = @($e | Where-Object { -not $a.Contains($_) } | Sort-Object)
  $extra = @($a | Where-Object { -not $e.Contains($_) } | Sort-Object)
  if ($missing.Count -gt 0 -or $extra.Count -gt 0) {
    $msg = "$Label differs from the manifest: $($missing.Count) expected path(s) missing, $($extra.Count) unexpected path(s)."
    if ($missing.Count -gt 0) { $msg += "`n    missing (first 8): " + (($missing | Select-Object -First 8) -join '; ') }
    if ($extra.Count -gt 0) { $msg += "`n    unexpected (first 8): " + (($extra | Select-Object -First 8) -join '; ') }
    Stop-Release $msg
  }
}

function Read-Manifest([int]$N) {
  $file = Join-Path $script:ManifestDirResolved $ManifestFiles[$N]
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Stop-Release "manifest $N not found: $file" }
  $text = [System.IO.File]::ReadAllText($file, (New-Object System.Text.UTF8Encoding($false)))
  if ($text.Length -eq 0) { Stop-Release "manifest $N is empty" }
  $lines = @($text -split "`n")
  if ($lines[$lines.Count - 1] -eq '') { $lines = @($lines[0..($lines.Count - 2)]) }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
  $paths = New-Object 'System.Collections.Generic.List[string]'
  $i = 0
  foreach ($raw in $lines) {
    $i++
    $line = $raw.TrimEnd("`r")
    if ($line -eq '' -or $line -ne $line.Trim()) { Stop-Release "manifest $N line ${i}: empty line or leading/trailing whitespace" }
    if (-not $line.StartsWith("$AppDir/")) { Stop-Release "manifest $N line ${i}: path outside $AppDir/ ($line)" }
    $bad = Test-Forbidden $line
    if ($bad) { Stop-Release "manifest $N line ${i}: forbidden path ($bad): $line" }
    if (-not $seen.Add($line)) { Stop-Release "manifest $N line ${i}: duplicate path: $line" }
    $disk = Join-Path $script:Root ($line -replace '/', '\')
    if (-not (Test-Path -LiteralPath $disk -PathType Leaf)) { Stop-Release "manifest $N line ${i}: file does not exist in the working tree: $line" }
    $paths.Add($line)
  }
  $want = $DefaultCounts[$N]
  if ($paths.Count -ne $want) { Stop-Release "manifest $N has $($paths.Count) paths; expected $want" }
  return , @($paths)
}

# `git status` entries: only ' M' (tracked, modified) and '??' (untracked) are acceptable; anything staged/deleted/renamed/unmerged stops the run.
function Get-DirtySet {
  $res = Invoke-Git -GitArgs @('status', '--porcelain=v1', '-uall', '-z') -What 'git status'
  $tok = @($res.Out -split "`0" | Where-Object { $_ -ne '' })
  $dirty = New-Object 'System.Collections.Generic.List[string]'
  $excluded = 0
  $odd = New-Object 'System.Collections.Generic.List[string]'
  foreach ($t in $tok) {
    if ($t.Length -lt 4) { $odd.Add($t); continue }
    $xy = $t.Substring(0, 2); $p = $t.Substring(3)
    if ($xy -ne ' M' -and $xy -ne '??') { $odd.Add("[$xy] $p"); continue }
    if (Test-Excluded $p) { $excluded++; continue }
    $dirty.Add($p)
  }
  if ($odd.Count -gt 0) { Stop-Release ("working tree has entries that are not plain modified/untracked files (staged, deleted, renamed or unmerged): " + (($odd | Select-Object -First 8) -join '; ')) }
  return [pscustomobject]@{ Paths = @($dirty); Excluded = $excluded }
}

function Get-StagedSet {
  $res = Invoke-Git -GitArgs @('diff', '--cached', '--name-status', '-z', '--no-renames') -What 'git diff --cached --name-status'
  $tok = @($res.Out -split "`0" | Where-Object { $_ -ne '' })
  if (($tok.Count % 2) -ne 0) { Stop-Release 'unexpected shape of `git diff --cached --name-status -z` output' }
  $set = New-Object 'System.Collections.Generic.List[string]'
  for ($i = 0; $i -lt $tok.Count; $i += 2) {
    $st = $tok[$i]; $p = $tok[$i + 1]
    if ($st -ne 'A' -and $st -ne 'M') { Stop-Release "staged entry with status '$st' (only A and M are allowed): $p" }
    $set.Add($p)
  }
  return @($set)
}

function Assert-IndexEmpty([string]$When) {
  $r = Invoke-Git -GitArgs @('diff', '--cached', '--quiet', '--exit-code') -OkCodes @(0, 1) -What 'git diff --cached --quiet'
  if ($r.Code -ne 0) { Stop-Release "index is not empty $When (something is already staged)." }
  $u = Invoke-Git -GitArgs @('ls-files', '-u', '-z') -What 'git ls-files -u'
  if ($u.Out.Length -gt 0) { Stop-Release "index has unmerged entries $When." }
}

# ----------------------------------------------------------------------------------------------------------------------
# Guards
# ----------------------------------------------------------------------------------------------------------------------
function Assert-Environment {
  Resolve-GitExecutable
  $v = Invoke-Git -GitArgs @('--version') -NoRoot -What 'git --version'
  Pass ("git: " + $v.Out.Trim() + "  ($($script:GitExe))")

  if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..')) }
  $want = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/')
  if (-not (Test-Path -LiteralPath $want -PathType Container)) { Stop-Release "repository root not found: $want" }
  $script:Root = $want
  $script:ManifestDirResolved = if ([string]::IsNullOrWhiteSpace($ManifestDir)) { $PSScriptRoot } else { [System.IO.Path]::GetFullPath($ManifestDir) }

  $top = (Invoke-Git -GitArgs @('rev-parse', '--show-toplevel') -What 'rev-parse --show-toplevel').Out.Trim()
  $topN = ([System.IO.Path]::GetFullPath($top)).TrimEnd('\', '/')
  if (-not [string]::Equals($topN, $want, [System.StringComparison]::OrdinalIgnoreCase)) { Stop-Release "git top-level is '$topN', expected '$want' (wrong repository or wrong folder)." }
  Pass "repository root: $topN"

  if (-not $SkipWorktreeCheck) {
    $gd = (Invoke-Git -GitArgs @('rev-parse', '--absolute-git-dir') -What 'rev-parse --absolute-git-dir').Out.Trim()
    $gc = (Invoke-Git -GitArgs @('rev-parse', '--path-format=absolute', '--git-common-dir') -What 'rev-parse --git-common-dir').Out.Trim()
    if ([string]::Equals(([System.IO.Path]::GetFullPath($gd)).TrimEnd('\', '/'), ([System.IO.Path]::GetFullPath($gc)).TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) {
      Stop-Release 'this is the main checkout, not the linked worktree of the release (git-dir equals git-common-dir).'
    }
    Pass 'linked worktree (not the main checkout)'
  }

  $br = (Invoke-Git -GitArgs @('symbolic-ref', '--quiet', '--short', 'HEAD') -OkCodes @(0, 1) -What 'symbolic-ref HEAD')
  if ($br.Code -ne 0 -or $br.Out.Trim() -ne $ExpectedBranch) { Stop-Release "current branch is '$($br.Out.Trim())' (detached HEAD if empty); expected '$ExpectedBranch'." }
  Pass "branch: $ExpectedBranch"

  $gitDir = (Invoke-Git -GitArgs @('rev-parse', '--absolute-git-dir') -What 'rev-parse --absolute-git-dir').Out.Trim()
  foreach ($f in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG')) {
    if (Test-Path -LiteralPath (Join-Path $gitDir $f)) { Stop-Release "a Git operation is in progress ($f exists in $gitDir)." }
  }
  Pass 'no merge/rebase/cherry-pick/revert/bisect in progress'
}

function Assert-NoUpstreamYet {
  $u = Invoke-Git -GitArgs @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') -OkCodes @(0, 128) -What 'rev-parse @{u}'
  if ($u.Code -eq 0) { Stop-Release "the branch already has an upstream ($($u.Out.Trim())); expected none before the first push." }
  Pass 'no upstream configured (as expected before the first push)'
}

function Assert-HeadPosition([int]$Ahead) {
  $head = Get-Rev 'HEAD'
  $base = Get-Rev $BaseSha
  if ($base -ne $BaseSha) { Stop-Release "base commit $BaseSha is not present in this repository." }
  if ($Ahead -eq 0) {
    if ($head -ne $BaseSha) { Stop-Release "HEAD is $head, expected the base $BaseSha." }
    Pass "HEAD == base ($BaseSha)"
    return
  }
  $anc = Invoke-Git -GitArgs @('merge-base', '--is-ancestor', $BaseSha, 'HEAD') -OkCodes @(0, 1) -What 'merge-base --is-ancestor'
  if ($anc.Code -ne 0) { Stop-Release 'HEAD does not descend from the base commit.' }
  $cnt = [int](Invoke-Git -GitArgs @('rev-list', '--count', "$BaseSha..HEAD") -What 'rev-list --count').Out.Trim()
  if ($cnt -ne $Ahead) { Stop-Release "HEAD is $cnt commit(s) ahead of the base; expected $Ahead." }
  $mg = (Invoke-Git -GitArgs @('rev-list', '--merges', "$BaseSha..HEAD") -What 'rev-list --merges').Out.Trim()
  if ($mg -ne '') { Stop-Release 'a merge commit sits between the base and HEAD.' }
  $subjects = @((Invoke-Git -GitArgs @('log', '--reverse', '--format=%s', "$BaseSha..HEAD") -What 'git log').Out -split "`n" | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ -ne '' })
  for ($k = 1; $k -le $Ahead; $k++) { if ($subjects[$k - 1] -ne $Messages[$k][0]) { Stop-Release "commit #$k subject is '$($subjects[$k - 1])', expected '$($Messages[$k][0])'." } }
  # each earlier commit must contain exactly its manifest
  $revs = @((Invoke-Git -GitArgs @('rev-list', '--reverse', "$BaseSha..HEAD") -What 'rev-list').Out -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
  for ($k = 1; $k -le $Ahead; $k++) {
    $files = @(Split-Nul (Invoke-Git -GitArgs @('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', $revs[$k - 1]) -What 'git diff-tree').Out)
    Compare-PathSets (Read-Manifest $k) $files "commit #$k ($($revs[$k - 1].Substring(0, 9))) path set"
  }
  Pass "HEAD is $Ahead commit(s) ahead of the base; subjects and path sets match manifests 1..$Ahead"
}

function Assert-NoExcludedTracked {
  $tracked = @(Split-Nul (Invoke-Git -GitArgs @('ls-files', '-z') -What 'git ls-files').Out)
  $bad = @($tracked | Where-Object { Test-Excluded $_ } | Select-Object -First 5)
  if ($bad.Count -gt 0) { Stop-Release ("an excluded path is tracked: " + ($bad -join '; ')) }
  Pass 'no excluded path is tracked'
}

function Assert-RemoteState([bool]$RequireBranchAbsent) {
  $r = Invoke-Git -GitArgs @('remote', 'get-url', $Remote) -What "remote get-url $Remote"
  Pass "remote '$Remote' = $($r.Out.Trim())"
  $m = Invoke-Git -GitArgs @('ls-remote', '--exit-code', $Remote, 'refs/heads/main') -What "ls-remote $Remote main"
  $remoteMain = ($m.Out.Trim() -split '\s+')[0]
  if ($remoteMain -ne $BaseSha) { Stop-Release "remote main is $remoteMain, the release was prepared on ${BaseSha}: main moved - STOP and ask for a re-audit." }
  Pass "remote main == base ($BaseSha)"
  if ($RequireBranchAbsent) {
    $b = Invoke-Git -GitArgs @('ls-remote', '--heads', $Remote, "refs/heads/$ExpectedBranch") -What "ls-remote $Remote $ExpectedBranch"
    if ($b.Out.Trim() -ne '') { Stop-Release "branch '$ExpectedBranch' already exists on '$Remote'; refusing to push over it." }
    Pass "branch '$ExpectedBranch' does not exist on '$Remote'"
  }
}

function Test-WhitespaceGate([string[]]$Paths, [string[]]$Modified) {
  $mod = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
  foreach ($m in $Modified) { [void]$mod.Add($m) }
  $bad = New-Object 'System.Collections.Generic.List[string]'
  foreach ($p in $Paths) {
    if ($mod.Contains($p)) { $r = Invoke-Git -GitArgs @('diff', '--check', 'HEAD', '--', $p) -OkCodes @(0, 2) -What "diff --check $p" }
    else { $r = Invoke-Git -GitArgs @('diff', '--no-index', '--check', '--', '/dev/null', $p) -OkCodes @(0, 1, 2, 3) -What "diff --no-index --check $p" }
    # exit codes: tracked `diff --check` -> 0 clean / 2 findings; `--no-index --check` -> 1 clean (the files differ) / 3 findings
    $found = if ($mod.Contains($p)) { $r.Code -ne 0 } else { $r.Code -ge 2 }
    if ($found -or $r.Out.Trim() -ne '') { $bad.Add($p) }
  }
  return @($bad)
}

# ----------------------------------------------------------------------------------------------------------------------
# Modes
# ----------------------------------------------------------------------------------------------------------------------
function Get-Manifests { $m = @{}; foreach ($n in 1, 2, 3) { $m[$n] = Read-Manifest $n }; return $m }

function Assert-ManifestsDisjoint($Manifests) {
  $seen = @{}
  foreach ($n in 1, 2, 3) { foreach ($p in $Manifests[$n]) { if ($seen.ContainsKey($p)) { Stop-Release "path appears in manifests $($seen[$p]) and ${n}: $p" }; $seen[$p] = $n } }
  Pass 'manifests are disjoint and every path exists, is allowed and is listed once'
}

function Assert-RemainingEqualsManifests([int]$FromNumber, $Manifests, [string]$Label) {
  $want = New-Object 'System.Collections.Generic.List[string]'
  for ($n = $FromNumber; $n -le 3; $n++) { foreach ($p in $Manifests[$n]) { $want.Add($p) } }
  $dirty = Get-DirtySet
  Compare-PathSets @($want) $dirty.Paths $Label
  Pass "$Label == manifests $FromNumber..3 ($($want.Count) paths; $($dirty.Excluded) excluded entries ignored)"
  return $dirty
}

function Invoke-Check {
  Say '== Check (read-only)'
  Assert-Environment
  Assert-NoUpstreamYet
  Assert-HeadPosition 0
  Assert-IndexEmpty 'at the start'
  Pass 'index is empty'
  $mf = Get-Manifests
  Assert-ManifestsDisjoint $mf
  $dirty = Assert-RemainingEqualsManifests 1 $mf 'releasable working-tree changes'
  Assert-NoExcludedTracked
  if ($Fetch) { [void](Invoke-Git -GitArgs @('fetch', '--quiet', $Remote, 'main') -What "fetch $Remote main"); Pass "fetched $Remote/main" }
  $om = Invoke-Git -GitArgs @('rev-parse', '--verify', '--quiet', "refs/remotes/$Remote/main") -OkCodes @(0, 1) -What "rev-parse $Remote/main"
  if ($om.Code -ne 0) { Stop-Release "no local ref $Remote/main (run with -Fetch)." }
  if ($om.Out.Trim() -ne $BaseSha) { Stop-Release "$Remote/main is $($om.Out.Trim()) but the release is based on ${BaseSha}: main moved - STOP and ask for a re-audit." }
  Pass "$Remote/main == base$(if (-not $Fetch) { ' (local ref; add -Fetch to refresh)' })"
  if ($Whitespace) {
    $all = New-Object 'System.Collections.Generic.List[string]'
    foreach ($n in 1, 2, 3) { foreach ($p in $mf[$n]) { $all.Add($p) } }
    $trackedMod = @((Split-Nul (Invoke-Git -GitArgs @('diff', '--name-only', '-z') -What 'git diff --name-only').Out))
    $bad = @(Test-WhitespaceGate @($all) $trackedMod)
    if ($bad.Count -gt 0) { Stop-Release ("whitespace gate (diff --check) would fail for $($bad.Count) file(s), first: " + (($bad | Select-Object -First 8) -join '; ')) }
    Pass "whitespace gate: no `git diff --check` finding in $($all.Count) files (read-only preview)"
  }
  Say 'CHECK PASSED - nothing was staged, committed or pushed.'
}

function Invoke-CommitStep {
  if ($Number -lt 1) { Stop-Release '-Mode Commit requires -Number 1, 2 or 3.' }
  Say "== Commit $Number"
  Assert-Environment
  Assert-NoUpstreamYet
  Assert-HeadPosition ($Number - 1)
  Assert-IndexEmpty 'at the start'
  Pass 'index is empty'
  $mf = Get-Manifests
  Assert-ManifestsDisjoint $mf
  [void](Assert-RemainingEqualsManifests $Number $mf "remaining releasable changes (before commit $Number)")
  $before = Get-Rev 'HEAD'

  $pathFile = Join-Path ([System.IO.Path]::GetTempPath()) ('release-pathspec-' + [guid]::NewGuid().ToString('N') + '.nul')
  $msgFile = Join-Path ([System.IO.Path]::GetTempPath()) ('release-message-' + [guid]::NewGuid().ToString('N') + '.txt')
  $staged = $false
  try {
    [System.IO.File]::WriteAllBytes($pathFile, (New-Object System.Text.UTF8Encoding($false)).GetBytes((($mf[$Number] -join "`0") + "`0")))
    [System.IO.File]::WriteAllText($msgFile, (($Messages[$Number] -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))

    [void](Invoke-Git -GitArgs @('add', "--pathspec-from-file=$pathFile", '--pathspec-file-nul') -What "git add (manifest $Number)")
    $staged = $true
    Pass "staged manifest $Number"

    $now = @(Get-StagedSet)
    Compare-PathSets $mf[$Number] $now "staged path set"
    if ($now.Count -ne $mf[$Number].Count) { Stop-Release "staged $($now.Count) paths, manifest has $($mf[$Number].Count)." }
    foreach ($p in $now) { $bad = Test-Forbidden $p; if ($bad) { Stop-Release "staged path is forbidden ($bad): $p" } }
    Pass "staged path set == manifest $Number exactly ($($now.Count) paths, only A/M, none excluded)"

    $chk = Invoke-Git -GitArgs @('diff', '--cached', '--check') -OkCodes @(0, 2) -What 'git diff --cached --check'
    if ($chk.Code -ne 0 -or $chk.Out.Trim() -ne '') { Stop-Release ("git diff --cached --check reported problems: " + (($chk.Out.Trim() -split "`n" | Select-Object -First 6) -join ' | ')) }
    Pass 'git diff --cached --check is clean'

    [void](Invoke-Git -GitArgs @('commit', '--quiet', '-F', $msgFile) -What "git commit #$Number")
    $staged = $false
  }
  catch {
    if ($staged) {
      try { [void](Invoke-Git -GitArgs @('reset', '--quiet') -What 'git reset (undo staging)'); Say '  The index was restored to empty (nothing committed).' }
      catch { Say "  WARNING: could not restore the index automatically; run: git -C `"$($script:Root)`" reset" }
    }
    throw
  }
  finally {
    Remove-Item -LiteralPath $pathFile, $msgFile -Force -ErrorAction SilentlyContinue
  }

  $after = Get-Rev 'HEAD'
  if ($after -eq $before) { Stop-Release 'HEAD did not move after the commit.' }
  $parent = (Invoke-Git -GitArgs @('rev-parse', '--verify', "$after~1") -What 'rev-parse HEAD~1').Out.Trim()
  if ($parent -ne $before) { Stop-Release 'the new commit is not a direct child of the previous HEAD.' }
  $files = @(Split-Nul (Invoke-Git -GitArgs @('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', $after) -What 'git diff-tree').Out)
  Compare-PathSets $mf[$Number] $files "commit #$Number path set"
  Assert-IndexEmpty 'after the commit'
  Pass "commit #$Number = $after contains exactly manifest $Number ($($files.Count) paths); index is empty"
  if ($Number -lt 3) { [void](Assert-RemainingEqualsManifests ($Number + 1) $mf "remaining releasable changes (after commit $Number)") }
  else {
    $left = Get-DirtySet
    if ($left.Paths.Count -gt 0) { Stop-Release ("releasable changes remain after commit 3: " + (($left.Paths | Select-Object -First 8) -join '; ')) }
    Assert-NoExcludedTracked
    Pass "nothing releasable remains ($($left.Excluded) excluded entries stay local)"
  }
  Say "COMMIT $Number DONE."
}

function Invoke-PushStep {
  Say '== Push'
  if (-not $ConfirmMigrationsApplied) { Stop-Release 'refusing to push: pass -ConfirmMigrationsApplied only after migrations 312-326 are applied AND postchecked in Production (the Preview shares that database).' }
  Assert-Environment
  Assert-NoUpstreamYet
  Assert-HeadPosition 3
  Assert-IndexEmpty 'before the push'
  Pass 'index is empty'
  $left = Get-DirtySet
  if ($left.Paths.Count -gt 0) { Stop-Release ("releasable changes are not committed: " + (($left.Paths | Select-Object -First 8) -join '; ')) }
  Pass "no uncommitted releasable change ($($left.Excluded) excluded entries stay local)"
  Assert-NoExcludedTracked
  Assert-RemoteState $true
  $head = Get-Rev 'HEAD'
  [void](Invoke-Git -GitArgs @('push', '--set-upstream', $Remote, "HEAD:refs/heads/$ExpectedBranch") -What "git push $Remote")
  $u = (Invoke-Git -GitArgs @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') -What 'rev-parse @{u}').Out.Trim()
  if ($u -ne "$Remote/$ExpectedBranch") { Stop-Release "upstream is '$u', expected '$Remote/$ExpectedBranch'." }
  $tip = ((Invoke-Git -GitArgs @('ls-remote', $Remote, "refs/heads/$ExpectedBranch") -What 'ls-remote after push').Out.Trim() -split '\s+')[0]
  if ($tip -ne $head) { Stop-Release "remote branch tip is $tip, local HEAD is $head." }
  Pass "pushed $head to $Remote/$ExpectedBranch and upstream is set"
  Say 'PUSH DONE. Open the PR in the browser (gh is not installed here).'
}

try {
  switch ($Mode) {
    'Check' { Invoke-Check }
    'Commit' { Invoke-CommitStep }
    'Push' { Invoke-PushStep }
  }
  exit 0
}
catch {
  $m = $_.Exception.Message
  [Console]::Error.WriteLine("STOP: $m")
  Write-Host "STOP: $m"
  Write-Host 'Nothing further was run. Fix the cause (or report it) before trying again; do not force.'
  exit 1
}
