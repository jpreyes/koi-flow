# ──────────────────────────────────────────────────────────────────────────────
# build.ps1 — compila el solver SPD de koi-flow a WASM con emcc, en DOS artefactos
# desde la misma fuente (koi_solve.cpp):
#   koi_solve.js / .wasm      single-thread (siempre disponible, sin requisitos)
#   koi_solve_mt.js / .wasm   WASM threads reales (-pthread -DKOI_THREADS=1),
#                             requiere crossOriginIsolated (COOP/COEP, ver serve.py)
#   powershell -ExecutionPolicy Bypass -File wasm/build.ps1
# Núcleo IC(0)-PCG in-house (espejo de nodex), sin dependencias externas.
# ──────────────────────────────────────────────────────────────────────────────
param(
  [string]$EmsdkDir = "$env:USERPROFILE\emsdk",
  [string]$OutDir   = "$PSScriptRoot\..\js\lib\portico\wasm"
)
$ErrorActionPreference = "Stop"
& "$EmsdkDir\emsdk_env.ps1" | Out-Null

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$src = Join-Path $PSScriptRoot "koi_solve.cpp"

$linkCommon = @(
  "-s","ALLOW_MEMORY_GROWTH=1",
  "-s","STACK_SIZE=16777216",
  "-s","EXPORTED_FUNCTIONS=_solveSPD,_malloc,_free",
  "-s","EXPORTED_RUNTIME_METHODS=cwrap,ccall,getValue,setValue,HEAP32,HEAPF64",
  "-s","MODULARIZE=1",
  "-s","ENVIRONMENT=web,worker,node"
)

# ── 1) Single-thread (siempre) ──────────────────────────────────────────────
$outST = Join-Path $OutDir "koi_solve.js"
$linkST = $linkCommon + @("-s","EXPORT_NAME=createKoiSolve")
$argsST = @("-std=c++17","-O3","-DNDEBUG",$src) + $linkST + @("-o",$outST)
Write-Host "emcc (ST) $($argsST -join ' ')" -ForegroundColor Cyan
& emcc @argsST
if ($LASTEXITCODE -ne 0) { Write-Host "BUILD ST FALLO (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

# ── 2) Multi-thread (Fase 1: WASM threads) ──────────────────────────────────
# PTHREAD_POOL_SIZE con expresión JS: pre-arranca tantos Workers como núcleos
# tenga el navegador (tope 8, ver koi_solve.cpp numThreads). SHARED_MEMORY lo
# implica -pthread. El módulo solo corre si la página está crossOriginIsolated
# (COOP/COEP) — si no, wasm_solve.js cae al build single-thread.
$outMT = Join-Path $OutDir "koi_solve_mt.js"
$linkMT = $linkCommon + @(
  "-pthread",
  "-s","INITIAL_MEMORY=67108864",
  "-s","PTHREAD_POOL_SIZE=Math.max(1,Math.min(8,(navigator.hardwareConcurrency||4)))",
  "-s","EXPORT_NAME=createKoiSolveMT"
)
$argsMT = @("-std=c++17","-O3","-DNDEBUG","-DKOI_THREADS=1","-pthread",$src) + $linkMT + @("-o",$outMT)
Write-Host "emcc (MT) $($argsMT -join ' ')" -ForegroundColor Cyan
& emcc @argsMT
if ($LASTEXITCODE -ne 0) { Write-Host "BUILD MT FALLO (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

Write-Host "OK -> $outST" -ForegroundColor Green
Write-Host "OK -> $outMT" -ForegroundColor Green
Get-ChildItem $OutDir | Select-Object Name,Length
