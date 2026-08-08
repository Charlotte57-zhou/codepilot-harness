param(
  [switch]$StagedOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = (& git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) { throw 'Not inside a Git repository.' }

if ($StagedOnly) {
  $paths = @(& git diff --cached --name-only --diff-filter=ACMR)
} else {
  $paths = @(& git ls-files)
}

$forbiddenPaths = @(
  '(^|/)\.env($|\.)',
  '(^|/)\.codepilot/',
  '(^|/)node_modules/',
  '(^|/)(?:\.tmp|\.codex-tmp|evaluation/workspaces)/',
  '(^|/)evaluation/artifacts/(?:raw|tmp)/',
  '\.(?:log|pem|pfx|key)$',
  '(?:^|/)sessions/.*\.(?:jsonl|snapshot\.json|index\.json)$'
)

$blocked = [System.Collections.Generic.List[string]]::new()
foreach ($path in $paths) {
  if ($path -match '(^|/)\.env\.example$') { continue }
  if ($path -eq 'demo-repo/.codepilot/skills/harness-audit/SKILL.md') { continue }
  foreach ($pattern in $forbiddenPaths) {
    if ($path -match $pattern) {
      $blocked.Add($path)
      break
    }
  }
}

$contentRules = @(
  @{ Name = 'private-key'; Pattern = '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----' },
  @{ Name = 'long-provider-token'; Pattern = '(?i)(?:sk|ak)-[A-Za-z0-9_-]{20,}' },
  @{ Name = 'assigned-secret'; Pattern = '(?im)^\s*(?:MODEL_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|DEEPSEEK_API_KEY|OPENAI_API_KEY)\s*=\s*(?!replace-me|example|dummy|fake|test|your-|\[REDACTED\])\S{8,}\s*$' }
)

$contentHits = [System.Collections.Generic.List[string]]::new()
foreach ($path in $paths) {
  if ($blocked.Contains($path)) { continue }
  $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($extension -in @('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip')) { continue }

  if ($StagedOnly) {
    $content = (& git show ":$path" 2>$null) -join "`n"
  } else {
    $absolute = Join-Path $repoRoot $path
    if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { continue }
    $content = Get-Content -LiteralPath $absolute -Raw -Encoding utf8 -ErrorAction SilentlyContinue
  }
  if ($null -eq $content) { continue }

  foreach ($rule in $contentRules) {
    if ($content -match $rule.Pattern) {
      $contentHits.Add("$path [$($rule.Name)]")
    }
  }
}

if ($blocked.Count -gt 0 -or $contentHits.Count -gt 0) {
  Write-Error ("Git privacy check failed.`nForbidden paths:`n{0}`nSecret-like content (values hidden):`n{1}" -f (($blocked | Sort-Object -Unique) -join "`n"), (($contentHits | Sort-Object -Unique) -join "`n"))
  exit 1
}

Write-Output "Git privacy check passed for $($paths.Count) tracked candidate(s)."
