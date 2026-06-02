$f = 'd:\BDS\worlds\DWELVE\behavior_packs\Economy\scripts\insights\baseline.js'
$c = Get-Content $f
$start = -1; $name = ''; $depth = 0
for ($i = 0; $i -lt $c.Count; $i++) {
    $line = $c[$i]
    if ($start -lt 0 -and $line -match '^\s*(async\s+)?function\s+(\w+)') {
        $start = $i; $name = $Matches[2]; $depth = 0
    }
    if ($start -ge 0) {
        $depth += ([regex]::Matches($line, '\{').Count - [regex]::Matches($line, '\}').Count)
        if ($depth -le 0 -and $i -gt $start) {
            $size = $i - $start + 1
            if ($size -gt 50) { Write-Output ("{0,3}  {1}  L{2}-{3}" -f $size, $name, ($start + 1), ($i + 1)) }
            $start = -1
        }
    }
}
Write-Output "OK"
